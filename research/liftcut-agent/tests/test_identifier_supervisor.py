from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))
from run_identifier_probe import main


class SupervisorTests(unittest.TestCase):
    def invoke(self, run, deadline, *, data_error=False):
        argv = ["probe", "--run-dir", str(run), "--controller-pid", "123", "--original-gpu-pid", "456",
                "--rollout-script", "original.py", "--model-dir", "weights", "--model-manifest", "weights.json",
                "--deadline", deadline, "--execute"]
        with patch("sys.argv", argv), patch("sys.platform", "linux"), \
                patch("run_identifier_probe.signal.SIGCONT", 18, create=True), \
                patch("run_identifier_probe.Path.read_bytes", return_value=("run_recovery_window.py " + str(run)).encode()), \
                patch("run_identifier_probe.process_state", side_effect=lambda pid: "T" if pid == 123 else None), \
                patch("run_identifier_probe.load_frozen", side_effect=ValueError("corrupt fixtures") if data_error else None), \
                patch("run_identifier_probe.command", return_value="a" * 40), \
                patch("run_identifier_probe.os.kill") as kill, \
                patch("run_identifier_probe.subprocess.run") as execute:
            result = main()
            kill.assert_called_once_with(123, signal.SIGCONT)
            return result, execute.call_args_list

    def test_data_failure_resumes_original_controller_without_gpu_call(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp)
            result, calls = self.invoke(run, (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(), data_error=True)
            self.assertEqual(result, 1)
            self.assertEqual(calls, [])
            status = json.loads((run / "identifier-probe/status.json").read_text())
            self.assertIn("corrupt fixtures", status["error"])

    def test_bad_deadline_also_resumes_validated_paused_controller(self):
        with tempfile.TemporaryDirectory() as temp:
            result, calls = self.invoke(Path(temp), "invalid-date")
            self.assertEqual(result, 1)
            self.assertEqual(calls, [])

    def test_soft_deadline_starts_no_evaluation(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp)
            report = run / "evaluation/mixed/report.json"
            report.parent.mkdir(parents=True)
            report.write_text("{}")
            result, calls = self.invoke(run, (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat())
            self.assertEqual(result, 1)
            self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
