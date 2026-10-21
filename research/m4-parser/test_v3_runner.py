"""No model imports or GPU. Real input assembly plus mocked process orchestration."""
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
import run_v3 as runner


class V3RunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.repo = self.root / "repo"; self.m4 = self.repo / "research/m4-parser"
        self.cache = self.root / "cache"; self.out = self.root / "out"; self.data = self.m4 / "data/generated"
        for p in (self.data / "v2", self.data / "v3", self.m4 / "train", self.cache / "base", self.cache / "src"):
            p.mkdir(parents=True)
        self.manifests = {v: {"files": {}} for v in ("v2", "v3")}
        for split, (version, name, gold) in runner.SPLITS.items():
            user = json.dumps({"exercises": ["synthetic"], "sentence": "synthetic"})
            for filename, rows in [(name + ".jsonl", [{"id": split, "messages": [{"role": "system", "content": "fixture"}, {"role": "user", "content": user}]}]),
                (gold + ".gold.jsonl", [{"id": split, "label": {"intent": "record"}}])]:
                p = self.data / version / filename; self.jsonl(p, rows)
                self.manifests[version]["files"][filename] = {"sha256": runner.digest(p), "lines": 1}
        for v, m in self.manifests.items(): runner.write_json(self.m4 / f"data/{v}-manifest.json", m)

    def jsonl(self, p, rows):
        p.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")

    def test_assembly_checks_bytes_and_keeps_development_distinct(self):
        self.out.mkdir(); rows = runner.assemble(self.data, self.manifests, self.out)
        self.assertEqual([r["id"] for r in rows], list(runner.SPLITS))
        self.assertEqual(len(list(self.out.glob("*.gold.jsonl"))), 3)
        bad = self.data / "v3/dev-eval.jsonl"; bad.write_text('{}\n')
        with self.assertRaisesRegex(ValueError, "manifest mismatch"): runner.assemble(self.data, self.manifests, self.out)

    def test_changed_messages_and_missing_predictions_rejected(self):
        bad = self.data / "v3/dev-eval.jsonl"
        self.jsonl(bad, [{"id": "dev-eval", "messages": [{"role": "assistant", "content": "leaked answer"}]}])
        self.manifests["v3"]["files"][bad.name]["sha256"] = runner.digest(bad)
        self.out.mkdir()
        with self.assertRaisesRegex(ValueError, "answer/history"): runner.assemble(self.data, self.manifests, self.out)
        for split in runner.SPLITS: self.jsonl(self.out / f"{split}.gold.jsonl", [{"id": split}])
        self.jsonl(self.out / "quant.jsonl", [{"id": "wrong"}])
        with self.assertRaisesRegex(ValueError, "prediction IDs"): runner.partition(self.out, "quant")

    def test_manifest_hash_is_portable_across_checkout_line_endings(self):
        p = self.m4 / "data/v3-manifest.json"; before = runner.manifest_digest(p)
        p.write_bytes(p.read_bytes().replace(b"\n", b"\r\n"))
        self.assertEqual(runner.manifest_digest(p), before)

    @unittest.skipUnless(os.name == "posix", "GNU timeout entry requires Linux")
    def test_full_pipeline_and_negative_gates_do_not_activate(self):
        base = self.cache / "base/weights"; base.write_bytes(b"base")
        previous = self.cache / "previous.gguf"; previous.write_bytes(b"previous")
        (self.m4 / "train/base-model.sha256").write_text(runner.digest(base) + " weights\n")
        archive = self.cache / "src/llama_cpp_python-0.3.36.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo("llama_cpp_python-0.3.36/vendor/llama.cpp/fixture"); info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
        (self.m4 / "train/llama-cpp-python.sha256").write_text(runner.digest(archive))
        protocol = {"maxSeconds": 10800, "quantization": "q8_0", "gates": runner.GATES, "previousQ8Sha256": runner.digest(previous),
            "dataManifestCanonicalSha256": {v: runner.manifest_digest(self.m4 / f"data/{v}-manifest.json") for v in self.manifests},
            "evaluationItems": 3, "maximumModelPredictions": 12, "trainingArgs": ["--device", "cuda"]}
        runner.write_json(self.m4 / "train/protocol-v3.json", protocol); calls = []
        def step(instance, name, args, allowed=(0,)):
            args = list(map(str, args)); calls.append((name, args))
            if name in runner.ARMS:
                self.jsonl(self.out / f"{name}.jsonl", [{"id": s, "output": "{}", "finishReason": "stop"} for s in runner.SPLITS])
                runner.write_json(self.out / f"{name}.jsonl.audit.json", {"items": 3, "inputSha256": "input", "tokenIdsSha256": "tokens"})
            elif name.startswith("agreement-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"items": 3, "missing": 0, "sameParsed": 3})
            elif name.startswith("metrics-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"exactRate": 1, "schemaValidRate": 1, "invented": 0})
            elif name.startswith("ground-"):
                runner.write_json(Path(args[args.index("--out")+1]), {"accepted": 1, "unsafeAccepted": 0, "guarded": {"total": 1, "invented": 0}})
        def git(args, **kwargs): return b"" if "status" in args else "reviewed\n"
        with patch.object(runner, "ROOT", self.repo), patch.object(runner, "M4", self.m4), patch.object(runner.Budget, "step", step), \
            patch.object(runner.subprocess, "check_output", git), patch.object(runner.shutil, "disk_usage", return_value=SimpleNamespace(free=100*1024**3)), \
            patch.object(sys, "argv", ["v3", "--cache", str(self.cache), "--out", str(self.out), "--previous-gguf", str(previous),
                "--commit", "reviewed", "--stop-at", str(time.time()+60)]):
            self.assertEqual(runner.main(), 0)
        training = dict(calls)["train"]
        self.assertTrue(training[training.index("--train")+1].endswith("generated/v3/train.jsonl"))
        self.assertEqual(training[training.index("--base")+1], str(self.cache / "base"))
        self.assertTrue((self.out / "sha256.json").exists()); self.assertFalse(runner.assess(self.out)["releaseReady"])
        for name, report in [("metrics-quant-challenge.json", {"exactRate": 1, "schemaValidRate": 1, "invented": 1}),
            ("agreement-merged.json", {"items": 3, "missing": 0, "sameParsed": 2})]:
            before = (self.out / name).read_bytes(); runner.write_json(self.out / name, report)
            self.assertFalse(runner.assess(self.out)["developmentGatePassed"]); (self.out / name).write_bytes(before)
        rows = runner.read(self.out / "quant.jsonl"); rows[0]["finishReason"] = "length"
        self.jsonl(self.out / "quant.jsonl", rows); self.assertFalse(runner.assess(self.out)["developmentGatePassed"])


if __name__ == "__main__": unittest.main()
