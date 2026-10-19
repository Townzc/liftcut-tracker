"""Exercise the M4 shell runner with local fakes: no GPU, packages, model or network."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest


RUNNER = Path(os.environ.get("M4_RUNNER", Path(__file__).with_name("run_all.sh")))


@unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "requires Linux bash and GNU timeout")
class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runner = self.root / "research/m4-parser/run_all.sh"
        self.runner.parent.mkdir(parents=True)
        self.runner.write_text(RUNNER.read_text(), encoding="utf-8")
        self.work = self.root / "work"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.bin / "python3").symlink_to(sys.executable)
        self.fake("node", "exit 0")
        self.fake("git", "printf '%040d\\n' 1")
        self.fake("df", "printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 1 1 104857600 1%% /\\n'")
        self.fake("nvidia-smi", "exit 42")
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "WORK_DIR": str(self.work), "SMOKE": "0", "MAX_SECONDS": "30"}

    def fake(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/bash\n" + body + "\n")
        path.chmod(0o755)

    def invoke(self, command=None, **env):
        args = ["bash", str(self.runner)] if command is None else [
            "bash", "-c", f"source {shlex.quote(str(self.runner))}; {command}"]
        return subprocess.run(args, env={**self.env, **env}, capture_output=True, text=True, timeout=20)

    def summary(self):
        paths = list(self.runner.parent.glob("results/*/run.json"))
        self.assertEqual(len(paths), 1)
        return json.loads(paths[0].read_text())

    def torch_fixture(self):
        modules = self.root / "modules"
        modules.mkdir()
        (modules / "torch.py").write_text(
            "import os\n__version__ = 'test'\n"
            "class cuda:\n"
            "    @staticmethod\n"
            "    def is_available(): return os.environ.get('FAKE_CUDA') == '1'\n")
        python = self.work / "venv/bin/python"
        python.parent.mkdir(parents=True)
        python.symlink_to(sys.executable)
        return {"PYTHONPATH": str(modules)}

    def test_full_run_reaches_environment_check_and_records_failure(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 42, result.stdout + result.stderr)
        run = self.summary()
        self.assertEqual((run["state"], run["lastStep"], run["smoke"]), ("failed", "env", False))
        self.assertEqual([s["step"] for s in run["steps"]], ["env"])

    def test_full_run_rejects_cpu_only_torch(self):
        result = self.invoke("check_torch", **self.torch_fixture(), FAKE_CUDA="0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("CUDA is required", result.stdout + result.stderr)

    def test_full_run_accepts_cuda_torch(self):
        result = self.invoke("check_torch", **self.torch_fixture(), FAKE_CUDA="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_smoke_still_accepts_cpu(self):
        result = self.invoke("check_torch", **self.torch_fixture(), FAKE_CUDA="0", SMOKE="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_train_explicitly_selects_full_or_smoke_device(self):
        python = self.work / "venv/bin/python"
        python.parent.mkdir(parents=True)
        python.write_text("#!/bin/bash\nprintf '%s\\n' \"$@\"\n")
        python.chmod(0o755)
        for smoke, device in [("0", "cuda"), ("1", "cpu")]:
            with self.subTest(smoke=smoke):
                result = self.invoke("train", SMOKE=smoke)
                self.assertEqual(result.returncode, 0, result.stderr)
                args = result.stdout.splitlines()
                self.assertEqual(args[args.index("--device") + 1], device)
                self.assertEqual("--max-steps" in args, smoke == "1")

    def test_timeout_kills_term_ignoring_step_and_records_timeout(self):
        result = self.invoke("stall() { trap '' TERM; sleep 60; }; export -f stall; step stuck stall", MAX_SECONDS="1")
        self.assertIn(result.returncode, (124, 137), result.stdout + result.stderr)
        self.assertEqual((self.summary()["state"], self.summary()["lastStep"]), ("timeout", "stuck"))

    def test_early_kill_exit_is_not_misreported_as_timeout(self):
        result = self.invoke("crash() { return 137; }; export -f crash; step killed crash")
        self.assertEqual(result.returncode, 137, result.stdout + result.stderr)
        self.assertEqual(self.summary()["state"], "failed")

    def test_unsupported_python_stops_environment_check(self):
        self.fake("nvidia-smi", "exit 0")
        result = self.invoke("python3() { return 42; }; check_env")
        self.assertEqual(result.returncode, 42, result.stdout + result.stderr)

    def test_invalid_time_budget_stops_before_creating_run(self):
        for seconds in ("0", "-1", "invalid"):
            with self.subTest(seconds=seconds):
                result = self.invoke(MAX_SECONDS=seconds)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("MAX_SECONDS", result.stderr)
                self.assertFalse((self.runner.parent / "results").exists())


if __name__ == "__main__":
    unittest.main()
