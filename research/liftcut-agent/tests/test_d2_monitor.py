"""Offline collector tests: bindings, unsafe paths, transfer and replay gates."""
from copy import deepcopy
from datetime import timedelta
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import d2_execution as d2
import monitor_counterfactual_diagnostics as monitor
from d2_receipt_transfer import validate_index
from liftcut_agent.interactive import digest
from server_workspace import dump_new


class MonitorTests(unittest.TestCase):
    def config(self):
        raw = d2.read(ROOT / "configs/d2-monitor.template.json")
        raw.update(booted_at="2026-10-02T12:00:00+00:00", execution_commit="a" * 40)
        return raw

    def remote(self):
        cfg = monitor.parse_config(self.config())
        plan = d2.read(d2.REVIEWED)
        bind = d2.binding(plan, cfg["execution_commit"], cfg["booted_at"].isoformat())
        opening = {"binding": bind, "booted_at_proxy": cfg["booted_at"].isoformat(), "budget": d2.BUDGET,
                   "evidence_kind": "model", "started_at_utc": "2026-10-02T12:02:00+00:00"}
        argv = ["python", f'/root/autodl-tmp/liftcut/code/{cfg["execution_commit"]}/research/liftcut-agent/run_counterfactual_window.py']
        for flag, val in {"--model-dir": "model", "--model-manifest": "manifest", "--prepared-dir": "prepared",
            "--adapters-root": "adapters", "--tokenizer-dir": "tokenizer", "--output-dir": cfg["remote_run"],
            "--expected-code-commit": cfg["execution_commit"], "--hourly-cny": "2.18", "--booted-at": cfg["booted_at"].isoformat(),
            "--setup-guard": cfg["remote_ops"] + "/setup-guard.jsonl"}.items():
            argv.extend([flag, val])
        argv.extend(["--execute", "--shutdown-when-done"])
        launch = {"argv": argv, "at_utc": "2026-10-02T12:02:00+00:00", "booted_at_proxy": cfg["booted_at"].isoformat()}
        guards = [{"status": "armed", "deadline": bind["hard_cutoff"]}]
        return cfg, plan, opening, launch, guards, deepcopy(guards)

    def test_original_remote_opening_and_both_guards(self):
        args = self.remote()
        self.assertEqual(monitor.validate_remote(*args), args[2]["binding"])
        args[-1][0]["deadline"] = "2026-10-02T15:00:00+00:00"
        with self.assertRaises(ValueError):
            monitor.validate_remote(*args)

    def test_duplicate_abbreviated_extra_or_late_launch_rejected(self):
        for change in ("duplicate", "abbreviated", "extra", "late", "other_commit"):
            args = self.remote()
            launch = args[3]
            if change == "duplicate":
                launch["argv"].extend(["--hourly-cny", "2.18"])
            elif change == "abbreviated":
                launch["argv"][-1] = "--shutdown"
            elif change == "extra":
                launch["argv"].append("--train")
            elif change == "late":
                launch["at_utc"] = "2026-10-02T12:11:00+00:00"
            else:
                launch["argv"][1] = launch["argv"][1].replace("a" * 40, "b" * 40)
            with self.subTest(change=change), self.assertRaises(ValueError):
                monitor.validate_remote(*args)

    def test_config_credentials_traversal_or_overlap_rejected(self):
        for key, value in (("password", "NEVER-REAL"), ("remote_run", "/root/autodl-tmp/liftcut/runs/../escape"),
                           ("downloads", self.config()["prepared"]), ("hourly_cny", 3), ("ssh_port", True)):
            cfg = {**self.config(), key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                monitor.parse_config(cfg)

    def test_restore_failure_never_constructs_or_uploads_receipt(self):
        cfg = monitor.parse_config(self.config())
        with tempfile.TemporaryDirectory() as tmp:
            cfg.update(operations=Path(tmp), downloads=Path(tmp), restored=Path(tmp) / "new")
            budget = SimpleNamespace(remaining=lambda: 600, deadline=d2.aware("2026-10-02T14:00:00+00:00"))
            def fail(*_a, **_k):
                raise RuntimeError("synthetic restorer failure")
            with patch.object(monitor, "transfer_receipt") as transfer:
                with self.assertRaises(RuntimeError):
                    monitor.restore_and_publish(None, {"archive": "evidence.tar.gz", "status": "complete"},
                        cfg, {}, budget, lambda *_a, **_k: None, runner=fail)
                transfer.assert_not_called()
            self.assertEqual(list(Path(tmp).rglob("off-instance-backup.json")), [])

    def test_bounded_download_rejects_larger_stream_and_retains_partial(self):
        import hashlib
        from monitor_coverage_replication import TimeBudget
        now = d2.utcnow()
        cfg = monitor.parse_config(self.config())
        item = {"bytes": 3, "sha256": hashlib.sha256(b"abc").hexdigest()}
        class SFTP:
            def get_channel(self):
                return SimpleNamespace(settimeout=lambda _: None)
            def lstat(self, _):
                return SimpleNamespace(st_mode=0o100600, st_size=3)
            def open(self, *_):
                return io.BytesIO(b"abcd")
        with tempfile.TemporaryDirectory() as tmp:
            cfg["downloads"] = Path(tmp)
            with self.assertRaisesRegex(ValueError, "grew"):
                monitor.download(SFTP(), "evidence.tar.gz", item, cfg, TimeBudget(now + timedelta(minutes=5)), lambda *_a, **_k: None)
            self.assertFalse((Path(tmp) / "evidence.tar.gz").exists())
            self.assertEqual(len(list(Path(tmp).glob("*.partial"))), 1)

    def test_insufficient_mode_calibration_cannot_be_hidden_by_other_mode(self):
        timings = [{"model_called": True, "mode": "first_response", "elapsed_seconds": 1.}] * 100
        self.assertFalse(d2.calibrated(timings))
        with self.assertRaises(ValueError):
            d2.remaining_estimate(timings, 1, {"first_response": 10, "continuation": 10}, 0)

    def test_portable_stage_is_offline_and_guard_precedes_bulk_upload(self):
        import stage_d2_execution as staging
        import shutil
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for label in ("prepared", "tokenizer"):
                (root / label).mkdir()
                (root / label / "fixture.json").write_text('{}', encoding="utf-8")
            def command(argv, *_):
                if argv[1] == "rev-parse":
                    return "a" * 40
                if argv[1] == "bundle":
                    Path(argv[3]).write_bytes(b"EXPLICIT-SYNTHETIC-BUNDLE")
                return ""
            with patch.object(staging, "command", command), patch.object(staging, "verify_plan", return_value={"budget": d2.BUDGET}), patch.object(staging, "load_tokenizer"):
                result = staging.stage(root / "stage", root / "prepared", root / "tokenizer", "a" * 40, "checked-branch", "TEST-ONLY")
            self.assertEqual(result["first_upload_only"], ["d2_setup.py", "shutdown_guard.py"])
            self.assertFalse(result["server_state_verified"])
            script = (root / "stage/launch.sh").read_text()
            self.assertIn("trap on_error ERR", script)
            self.assertIn("sha256sum --check", script)
            self.assertNotIn("pip install", script)
            self.assertLess(script.index("setup-guard.jsonl"), script.index("git clone"))
            bash = shutil.which("bash")
            if sys.platform == "win32":
                candidate = Path("C:/Program Files/Git/bin/bash.exe")
                bash = str(candidate) if candidate.exists() else None
            if bash:
                subprocess.run([bash, "-n", str(root / "stage/launch.sh")], check=True, capture_output=True, timeout=15)


if __name__ == "__main__":
    unittest.main()
