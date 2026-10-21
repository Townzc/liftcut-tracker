"""Process and gate regressions without model imports, downloads or GPU access."""
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import tarfile
from types import SimpleNamespace

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
import run_v2 as runner
from train.acceptance_v2 import assess


class V2RunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = self.root / "data"; self.data.mkdir()
        self.out = self.root / "out"; self.out.mkdir(); (self.out / "logs").mkdir()

    def jsonl(self, path, rows):
        path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

    def test_manifest_drift_and_leaked_answers_fail_before_inference(self):
        files = {}
        for name in runner.SPLITS:
            path = self.data / f"{name}.jsonl"
            self.jsonl(path, [{"id": name, "messages": [{"role": "user", "content": "fixture"}]}])
            files[path.name] = {"sha256": runner.digest(path), "lines": 1}
        bad = self.data / "challenge.jsonl"
        bad.write_text('{"id":"changed","messages":[]}\n')
        with self.assertRaisesRegex(ValueError, "manifest mismatch"):
            runner.assemble(self.data, {"files": files}, self.out)
        self.jsonl(bad, [{"id": "changed", "messages": [{"role": "assistant", "content": "answer"}]}])
        files[bad.name]["sha256"] = runner.digest(bad)
        with self.assertRaisesRegex(ValueError, "answer"):
            runner.assemble(self.data, {"files": files}, self.out)
        self.assertFalse((self.out / "all-eval.jsonl").exists())

    def test_partition_rejects_extra_or_missing_predictions(self):
        for name in runner.SPLITS:
            self.jsonl(self.data / f"{name}.gold.jsonl", [{"id": name}])
        self.jsonl(self.out / "quant.jsonl", [{"id": "wrong"}])
        with self.assertRaisesRegex(ValueError, "IDs differ"):
            runner.partition(self.out, self.data, "quant")

    @unittest.skipUnless(os.name == "posix", "full entry requires Linux")
    def test_full_entry_uses_v2_data_and_collects_a_complete_no_model_run(self):
        repo = self.root / "repo"; m4 = repo / "research/m4-parser"; cache = self.root / "cache"
        for path in (m4 / "data/generated/v2", m4 / "train", cache / "base", cache / "src", cache / "model/merged"):
            path.mkdir(parents=True)
        (cache / "base/base").write_bytes(b"base")
        (cache / "model/merged/model.safetensors").write_bytes(b"old")
        (m4 / "train/base-model.sha256").write_text(runner.digest(cache / "base/base") + "  base\n")
        archive = cache / "src/llama_cpp_python-0.3.36.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo("llama_cpp_python-0.3.36/vendor/llama.cpp/fixture"); info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
        (m4 / "train/llama-cpp-python.sha256").write_text(runner.digest(archive))
        files = {}
        for name in runner.SPLITS:
            for suffix, rows in [("jsonl", [{"id": name, "messages": []}]),
                                 ("gold.jsonl", [{"id": name, "label": {"intent": "record"}}])]:
                path = m4 / f"data/generated/v2/{name}.{suffix}"; self.jsonl(path, rows)
                files[path.name] = {"sha256": runner.digest(path), "lines": 1}
        manifest = {"files": files}; runner.write_json(m4 / "data/v2-manifest.json", manifest)
        protocol = {"maxSeconds": 10800, "oldMergedSha256": runner.digest(cache / "model/merged/model.safetensors"),
                    "dataManifestCanonicalSha256": runner.hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest(),
                    "quantization": "q4_k_m", "gates": runner.GATES, "trainingArgs": ["--device", "cuda", "--batch", "16"]}
        runner.write_json(m4 / "train/protocol-v2.json", protocol)
        output = self.root / "fresh"; calls = []
        def fake_step(instance, name, args, allowed=(0,)):
            args = list(map(str, args)); calls.append((name, args))
            if name in ("old-new-prompt", "merged", "f16", "quant"):
                self.jsonl(output / f"{name}.jsonl", [{"id": split, "output": "{}", "finishReason": "stop"} for split in runner.SPLITS])
                runner.write_json(output / f"{name}.jsonl.audit.json", {"items": 4, "inputSha256": "input", "tokenIdsSha256": "tokens"})
            elif name.startswith("agreement-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"items": 4, "missing": 0, "sameParsed": 4})
            elif name.startswith("score-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"exactRate": 1, "schemaValidRate": 1, "invented": 0})
            elif name.startswith("ground-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"accepted": 1, "unsafeAccepted": 0, "guarded": {"total": 1, "invented": 0}})
        def git(args, **kwargs):
            return b"" if "status" in args else "reviewed\n"
        with patch.object(runner, "ROOT", repo), patch.object(runner, "M4", m4), patch.object(runner.Budget, "step", fake_step), \
             patch.object(runner.subprocess, "check_output", git), patch.object(runner.shutil, "which", return_value="timeout"), \
             patch.object(runner.shutil, "disk_usage", return_value=SimpleNamespace(free=100*1024**3)), \
             patch.object(sys, "argv", ["run_v2", "--cache", str(cache), "--out", str(output), "--commit", "reviewed", "--stop-at", str(time.time()+60)]):
            runner.main()
        names = [name for name, _ in calls]
        self.assertLess(names.index("old-new-prompt"), names.index("train"))
        train = dict(calls)["train"]
        self.assertTrue(train[train.index("--train")+1].endswith("generated/v2/train.jsonl"))
        self.assertIn("--device", train); self.assertIn("cuda", train)
        self.assertEqual(json.loads((output / "run.json").read_text())["state"], "candidate-passed-not-release")
        self.assertIn("quant.jsonl", json.loads((output / "sha256.json").read_text()))

    def gate_fixture(self):
        for name in ("old-new-prompt", "merged", "f16", "quant"):
            runner.write_json(self.out / f"{name}.jsonl.audit.json", {"items": 4, "inputSha256": "input", "tokenIdsSha256": "tokens"})
        for split in runner.SPLITS:
            self.jsonl(self.data / f"{split}.gold.jsonl", [{"id": split, "label": {"intent": "record"}}])
            runner.write_json(self.out / f"ground-quant-{split}.json", {"accepted": 1, "unsafeAccepted": 0, "guarded": {"total": 1, "invented": 0}})
        self.jsonl(self.out / "quant.jsonl", [{"id": name, "finishReason": "stop"} for name in runner.SPLITS])
        for name in ("merged", "f16"):
            runner.write_json(self.out / f"agreement-{name}.json", {"items": 4, "missing": 0, "sameParsed": 4})
        runner.write_json(self.out / "metrics-quant-challenge.json", {"exactRate": 1, "schemaValidRate": 1, "invented": 0})

    def test_passing_candidate_is_never_release_permission(self):
        self.gate_fixture()
        result = assess(self.out, self.data)
        self.assertTrue(result["candidatePassed"])
        self.assertFalse(result["releaseReady"])

    def test_all_clarify_unsafe_and_truncation_cannot_pass(self):
        self.gate_fixture()
        path = self.out / "ground-quant-challenge.json"
        for accepted, unsafe in [(0, 0), (1, 1)]:
            runner.write_json(path, {"accepted": accepted, "unsafeAccepted": unsafe, "guarded": {"total": 1, "invented": 0}})
            self.assertFalse(assess(self.out, self.data)["candidatePassed"])
        self.gate_fixture()
        self.jsonl(self.out / "quant.jsonl", [{"id": name, "finishReason": "length"} for name in runner.SPLITS])
        self.assertFalse(assess(self.out, self.data)["candidatePassed"])

    def test_raw_disagreement_token_drift_and_invented_fields_fail(self):
        for name, contents, check in [
            ("agreement-merged.json", {"items": 4, "missing": 0, "sameParsed": 3}, "rawAgreement"),
            ("quant.jsonl.audit.json", {"items": 4, "inputSha256": "input", "tokenIdsSha256": "changed"}, "sameInputTokens"),
            ("metrics-quant-challenge.json", {"exactRate": 1, "schemaValidRate": 1, "invented": 1}, "challengeNoInvented"),
        ]:
            self.gate_fixture(); runner.write_json(self.out / name, contents)
            report = assess(self.out, self.data)
            self.assertFalse(report["checks"][check])
            self.assertFalse(report["candidatePassed"])

    def test_expired_budget_does_not_dispatch(self):
        budget = runner.Budget(self.out, time.time() - 1, 30)
        with self.assertRaises(TimeoutError): budget.step("expired", [sys.executable, "-c", "raise RuntimeError()"])
        self.assertFalse((self.out / "logs/expired.log").exists())

    @unittest.skipUnless(os.name == "posix", "GNU timeout process groups require Linux")
    def test_timeout_kills_term_ignoring_worker_and_preserves_log(self):
        budget = runner.Budget(self.out, time.time() + 1, 1)
        with self.assertRaises(RuntimeError):
            budget.step("hang", [sys.executable, "-c", "import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)"])
        # Python reports direct SIGKILL as -9; a shell reports the same as 137.
        self.assertIn(budget.report["steps"][0]["exit"], (124, 137, -9))
        self.assertTrue((self.out / "logs/hang.log").is_file())


class BaselineRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.old = self.root / "old"; self.out = self.root / "new"
        self.old.mkdir(); self.out.mkdir(); (self.old / "logs").mkdir()
        self.protocol = json.loads((ROOT / "train/protocol-v2.json").read_text())
        old_protocol = dict(self.protocol, trainingArgs=self.protocol["trainingArgs"][:-1])
        runner.write_json(self.old / "run.json", {"state": "stopped", "commit": "8520b9db248e5c61f4acaf2abc94b3f00dddad64",
            "stopAt": 100, "protocol": old_protocol, "steps": [{"name": "old-new-prompt", "exit": 0}, {"name": "train", "exit": 1}]})
        (self.old / "all-eval.jsonl").write_text('{"id":"one"}\n')
        (self.old / "data-manifest.json").write_text('{}\n')
        (self.old / "logs/train.log").write_text('torch.OutOfMemoryError: test')
        (self.old / "old-new-prompt.jsonl").write_text('{"id":"one","output":"raw"}\n')
        runner.write_json(self.old / "old-new-prompt.jsonl.audit.json", {"items": 1,
            "inputSha256": runner.digest(self.old / "all-eval.jsonl"), "tokenIdsSha256": "tokens"})
        for name in ("all-eval.jsonl", "data-manifest.json"):
            (self.out / name).write_bytes((self.old / name).read_bytes())
        self.m4 = self.root / "m4"; (self.m4 / "train").mkdir(parents=True)
        (self.m4 / "train/predict.py").write_bytes(b"fixed inference")
        self.seal()

    def seal(self):
        runner.write_json(self.old / "sha256.json", {p.relative_to(self.old).as_posix(): runner.digest(p)
            for p in self.old.rglob("*") if p.is_file() and p.name != "sha256.json"})
        self.sha = runner.digest(self.old / "sha256.json")

    def recover(self, stop=100, source=b"fixed inference"):
        with patch.object(runner, "M4", self.m4), patch.object(runner.subprocess, "check_output", return_value=source):
            return runner.reuse_baseline(self.old, self.sha, self.out, self.protocol, stop)

    def test_reuses_raw_bytes_once_and_keeps_original_deadline(self):
        result = self.recover()
        self.assertEqual(result["originalStopAt"], 100)
        self.assertEqual((self.out / "old-new-prompt.jsonl").read_bytes(), (self.old / "old-new-prompt.jsonl").read_bytes())
        with self.assertRaises(FileExistsError): self.recover()

    def test_rejects_tampered_manifest_and_raw_output(self):
        saved = self.sha; self.sha = "wrong"
        with self.assertRaisesRegex(ValueError, "manifest mismatch"): self.recover()
        self.sha = saved; (self.old / "old-new-prompt.jsonl").write_text('{}\n')
        with self.assertRaisesRegex(ValueError, "file mismatch"): self.recover()

    def test_rejects_extended_deadline_changed_source_and_batch(self):
        with self.assertRaisesRegex(ValueError, "deadline"): self.recover(stop=101)
        with self.assertRaisesRegex(ValueError, "source changed"): self.recover(source=b"changed")
        self.protocol["trainingArgs"][3] = "8"
        with self.assertRaisesRegex(ValueError, "only activation"): self.recover()

    def test_rejects_partial_predictions_even_with_valid_file_hash(self):
        (self.old / "old-new-prompt.jsonl").write_text('{"id":"different"}\n'); self.seal()
        with self.assertRaisesRegex(ValueError, "incomplete"): self.recover()

    def test_rejects_new_inputs_and_exported_candidate(self):
        (self.out / "all-eval.jsonl").write_text('{"id":"changed"}\n')
        with self.assertRaisesRegex(ValueError, "inputs changed"): self.recover()
        (self.out / "all-eval.jsonl").write_bytes((self.old / "all-eval.jsonl").read_bytes())
        (self.old / "model").mkdir(); (self.old / "model/adapter").write_bytes(b"weights")
        with self.assertRaisesRegex(ValueError, "no exported candidate"): self.recover()


if __name__ == "__main__": unittest.main()
