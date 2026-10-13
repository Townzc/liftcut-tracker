import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("ci_tokenizer", Path(__file__).resolve().parents[2] / "tools/ci_tokenizer.py")
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class TokenizerCache(unittest.TestCase):
    def test_cached_bytes_are_verified_without_network_and_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / "cache"
            cache.mkdir()
            data = b"synthetic tokenizer"
            provenance = {"file_sha256": {"tokenizer.json": hashlib.sha256(data).hexdigest()}}
            (cache / "tokenizer.json").write_bytes(data)
            (cache / "tokenizer-provenance.json").write_text(json.dumps(provenance))
            fetch = lambda _: self.fail("cache hit must not fetch")
            ci.prepare(root / "new/output", cache, provenance, fetch)
            self.assertEqual((root / "new/output/tokenizer.json").read_bytes(), data)
            with self.assertRaisesRegex(ValueError, "already exists"):
                ci.prepare(root / "new/output", cache, provenance, fetch)
            (cache / "tokenizer.json").write_bytes(b"altered")
            with self.assertRaisesRegex(ValueError, "hash differs"):
                ci.prepare(root / "other", cache, provenance, fetch)
            self.assertFalse((root / "other").exists())

    def test_rate_limit_retry_is_bounded(self):
        delays = []
        calls = []
        def run(*args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess([], 2, "", "error: HTTP Error 429: Too Many Requests")
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "429"):
                ci.fetch_with_retry(Path(tmp) / "missing", run, delays.append)
        self.assertEqual(delays, [20, 60, 120])
        self.assertEqual(len(calls), 4)

    def test_hash_mismatch_is_not_retried(self):
        result = subprocess.CompletedProcess([], 2, "", "error: download hash or size mismatch")
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "hash or size"):
                ci.fetch_with_retry(Path(tmp) / "missing", lambda *a, **k: result,
                                    lambda _: self.fail("must not retry corruption"))

    def test_transient_failure_then_success(self):
        results = iter([subprocess.CompletedProcess([], 2, "", "HTTP Error 503: unavailable"),
                        subprocess.CompletedProcess([], 0, "", "")])
        delays = []
        with tempfile.TemporaryDirectory() as tmp:
            ci.fetch_with_retry(Path(tmp) / "missing", lambda *a, **k: next(results), delays.append)
        self.assertEqual(delays, [20])


if __name__ == "__main__":
    unittest.main()
