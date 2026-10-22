"""CPU file-contract/gate tests and mocked process dispatch; never model efficacy."""
import copy
import io
import hashlib
import json
import os
from pathlib import Path
import sys
import tarfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import run_v4 as runner
import test_v3_runner as fixtures


class V4RunnerTest(unittest.TestCase):
    jsonl = fixtures.V3RunnerTest.jsonl

    def setUp(self):
        fixtures.V3RunnerTest.setUp(self)
        self.baseline = self.root / "baseline"; (self.baseline / "gguf").mkdir(parents=True)
        self.manifests["v4"] = {"trainingSystem": "fixture", "enumEvaluationSystem": "fixture enum", "files": {}}
        (self.data / "v4").mkdir()
        for name in ("train", "dev"):
            p = self.data / f"v4/{name}.jsonl"; runner.jsonl(p, [{"id": name}])
            self.manifests["v4"]["files"][p.name] = {"sha256": runner.digest(p), "lines": 1}
        runner.write_json(self.m4 / "data/v4-manifest.json", self.manifests["v4"])
        self.rows = [r for v, name, _ in runner.SPLITS.values() for r in runner.read(self.data / v / f"{name}.jsonl")]
        runner.jsonl(self.baseline / "all-eval.jsonl", self.rows)
        enum = copy.deepcopy(self.rows)
        for row in enum: row["messages"][0]["content"] = "fixture enum"
        runner.jsonl(self.root / "enum.jsonl", enum)
        runner.jsonl(self.baseline / "quant.jsonl", [{"id": r["id"], "output": "{}", "finishReason": "stop"} for r in self.rows])
        self.protocol = {"candidate": "D", "maxSeconds": 10800, "quantization": "q8_0", "gates": runner.GATES,
            "focusGates": runner.FOCUS_GATES, "evaluationItems": 3, "maximumModelPredictions": 15, "trainingArgs": ["--device", "cuda"],
            "sourceLfSha256": {}, "baselineCommit": "archived", "inputs": {
                "short": {"sha256": runner.digest(self.baseline / "all-eval.jsonl"), "tokenIdsSha256": "short-tokens"},
                "enum": {"sha256": runner.digest(self.root / "enum.jsonl"), "tokenIdsSha256": "enum-tokens"}},
            "dataManifestCanonicalSha256": {v: runner.manifest_digest(self.m4 / f"data/{v}-manifest.json") for v in self.manifests}}
        runner.write_json(self.baseline / "quant.jsonl.audit.json", self.audit("A"))
        runner.write_json(self.baseline / "run.json", {"commit": "archived", "steps": [{"name": "quant", "exit": 0}]})
        (self.baseline / "gguf/parser-q8_0.gguf").write_bytes(b"baseline")
        self.protocol["baselineFiles"] = {p.relative_to(self.baseline).as_posix(): runner.digest(p) for p in self.baseline.rglob("*") if p.is_file()}
        runner.write_json(self.m4 / "train/protocol-v4.json", self.protocol)

    def audit(self, arm):
        inp = self.protocol["inputs"]["short" if arm in ("A", "C") else "enum"]
        hf = arm == "D-HF"
        return {"inputSha256": inp["sha256"], "tokenIdsSha256": inp["tokenIdsSha256"], "items": 3,
            "greedy": True, "repetitionPenalty": 1, "maxNewTokens": 256, "engine": "hf" if hf else "gguf",
            "threads": None if hf else 4, "prefillThreads": None if hf else 4, "resetBetweenItems": not hf}

    def test_actual_protocol_and_source_freeze(self):
        p = runner.load(runner.M4 / "train/protocol-v4.json")
        self.assertEqual(p["trainingArgs"], runner.load(runner.M4 / "train/protocol-v3.json")["trainingArgs"])
        self.assertEqual(p["maxSeconds"], 10800); self.assertEqual(p["maximumModelPredictions"], 5200)
        self.assertEqual(p["candidate"], "D"); self.assertEqual(p["gates"], runner.GATES)
        self.assertEqual(p["focusGates"], runner.FOCUS_GATES)
        for name, expected in p["sourceLfSha256"].items():
            self.assertEqual(hashlib.sha256((runner.ROOT / name).read_bytes().replace(b"\r\n", b"\n")).hexdigest(), expected, name)
        for v, expected in p["dataManifestCanonicalSha256"].items():
            self.assertEqual(runner.manifest_digest(runner.M4 / f"data/{v}-manifest.json"), expected)

    def test_cached_baseline_and_prompt_factor_bytes(self):
        self.out.mkdir(); runner.prepare(self.data, self.manifests, self.out, self.baseline, self.protocol)
        self.assertEqual((self.out / "A.jsonl").read_bytes(), (self.baseline / "quant.jsonl").read_bytes())
        enum = runner.read(self.out / "enum-eval.jsonl")
        for short, long in zip(self.rows, enum): self.assertEqual(short["messages"][1], long["messages"][1])
        self.assertNotEqual(runner.digest(self.out / "enum-eval.jsonl"), runner.digest(self.out / "all-eval.jsonl"))

    def test_corrupt_baseline_and_changed_input_stop_without_predictions(self):
        for mode in ("baseline", "input", "leak"):
            out = self.root / ("rejected-" + mode); out.mkdir()
            if mode == "baseline":
                p = self.baseline / "quant.jsonl"; old = p.read_bytes(); p.write_bytes(old + b" ")
            else:
                p = self.data / "v3/dev-eval.jsonl"; old = p.read_bytes(); rows = runner.read(p)
                if mode == "input": rows[0]["messages"][1]["content"] = json.dumps({"exercises": [], "sentence": "changed"})
                else: rows[0]["messages"].append({"role": "assistant", "content": "answer"})
                p.write_text(json.dumps(rows[0])+"\n")
                self.manifests["v3"]["files"][p.name]["sha256"] = runner.digest(p)
            with self.assertRaises(ValueError): runner.prepare(self.data, self.manifests, out, self.baseline, self.protocol)
            self.assertFalse((out / "A.jsonl").exists()); p.write_bytes(old)
            if mode != "baseline": self.manifests["v3"]["files"][p.name]["sha256"] = runner.digest(p)

    @unittest.skipUnless(os.name == "posix", "GNU-timeout process entry requires Linux")
    def test_dispatch_is_bounded_and_d_cannot_be_replaced_by_another_arm(self):
        base = self.cache / "base/weights"; base.write_bytes(b"base")
        (self.m4 / "train/base-model.sha256").write_text(runner.digest(base) + " weights\n")
        archive = self.cache / "src/llama_cpp_python-0.3.36.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo("llama_cpp_python-0.3.36/vendor/llama.cpp/fixture"); info.size = 1; tar.addfile(info, io.BytesIO(b"x"))
        (self.m4 / "train/llama-cpp-python.sha256").write_text(runner.digest(archive))
        calls = []
        def step(instance, name, args, allowed=(0,)):
            args = list(map(str, args)); calls.append((name, args)); target = instance.out
            if name in runner.NEW:
                runner.jsonl(target / f"{name}.jsonl", [{"id": r["id"], "output": "{}", "finishReason": "stop"} for r in self.rows])
                runner.write_json(target / f"{name}.jsonl.audit.json", self.audit(name))
            elif name.startswith("agreement-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"items": 3, "missing": 0, "sameParsed": 3})
            elif name.startswith("metrics-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"exactRate": 1, "schemaValidRate": 1, "invented": 0})
            elif name.startswith("ground-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"accepted": 1, "unsafeAccepted": 0, "guarded": {"total": 1, "invented": 0}})
            elif name == "factor-summary":
                runner.write_json(target / "factor-summary.json", {"arms": {"D": {"invalidClarificationReasons": 0,
                    "focus": {k: {"negativeTotal": 15, "correctReason": 15, "positiveTotal": 15, "positiveExact": 15} for k in ("missing_unit", "rpe_scope", "unknown_exercise")},
                    "challengePositive": {"total": 120, "exact": 120}}}})
        argv = ["v4", "--cache", str(self.cache), "--out", str(self.out), "--baseline", str(self.baseline), "--commit", "reviewed", "--stop-at", str(time.time()+60)]
        with patch.object(runner, "ROOT", self.repo), patch.object(runner, "M4", self.m4), patch.object(sys, "argv", argv), \
             patch.object(runner.Budget, "step", step), patch.object(runner.subprocess, "check_output", side_effect=lambda a, **kw: b"" if "status" in a else "reviewed\n"), \
             patch.object(runner.shutil, "disk_usage", return_value=SimpleNamespace(free=100*1024**3)):
            self.assertEqual(runner.main(), 0)
            bad = self.root / "stopped"; bad_args = list(argv); bad_args[bad_args.index("--out")+1] = str(bad)
            with patch.object(sys, "argv", bad_args), patch.object(runner.Budget, "step", side_effect=TimeoutError("deadline")) as stopped:
                with self.assertRaises(TimeoutError): runner.main()
                self.assertEqual(stopped.call_count, 1)
            self.assertEqual(runner.load(bad / "run.json")["state"], "stopped"); self.assertTrue((bad / "sha256.json").exists())
            complete_calls = list(calls)
            late = self.root / "late-stop"; bad_args[bad_args.index("--out")+1] = str(late)
            def stop_after_b(instance, name, args, allowed=(0,)):
                if name == "train": raise TimeoutError("no remaining work budget")
                step(instance, name, args, allowed)
            with patch.object(sys, "argv", bad_args), patch.object(runner.Budget, "step", stop_after_b):
                with self.assertRaises(TimeoutError): runner.main()
            self.assertTrue((late / "B.jsonl").exists()); self.assertFalse((late / "D-HF.jsonl").exists())
            self.assertEqual(runner.load(late / "run.json")["state"], "stopped")
            calls = complete_calls
        self.assertEqual([n for n, _ in calls if n in runner.NEW], list(runner.NEW))
        self.assertEqual(sum(n == "train" for n, _ in calls), 1); self.assertNotIn("A", dict(calls))
        for name in ("B", "D-HF", "D-F16", "D"): self.assertIn(str(self.out / "enum-eval.jsonl"), dict(calls)[name])
        self.assertIn(str(self.out / "all-eval.jsonl"), dict(calls)["C"])
        self.assertIn(str(self.cache / "base"), dict(calls)["train"])
        self.assertFalse(runner.assess(self.out, self.protocol)["releaseReady"])
        failures = [("metrics-D-challenge.json", lambda r: r.update(invented=1)),
            ("agreement-D-HF.json", lambda r: r.update(sameParsed=2)),
            ("D.jsonl.audit.json", lambda r: r.update(tokenIdsSha256="wrong")),
            ("factor-summary.json", lambda r: r["arms"]["D"].update(invalidClarificationReasons=1)),
            ("factor-summary.json", lambda r: r["arms"]["D"]["focus"]["missing_unit"].update(correctReason=0)),
            ("factor-summary.json", lambda r: r["arms"]["D"]["challengePositive"].update(exact=0))]
        for name, mutate in failures:
            p = self.out / name; old = p.read_bytes(); r = runner.load(p); mutate(r); runner.write_json(p, r)
            self.assertFalse(runner.assess(self.out, self.protocol)["developmentGatePassed"], name); p.write_bytes(old)
        p = self.out / "D.jsonl"; rows = runner.read(p); p.unlink(); runner.jsonl(p, list(reversed(rows)))
        self.assertFalse(runner.assess(self.out, self.protocol)["developmentGatePassed"])
        rows[0]["finishReason"] = "length"; p.unlink(); runner.jsonl(p, rows)
        self.assertFalse(runner.assess(self.out, self.protocol)["developmentGatePassed"])


if __name__ == "__main__": unittest.main()
