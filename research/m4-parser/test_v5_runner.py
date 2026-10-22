"""File contracts and bounded dispatch; no model calls or efficacy claims."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import run_v5 as runner
import test_v3_runner as fixtures


class V5RunnerTest(unittest.TestCase):
    jsonl = fixtures.V3RunnerTest.jsonl

    def setUp(self):
        fixtures.V3RunnerTest.setUp(self)
        self.baseline = self.root / "baseline"
        self.baseline.mkdir()
        self.manifests["v4"] = {"trainingSystem": "fixture", "enumEvaluationSystem": "fixture enum", "files": {}}
        (self.data / "v4").mkdir()
        for name in ("train", "dev"):
            path = self.data / f"v4/{name}.jsonl"; self.jsonl(path, [{"id": name}])
            self.manifests["v4"]["files"][path.name] = {"sha256": runner.digest(path), "lines": 1}
        runner.write_json(self.m4 / "data/v4-manifest.json", self.manifests["v4"])
        self.rows = [r for v, name, _ in runner.SPLITS.values() for r in runner.read(self.data / v / f"{name}.jsonl")]
        enum = copy.deepcopy(self.rows)
        for row in enum:
            row["messages"][0]["content"] = "fixture enum"
        (self.baseline / "enum-eval.jsonl").write_bytes(b"".join((json.dumps(r) + "\n").encode() for r in enum))
        self.protocol = {"candidate": "S", "trainingRuns": 2, "maxSeconds": 10800,
            "quantization": "q8_0", "gates": runner.GATES, "focusGates": runner.FOCUS_GATES,
            "evaluationItems": 3, "maximumModelPredictions": 12, "newStreamOrder": list(runner.NEW),
            "trainingArgs": ["--device", "cuda"], "trainingMetrics": {"steps": 800}, "sourceLfSha256": {},
            "baselineCommit": "archived", "input": {"sha256": runner.digest(self.baseline / "enum-eval.jsonl"),
            "tokenIdsSha256": "enum-tokens"},
            "dataManifestCanonicalSha256": {v: runner.manifest_digest(self.m4 / f"data/{v}-manifest.json") for v in self.manifests}}
        self.jsonl(self.baseline / "D.jsonl", self.predictions())
        runner.write_json(self.baseline / "D.jsonl.audit.json", self.audit("H"))
        runner.write_json(self.baseline / "run.json", {"commit": "archived", "steps": [{"name": "D", "exit": 0}]})
        self.protocol["baselineFiles"] = {p.name: runner.digest(p) for p in self.baseline.iterdir()}
        runner.write_json(self.m4 / "train/protocol-v5.json", self.protocol)

    def predictions(self):
        return [{"id": r["id"], "output": "{}", "finishReason": "stop"} for r in self.rows]

    def audit(self, arm):
        hf = arm == "S-HF"
        return {"inputSha256": self.protocol["input"]["sha256"], "tokenIdsSha256": "enum-tokens", "items": 3,
            "greedy": True, "repetitionPenalty": 1, "maxNewTokens": 256, "engine": "hf" if hf else "gguf",
            "threads": None if hf else 4, "prefillThreads": None if hf else 4, "resetBetweenItems": not hf}

    def seed_reports(self):
        self.out.mkdir()
        runner.prepare(self.data, self.manifests, self.out, self.baseline, self.protocol)
        for arm in runner.NEW:
            self.jsonl(self.out / f"{arm}.jsonl", self.predictions())
            runner.write_json(self.out / f"{arm}.jsonl.audit.json", self.audit(arm))
        for arm in ("T", "S"):
            (self.out / arm / "model").mkdir(parents=True)
            metrics = {"steps": 800}
            if arm == "S": metrics["objective"] = "sample-mean-answer-token-ce"
            runner.write_json(self.out / arm / "model/train_metrics.json", metrics)
        for arm in ("S-HF", "S-F16"):
            runner.write_json(self.out / f"agreement-{arm}.json", {"items": 3, "missing": 0, "sameParsed": 3})
        runner.write_json(self.out / "metrics-S-challenge.json", {"exactRate": 1, "schemaValidRate": 1, "invented": 0})
        for split in runner.SPLITS:
            runner.write_json(self.out / f"ground-S-{split}.json", {"accepted": 1, "unsafeAccepted": 0,
                "guarded": {"total": 1, "invented": 0}})
        runner.write_json(self.out / "loss-summary.json", self.summary())

    @staticmethod
    def summary():
        return {"arms": {"S": {"invalidClarificationReasons": 0,
            "focus": {k: {"negativeTotal": 15, "correctReason": 15, "positiveTotal": 15, "positiveExact": 15}
                      for k in ("missing_unit", "rpe_scope", "unknown_exercise")},
            "challengePositive": {"total": 120, "exact": 120}}}}

    def test_actual_protocol_pins_only_new_objective_and_keeps_old_sources(self):
        actual = runner.load(runner.M4 / "train/protocol-v5.json")
        old = runner.load(runner.M4 / "train/protocol-v4.json")
        self.assertEqual(actual["trainingArgs"], old["trainingArgs"])
        self.assertEqual(actual["input"], old["inputs"]["enum"])
        self.assertEqual(actual["dataManifestCanonicalSha256"], old["dataManifestCanonicalSha256"])
        self.assertEqual(actual["gates"], old["gates"])
        self.assertEqual(actual["focusGates"], old["focusGates"])
        self.assertEqual((actual["trainingRuns"], actual["maximumModelPredictions"], actual["candidate"]), (2, 4160, "S"))
        self.assertEqual(actual["trainingMetrics"]["steps"], 800)
        self.assertEqual(actual["newStreamOrder"], list(runner.NEW))
        self.assertFalse(actual["releaseReady"])
        for name, expected in actual["sourceLfSha256"].items():
            self.assertEqual(hashlib.sha256((runner.ROOT / name).read_bytes().replace(b"\r\n", b"\n")).hexdigest(), expected, name)
        for name, expected in old["sourceLfSha256"].items():
            self.assertEqual(actual["sourceLfSha256"][name], expected)

    def test_assembly_keeps_exact_historical_bytes_and_input(self):
        self.out.mkdir(); runner.prepare(self.data, self.manifests, self.out, self.baseline, self.protocol)
        self.assertEqual((self.out / "H.jsonl").read_bytes(), (self.baseline / "D.jsonl").read_bytes())
        self.assertEqual((self.out / "all-eval.jsonl").read_bytes(), (self.baseline / "enum-eval.jsonl").read_bytes())
        self.assertEqual(len(list(self.out.glob("*.gold.jsonl"))), 3)

    def test_tampered_history_and_leaked_answer_stop_before_model_dispatch(self):
        for mode in ("history", "input", "assistant"):
            out = self.root / mode; out.mkdir()
            path = self.baseline / "D.jsonl" if mode == "history" else self.data / "v3/dev-eval.jsonl"
            old = path.read_bytes()
            if mode == "history": path.write_bytes(old + b" ")
            else:
                rows = runner.read(path)
                if mode == "assistant": rows[0]["messages"].append({"role": "assistant", "content": "answer"})
                else: rows[0]["messages"][1]["content"] = json.dumps({"exercises": [], "sentence": "changed"})
                self.jsonl(path, rows)
                self.manifests["v3"]["files"][path.name]["sha256"] = runner.digest(path)
            with self.assertRaises(ValueError): runner.prepare(self.data, self.manifests, out, self.baseline, self.protocol)
            self.assertFalse((out / "H.jsonl").exists())
            path.write_bytes(old)
            if mode != "history": self.manifests["v3"]["files"][path.name]["sha256"] = runner.digest(path)

    def test_failed_s_is_never_replaced_by_control_and_no_result_activates_native(self):
        self.seed_reports()
        result = runner.assess(self.out, self.protocol)
        self.assertTrue(result["developmentGatePassed"]); self.assertFalse(result["releaseReady"])
        runner.write_json(self.out / "metrics-S-challenge.json", {"exactRate": 0, "schemaValidRate": 1, "invented": 1})
        result = runner.assess(self.out, self.protocol)
        self.assertFalse(result["developmentGatePassed"]); self.assertEqual(result["candidate"], "S")
        self.assertFalse(result["checks"]["challengeNoInvented"])

    def test_clarifying_everything_wrong_reason_or_bad_training_cannot_pass(self):
        self.seed_reports()
        for mode, key in (("wrong-reason", "focusNegativeReasons"), ("all-clarify", "challengePositiveUseful"),
                          ("illegal", "clarificationVocabulary"), ("training", "fixedTraining")):
            with self.subTest(mode=mode):
                summary = self.summary()
                if mode == "wrong-reason": summary["arms"]["S"]["focus"]["rpe_scope"]["correctReason"] = 0
                elif mode == "all-clarify": summary["arms"]["S"]["challengePositive"]["exact"] = 0
                elif mode == "illegal": summary["arms"]["S"]["invalidClarificationReasons"] = 1
                else: runner.write_json(self.out / "S/model/train_metrics.json", {"steps": 2, "objective": "sample-mean-answer-token-ce"})
                runner.write_json(self.out / "loss-summary.json", summary)
                result = runner.assess(self.out, self.protocol)
                self.assertFalse(result["checks"][key]); self.assertFalse(result["developmentGatePassed"])

    def test_historical_failure_is_reported_but_any_candidate_format_truncation_fails(self):
        self.seed_reports()
        broken = self.predictions(); broken[0]["finishReason"] = "length"
        for arm in ("H", "T"):
            self.jsonl(self.out / f"{arm}.jsonl", broken)
        self.assertTrue(runner.assess(self.out, self.protocol)["checks"]["noTruncation"])
        for arm in runner.CANDIDATE_STREAMS:
            self.jsonl(self.out / f"{arm}.jsonl", broken)
            self.assertFalse(runner.assess(self.out, self.protocol)["checks"]["noTruncation"])
            self.jsonl(self.out / f"{arm}.jsonl", self.predictions())

    @unittest.skipUnless(os.name == "posix", "entry needs real GNU timeout/Linux")
    def test_two_fixed_trainings_four_streams_and_deadline_stop(self):
        (self.cache / "base/weights").write_bytes(b"base")
        (self.m4 / "train/base-model.sha256").write_text(runner.digest(self.cache / "base/weights") + " weights\n")
        archive = self.cache / "src/llama_cpp_python-0.3.36.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo("llama_cpp_python-0.3.36/vendor/llama.cpp/fixture"); info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
        (self.m4 / "train/llama-cpp-python.sha256").write_text(runner.digest(archive))
        calls = []
        def step(instance, name, args, allowed=(0,)):
            args = list(map(str, args)); calls.append((name, args)); target = instance.out
            if name in runner.NEW:
                self.jsonl(target / f"{name}.jsonl", self.predictions())
                runner.write_json(target / f"{name}.jsonl.audit.json", self.audit(name))
            elif name.startswith("train-"):
                path = Path(args[args.index("--out")+1]); path.mkdir(parents=True)
                metrics = {"steps": 800}
                if name == "train-S": metrics["objective"] = "sample-mean-answer-token-ce"
                runner.write_json(path / "train_metrics.json", metrics)
            elif name.startswith("agreement-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"items": 3, "missing": 0, "sameParsed": 3})
            elif name.startswith("metrics-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"exactRate": 1, "schemaValidRate": 1, "invented": 0})
            elif name.startswith("ground-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"accepted": 1, "unsafeAccepted": 0, "guarded": {"total": 1, "invented": 0}})
            elif name == "loss-summary": runner.write_json(target / "loss-summary.json", self.summary())
        argv = ["v5", "--cache", str(self.cache), "--out", str(self.out), "--baseline", str(self.baseline),
                "--commit", "reviewed", "--stop-at", str(time.time()+60)]
        with patch.object(runner, "ROOT", self.repo), patch.object(runner, "M4", self.m4), patch.object(sys, "argv", argv), \
             patch.object(runner.Budget, "step", step), \
             patch.object(runner.subprocess, "check_output", side_effect=lambda a, **kw: b"" if "status" in a else "reviewed\n"), \
             patch.object(runner.shutil, "disk_usage", return_value=SimpleNamespace(free=100*1024**3)):
            self.assertEqual(runner.main(), 0)
            self.assertEqual([n for n, _ in calls if n in runner.NEW], list(runner.NEW))
            trains = [(n, a) for n, a in calls if n.startswith("train-")]
            self.assertEqual([n for n, _ in trains], ["train-T", "train-S"])
            self.assertTrue(any(a.endswith("train/sft.py") for a in trains[0][1]))
            self.assertTrue(any(a.endswith("train/sft_sample_mean.py") for a in trains[1][1]))
            self.assertEqual(trains[0][1][trains[0][1].index("--base")+1], trains[1][1][trains[1][1].index("--base")+1])
            late = self.root / "late"; bad_args = list(argv); bad_args[bad_args.index("--out")+1] = str(late)
            def timeout_before_candidate(instance, name, args, allowed=(0,)):
                if name == "train-S": raise TimeoutError("original deadline")
                step(instance, name, args, allowed)
            with patch.object(sys, "argv", bad_args), patch.object(runner.Budget, "step", timeout_before_candidate):
                with self.assertRaises(TimeoutError): runner.main()
            self.assertEqual(runner.load(late / "run.json")["state"], "stopped")
            self.assertTrue((late / "sha256.json").exists())
            self.assertTrue((late / "T.jsonl").exists()); self.assertFalse((late / "S.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
