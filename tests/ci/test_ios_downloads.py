import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SPEC = importlib.util.spec_from_file_location("ios_downloads", Path(__file__).resolve().parents[2] / "scripts/prepare-ios-downloads.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class PreparationTests(unittest.TestCase):
    def test_all_sources_checked_before_writes_and_repeat_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "package.json").write_text(json.dumps({"version": "0.88.0"}))
            before = b'`curl -sL "https://example.invalid/artifact.sha1"`\n'
            spec = {name: (hashlib.sha256(before).hexdigest(), 1) for name in ["one.rb", "two.rb"]}
            for name in spec:
                (root / name).write_bytes(before)
            (root / "two.rb").write_bytes(before + b"unexpected")
            with self.assertRaises(ValueError):
                MOD.prepare(root, spec)
            self.assertEqual((root / "one.rb").read_bytes(), before)
            (root / "two.rb").write_bytes(before)
            MOD.prepare(root, spec)
            patched = (root / "one.rb").read_bytes()
            MOD.prepare(root, spec)
            self.assertEqual((root / "one.rb").read_bytes(), patched)
            (root / "package.json").write_text(json.dumps({"version": "0.89.0"}))
            with self.assertRaises(ValueError):
                MOD.prepare(root, spec)
            self.assertEqual((root / "one.rb").read_bytes(), patched)

    def test_missing_checksum_is_refused_and_partial_patch_is_not_accepted(self):
        for guard in MOD.GUARDS.values():
            before = ('`curl -sL "https://example.invalid/a.sha1"`\n' + guard).encode()
            digest = hashlib.sha256(before).hexdigest()
            after = MOD.transformed(before, digest, 1, guard)
            self.assertIn(b"Refusing artifact.", after)
            self.assertIn(b"return false", after)
            self.assertNotIn(b"Skipping validation.", after)
            with self.assertRaises(ValueError):
                MOD.transformed(before.replace(b"`curl ", MOD.BOUNDED.encode()), digest, 1, guard)


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.curl = shutil.which("curl")
        if not self.curl:
            self.fail("curl is required for the CI download fault tests")
        self.requests = {}
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                owner.requests[self.path] = owner.requests.get(self.path, 0) + 1
                status = 503 if self.path == "/unavailable" or (self.path == "/retry" and owner.requests[self.path] == 1) else 200
                payload = b"tiny synthetic artifact"
                self.send_response(status)
                self.send_header("Content-Length", str(len(payload) if self.path != "/truncated" else len(payload) * 2))
                self.end_headers()
                if self.path == "/slow":
                    time.sleep(2)
                try:
                    self.wfile.write(payload)
                    if self.path == "/truncated":
                        self.connection.shutdown(socket.SHUT_RDWR)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def fetch(self, path):
        # Same options; shorten only the test time budgets to exercise failures promptly.
        options = MOD.OPTIONS.split()
        for name, value in {"--connect-timeout": "1", "--max-time": "1", "--speed-time": "1", "--retry-delay": "0", "--retry-max-time": "4"}.items():
            options[options.index(name) + 1] = value
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "artifact.download"
            started = time.monotonic()
            result = subprocess.run([self.curl, *options, f"http://127.0.0.1:{self.server.server_port}{path}", "-Lo", str(output)], capture_output=True, timeout=9)
            elapsed = time.monotonic() - started
            return result.returncode, output.read_bytes() if output.exists() else b"", elapsed

    def test_transient_503_retries_and_replaces_temporary_output(self):
        code, payload, _ = self.fetch("/retry")
        self.assertEqual(code, 0)
        self.assertEqual(payload, b"tiny synthetic artifact")
        self.assertEqual(self.requests["/retry"], 2)

    def test_permanent_error_truncation_and_stall_fail_with_bounded_attempts(self):
        for path in ["/unavailable", "/truncated", "/slow"]:
            with self.subTest(path=path):
                code, _, elapsed = self.fetch(path)
                self.assertNotEqual(code, 0)
                self.assertLessEqual(self.requests[path], 3)
                self.assertLess(elapsed, 8)


if __name__ == "__main__":
    unittest.main()
