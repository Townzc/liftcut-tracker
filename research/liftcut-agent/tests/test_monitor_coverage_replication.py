"""Independent collector fault tests: synthetic archives/receipts, no SSH or model.

The fake restoration runner exercises orchestration only. It is not evidence of
real weight, tokenizer, or episode verification; those belong to the frozen audit.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import errno
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import monitor_coverage_replication as monitor
from liftcut_agent.interactive import digest
from prepare_coverage_replication import REVIEWED, arm_binding, read, run_binding


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8")


class Clock:
    def __init__(self, wall):
        self.wall, self.ticks = wall, 100.0

    def now(self):
        return self.wall

    def monotonic(self):
        return self.ticks

    def advance(self, seconds):
        self.wall += timedelta(seconds=seconds)
        self.ticks += seconds


class FakeSFTP:
    """In-memory read/download transport; no network or remote shell methods."""
    def __init__(self):
        self.files, self.sequences, self.gets, self.reads, self.timeouts = {}, {}, [], [], []
        self.get_override = None

    def get_channel(self):
        return self

    def settimeout(self, value):
        self.timeouts.append(value)

    def stat(self, path):
        if path not in self.files:
            raise FileNotFoundError(errno.ENOENT, "synthetic missing file", path)
        return SimpleNamespace(st_size=len(self.files[path]))

    def open(self, path, mode):
        if mode != "rb":
            raise AssertionError("collector must not write remote files directly")
        self.reads.append(path)
        sequence = self.sequences.get(path)
        if sequence:
            content = sequence.pop(0)
            self.files[path] = content
        else:
            content = self.files[path]
        if isinstance(content, Exception):
            raise content
        return io.BytesIO(content)

    def get(self, remote, local, callback):
        self.gets.append((remote, local))
        if self.get_override is not None:
            return self.get_override(remote, local, callback)
        content = self.files[remote]
        Path(local).write_bytes(content)
        callback(len(content), len(content))


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.boot = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
        self.clock = Clock(self.boot + timedelta(minutes=30))
        self.budget = monitor.TimeBudget(self.boot + timedelta(minutes=180),
            now=self.clock.now, monotonic=self.clock.monotonic)
        self.plan = read(REVIEWED)["seeds"]["44"]
        self.raw_cfg = {"version": 1, "seed": 44, "execution_commit": monitor.FROZEN_COMMIT,
            "remote_run": "/root/autodl-tmp/liftcut/runs/coverage-replication-v1-seed44-synthetic",
            "remote_ops": "/root/autodl-tmp/liftcut/runs/coverage-replication-seed44-ops-synthetic",
            "booted_at": self.boot.isoformat(), "hourly_cny": 2.18,
            "ssh_host": "test.invalid", "ssh_port": 22, "ssh_user": "root",
            "downloads": "outputs/downloads", "restored": "outputs/restored",
            "operations": "outputs/operations", "prepared": "inputs/prepared",
            "diagnostic": "inputs/diagnostic", "replication": "inputs/replication",
            "tokenizer": "inputs/tokenizer", "restore_python": "runtime/python",
            "known_hosts": "runtime/known_hosts"}
        self.cfg = monitor.parse_config(self.raw_cfg, self.base)
        for name in ("downloads", "restored", "operations"):
            self.cfg[name].mkdir(parents=True)
        self.events = []
        self.emit = lambda event, **data: self.events.append({"event": event, **data})
        self.sftp = FakeSFTP()
        self.binding = run_binding(self.plan, monitor.FROZEN_COMMIT)
        self.opening = {"booted_at_proxy": self.boot.isoformat(),
            "observed_at_utc": (self.boot + timedelta(minutes=2)).isoformat(),
            "boot_age_seconds": 120,
            "deadline": (self.boot + timedelta(minutes=180)).isoformat(),
            "work_cutoff": (self.boot + timedelta(minutes=150)).isoformat(),
            "expected_code_commit": monitor.FROZEN_COMMIT, "hourly_cny_assumed": 2.18}
        self.launch = {"pid": 99, "at_utc": (self.boot + timedelta(minutes=8)).isoformat(),
            "boot_age_seconds_at_spawn": 480,
            "argv": ["/synthetic/python", f"/root/autodl-tmp/liftcut/code/{monitor.FROZEN_COMMIT}/research/liftcut-agent/run_coverage_replication_window.py",
                     "--model-dir", "/synthetic/model", "--model-manifest", "/synthetic/model-manifest.json",
                     "--prepared-dir", "/synthetic/prepared", "--diagnostic-dir", "/synthetic/diagnostic",
                     "--replication-dir", "/synthetic/replication", "--tokenizer-dir", "/synthetic/tokenizer",
                     "--seed", "44", "--output-dir", self.cfg["remote_run"],
                     "--expected-code-commit", monitor.FROZEN_COMMIT, "--hourly-cny", "2.18",
                     "--booted-at", self.boot.isoformat(), "--execute", "--shutdown-when-done"]}
        self.guards = [{"status": "armed", "at_utc": self.launch["at_utc"],
            "deadline": self.opening["deadline"], "command": ["/bin/bash", "/usr/bin/shutdown"]}]
        self.setup_guards = deepcopy(self.guards)
        self.setup_guards[0]["at_utc"] = self.opening["observed_at_utc"]
        self.items = []
        for part in ("s0", "t", "m", "tm", "evidence"):
            content = ("SYNTHETIC ARCHIVE, NOT WEIGHTS: " + part).encode()
            item = {"part": part, "archive": part + ".tar.gz",
                "path": ("" if part == "evidence" else "training/") + part + ".tar.gz",
                "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
                "binding": self.binding if part == "evidence" else arm_binding(self.plan, monitor.FROZEN_COMMIT, part)}
            self.items.append(item)
            self.sftp.files[self.cfg["remote_run"] + "/" + item["path"]] = content
        self.index = self.make_index(self.items)
        self.seed_startup_files()

    def make_index(self, items, status="complete"):
        payload = {"archives": deepcopy(items), "status": status, "run_binding": deepcopy(self.binding)}
        return {**payload, "inventory_digest": digest(payload)}

    def seed_startup_files(self):
        ops, run = self.cfg["remote_ops"], self.cfg["remote_run"]
        self.sftp.files.update({ops + "/opening.json": json_bytes(self.opening),
            ops + "/controller-launch.json": json_bytes(self.launch),
            ops + "/setup-guard.jsonl": b"".join(map(json_bytes, self.setup_guards)),
            run + "/deadline-guard.jsonl": b"".join(map(json_bytes, self.guards)),
            run + "/run-binding.json": json_bytes(self.binding), ops + "/controller.log": b""})

    def validate_startup(self, **changes):
        values = {"cfg": self.cfg, "opening": self.opening, "launch": self.launch,
            "guard_rows": self.guards, "setup_rows": self.setup_guards,
            "binding": self.binding, "plan": self.plan}
        values.update(changes)
        return monitor.validate_remote_state(**values)

    def receipt(self, index):
        complete = index["status"] == "complete"
        return {"inventory_digest": index["inventory_digest"], "run_status": index["status"],
            "run_binding": deepcopy(index["run_binding"]),
            "archives": [{**{k: item[k] for k in ("archive", "bytes", "sha256")},
                          "verified_files": 1, "all_inventory_files_verified": True}
                         for item in index["archives"]],
            "all_archive_files_verified": True, "complete_study_replayed": complete,
            "episodes_replayed": 124 if complete else 0, "adapter_files_verified": complete,
            "token_ids_verified": complete, "test_episodes": 0}

    def runner_for(self, index, calls, *, mutate=None, fail_after_write=False):
        def runner(argv, **kwargs):
            calls.append((argv, kwargs))
            output = Path(argv[argv.index("--output-dir") + 1])
            self.assertFalse(output.exists(), "resume must use a new restore attempt")
            output.mkdir(parents=True)
            receipt = self.receipt(index)
            if mutate:
                mutate(receipt)
            (output / "off-instance-backup.json").write_bytes(json_bytes(receipt))
            if fail_after_write:
                raise subprocess.CalledProcessError(1, argv)
            return SimpleNamespace(returncode=0)
        return runner

    def collect(self):
        return monitor.collect(self.sftp, self.cfg, self.plan, self.budget, self.emit,
                               sleep=self.clock.advance)

    def test_configuration_rejects_credentials_cross_seed_paths_and_overlapping_outputs(self):
        invalid = []
        cfg = deepcopy(self.raw_cfg); cfg["password"] = "SYNTHETIC ONLY"; invalid.append(cfg)
        cfg = deepcopy(self.raw_cfg); cfg["remote_run"] = cfg["remote_run"].replace("seed44", "seed43"); invalid.append(cfg)
        cfg = deepcopy(self.raw_cfg); cfg["downloads"] = "inputs/prepared/archives"; invalid.append(cfg)
        cfg = deepcopy(self.raw_cfg); cfg["operations"] = "outputs/restored/logs"; invalid.append(cfg)
        cfg = deepcopy(self.raw_cfg); cfg["execution_commit"] = "a" * 40; invalid.append(cfg)
        cfg = deepcopy(self.raw_cfg); cfg["seed"] = True; invalid.append(cfg)
        cfg = deepcopy(self.raw_cfg); cfg["booted_at"] = "2026-10-01T12:00:00"; invalid.append(cfg)
        for cfg in invalid:
            with self.subTest(config=cfg), self.assertRaises(ValueError):
                monitor.parse_config(cfg, self.base)

    def test_late_monitor_attachment_accepts_original_early_controller_launch(self):
        self.clock.advance(100 * 60)
        self.validate_startup()
        self.assertEqual(self.budget.remaining(), 50 * 60)

    def test_controller_launch_actual_timestamp_overrides_claimed_age(self):
        late = deepcopy(self.launch)
        late["at_utc"] = (self.boot + timedelta(seconds=601)).isoformat()
        late["boot_age_seconds_at_spawn"] = 1
        with self.assertRaisesRegex(ValueError, "ten-minute"):
            self.validate_startup(launch=late)

    def test_startup_rejects_wrong_seed_commit_window_and_missing_guard(self):
        wrong_binding = deepcopy(self.binding); wrong_binding["seed"] = 43
        with self.assertRaises(ValueError): self.validate_startup(binding=wrong_binding)
        wrong_opening = deepcopy(self.opening); wrong_opening["expected_code_commit"] = "a" * 40
        with self.assertRaises(ValueError): self.validate_startup(opening=wrong_opening)
        wrong_opening = deepcopy(self.opening); wrong_opening["deadline"] = (self.boot + timedelta(minutes=181)).isoformat()
        with self.assertRaises(ValueError): self.validate_startup(opening=wrong_opening)
        for field in ("guard_rows", "setup_rows"):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate_startup(**{field: []})

    def test_duplicate_controller_flags_cannot_hide_argparse_last_value(self):
        for flag, value in (("--seed", "43"), ("--output-dir", "/wrong"),
                            ("--expected-code-commit", "a" * 40), ("--booted-at", self.boot.isoformat())):
            launch = deepcopy(self.launch); launch["argv"] += [flag, value]
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                self.validate_startup(launch=launch)

    def test_missing_boot_argument_value_is_a_controlled_rejection(self):
        launch = deepcopy(self.launch)
        i = launch["argv"].index("--booted-at")
        del launch["argv"][i:i + 2]
        launch["argv"].append("--booted-at")
        with self.assertRaises(ValueError): self.validate_startup(launch=launch)

    def test_equals_and_abbreviated_flags_cannot_override_canonical_launch(self):
        for extra in (["--seed=43"], ["--booted-at=" + (self.boot + timedelta(hours=1)).isoformat()],
                      ["--see", "43"], ["--booted", self.boot.isoformat()],
                      ["--model-dir", "/different/model"]):
            launch = deepcopy(self.launch)
            launch["argv"] += extra
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.validate_startup(launch=launch)

    def test_monotonic_clock_prevents_deadline_extension_after_wall_clock_rollback(self):
        self.clock.advance(60)
        self.clock.wall -= timedelta(hours=3)
        self.assertEqual(self.budget.remaining(), 149 * 60)
        self.clock.ticks += 149 * 60
        with self.assertRaises(TimeoutError): self.budget.check()

    def test_missing_remote_startup_evidence_blocks_download_and_restore(self):
        for path in (self.cfg["remote_ops"] + "/opening.json",
                     self.cfg["remote_run"] + "/run-binding.json",
                     self.cfg["remote_ops"] + "/setup-guard.jsonl"):
            saved = self.sftp.files.pop(path)
            with self.subTest(path=path), patch.object(monitor, "restore_and_publish") as restore:
                with self.assertRaisesRegex(ValueError, "startup evidence missing"): self.collect()
                restore.assert_not_called()
                self.assertEqual(self.sftp.gets, [])
            self.sftp.files[path] = saved

    def test_partial_live_json_is_retried_but_bounded(self):
        path = self.cfg["remote_run"] + "/backup-ready.json"
        self.sftp.files[path] = b"{"
        self.sftp.sequences[path] = [b"", b'{"archives":', b"{"]
        with patch.object(monitor, "restore_and_publish") as restore:
            with self.assertRaisesRegex(ValueError, "three bounded reads"): self.collect()
            restore.assert_not_called()
        self.assertEqual(self.sftp.reads.count(path), 3)
        self.assertEqual(sum(e["event"] == "backup_index_read_retry" for e in self.events), 2)

    def test_valid_json_with_wrong_binding_is_not_retried_or_restored(self):
        index = deepcopy(self.index)
        index["run_binding"]["seed"] = 43
        path = self.cfg["remote_run"] + "/backup-ready.json"
        self.sftp.files[path] = json_bytes(index)
        with patch.object(monitor, "restore_and_publish") as restore:
            with self.assertRaises(ValueError): self.collect()
            restore.assert_not_called()
        self.assertEqual(self.sftp.reads.count(path), 1)
        self.assertFalse(any(e["event"] == "backup_index_read_retry" for e in self.events))

    def test_early_archive_and_final_index_must_match_without_replacement(self):
        early = deepcopy(self.items[0])
        self.sftp.files[self.cfg["remote_ops"] + "/controller.log"] = json_bytes({"adapter_backup_ready": early})
        changed = deepcopy(self.items); changed[0]["sha256"] = "f" * 64
        self.sftp.files[self.cfg["remote_run"] + "/backup-ready.json"] = json_bytes(self.make_index(changed))
        with patch.object(monitor, "restore_and_publish") as restore:
            with self.assertRaisesRegex(ValueError, "final index differs"): self.collect()
            restore.assert_not_called()
        self.assertEqual(len(self.sftp.gets), 1)
        self.assertEqual(hashlib.sha256((self.cfg["downloads"] / early["archive"]).read_bytes()).hexdigest(), early["sha256"])

    def test_resume_rehashes_same_size_local_archive_and_rejects_tampering(self):
        item = self.items[0]
        target = monitor.download_archive(self.sftp, item, self.cfg, self.plan, self.budget, self.emit, {})
        target.write_bytes(b"X" * item["bytes"])
        with self.assertRaisesRegex(ValueError, "never overwrite"):
            monitor.download_archive(self.sftp, item, self.cfg, self.plan, self.budget, self.emit, {})
        self.assertEqual(len(self.sftp.gets), 1)

    def test_interrupted_download_retains_partial_and_never_creates_final(self):
        item = self.items[0]
        def interrupted(remote, local, callback):
            Path(local).write_bytes(b"SYNTHETIC PARTIAL")
            raise OSError("synthetic dropped transfer")
        self.sftp.get_override = interrupted
        with self.assertRaises(OSError):
            monitor.download_archive(self.sftp, item, self.cfg, self.plan, self.budget, self.emit, {})
        self.assertFalse((self.cfg["downloads"] / item["archive"]).exists())
        self.assertEqual(len(list(self.cfg["downloads"].glob("*.partial"))), 1)
        self.sftp.get_override = None
        monitor.download_archive(self.sftp, item, self.cfg, self.plan, self.budget, self.emit, {})
        self.assertTrue((self.cfg["downloads"] / item["archive"]).exists())
        self.assertEqual(len(list(self.cfg["downloads"].glob("*.partial"))), 1)

    def test_download_callback_honors_original_deadline(self):
        item = self.items[0]
        def delayed(remote, local, callback):
            Path(local).write_bytes(self.sftp.files[remote])
            self.clock.advance(180 * 60)
            callback(item["bytes"], item["bytes"])
        self.sftp.get_override = delayed
        with self.assertRaises(TimeoutError):
            monitor.download_archive(self.sftp, item, self.cfg, self.plan, self.budget, self.emit, {})
        self.assertFalse((self.cfg["downloads"] / item["archive"]).exists())

    def test_restore_failure_cannot_publish_even_if_runner_left_a_receipt(self):
        calls = []
        with patch.object(monitor, "transfer_receipt") as publish:
            with self.assertRaises(subprocess.CalledProcessError):
                monitor.restore_and_publish(self.sftp, self.index, self.cfg, self.plan, self.budget,
                    self.emit, runner=self.runner_for(self.index, calls, fail_after_write=True))
            publish.assert_not_called()
        self.assertFalse(any(e["event"] == "off_instance_verified" for e in self.events))

    def test_missing_or_wrong_seed_restore_receipt_cannot_publish(self):
        with patch.object(monitor, "transfer_receipt") as publish:
            with self.assertRaises(FileNotFoundError):
                monitor.restore_and_publish(self.sftp, self.index, self.cfg, self.plan, self.budget,
                    self.emit, runner=lambda *args, **kwargs: SimpleNamespace(returncode=0))
            publish.assert_not_called()
        with patch.object(monitor, "transfer_receipt") as publish:
            with self.assertRaises(ValueError):
                monitor.restore_and_publish(self.sftp, self.index, self.cfg, self.plan, self.budget,
                    self.emit, runner=self.runner_for(self.index, [], mutate=lambda r: r["run_binding"].update(seed=43)))
            publish.assert_not_called()

    def test_restore_timeout_and_insufficient_remaining_time_never_publish(self):
        with patch.object(monitor, "transfer_receipt") as publish:
            def timeout(argv, **kwargs): raise subprocess.TimeoutExpired(argv, kwargs["timeout"])
            with self.assertRaises(subprocess.TimeoutExpired):
                monitor.restore_and_publish(self.sftp, self.index, self.cfg, self.plan, self.budget,
                    self.emit, runner=timeout)
            publish.assert_not_called()
        self.clock.advance(149 * 60)
        with patch.object(monitor, "transfer_receipt") as publish:
            with self.assertRaises(TimeoutError):
                monitor.restore_and_publish(self.sftp, self.index, self.cfg, self.plan, self.budget,
                    self.emit, runner=lambda *a, **kw: self.fail("late restore must not launch"))
            publish.assert_not_called()

    def test_resume_restores_again_into_fresh_attempt_and_does_not_trust_old_receipt(self):
        calls = []
        old = self.cfg["restored"] / "previous-interrupted-attempt"
        old.mkdir()
        (old / "off-instance-backup.json").write_bytes(json_bytes(self.receipt(self.index)))
        with patch.object(monitor, "transfer_receipt", return_value={"status": "unknown", "server_acceptance": "unknown"}) as publish:
            for _ in range(2):
                result = monitor.restore_and_publish(self.sftp, self.index, self.cfg, self.plan, self.budget,
                    self.emit, runner=self.runner_for(self.index, calls))
                self.assertEqual(result["status"], "unknown")
            self.assertEqual(publish.call_count, 2)
        outputs = [argv[argv.index("--output-dir") + 1] for argv, _ in calls]
        self.assertEqual(len(set(outputs)), 2)
        self.assertNotIn(str(old), outputs)
        for argv, kwargs in calls:
            self.assertTrue(kwargs["check"])
            self.assertEqual(kwargs["timeout"], self.budget.remaining() - 90)
            self.assertEqual(argv[argv.index("--seed") + 1], "44")
            self.assertEqual(argv[argv.index("--expected-code-commit") + 1], monitor.FROZEN_COMMIT)
        self.assertTrue((old / "off-instance-backup.json").exists())

    def test_partial_window_keeps_frozen_zero_episode_receipt_semantics(self):
        index = self.make_index([self.items[-1]], "failed")
        calls = []
        with patch.object(monitor, "transfer_receipt", return_value={"status": "published", "server_acceptance": "unknown"}) as publish:
            monitor.restore_and_publish(self.sftp, index, self.cfg, self.plan, self.budget,
                self.emit, runner=self.runner_for(index, calls))
            sent = json.loads(publish.call_args.args[1].read_bytes())
        self.assertIn("--allow-partial", calls[0][0])
        self.assertEqual(sent["episodes_replayed"], 0)
        self.assertFalse(sent["adapter_files_verified"])
        self.assertFalse(sent["token_ids_verified"])
        self.assertFalse(sent["complete_study_replayed"])

    def test_ambiguous_receipt_publication_exits_without_inventing_server_acceptance(self):
        self.sftp.files[self.cfg["remote_run"] + "/backup-ready.json"] = json_bytes(self.index)
        result = {"status": "unknown", "server_acceptance": "unknown", "stage": "rename"}
        with patch.object(monitor, "restore_and_publish", return_value=result) as restore:
            actual = self.collect()
            self.assertEqual({k: actual[k] for k in result}, result)
            self.assertEqual(actual["run_status"], "complete")
            self.assertIs(actual["local_restore_verified"], True)
            self.assertIs(actual["complete_study_replayed"], True)
            self.assertIsNone(actual["server_acknowledged"])
            self.assertIs(actual["provider_power_state_verified"], False)
            restore.assert_called_once()
        self.assertEqual(len(self.sftp.gets), 5)
        self.assertTrue(any(e["event"] == "monitor_receipt_unconfirmed" for e in self.events))
        self.assertFalse(any(e["event"] == "server_receipt_observed" for e in self.events))

    def test_shutdown_return_record_does_not_establish_provider_power_or_billing(self):
        self.sftp.files[self.cfg["remote_run"] + "/backup-ready.json"] = json_bytes(self.index)
        self.sftp.files[self.cfg["remote_run"] + "/backup-copy-status.json"] = json_bytes({"off_instance_acknowledged": True})
        self.sftp.files[self.cfg["remote_run"] + "/shutdown-request.json"] = json_bytes({"returncode": 0, "provider_power_state_verified": False})
        with patch.object(monitor, "restore_and_publish", return_value={"status": "published", "server_acceptance": "unknown"}):
            result = self.collect()
        self.assertEqual(result["status"], "shutdown_request_observed")
        self.assertIs(result["provider_power_state_verified"], False)
        self.assertEqual(result["run_status"], "complete")
        self.assertIs(result["local_restore_verified"], True)
        self.assertIs(result["complete_study_replayed"], True)
        self.assertIs(result["server_acknowledged"], True)
        self.assertTrue((self.cfg["operations"] / "backup-copy-status.json").exists())

    def test_partial_restore_ack_and_shutdown_cannot_become_a_complete_study(self):
        index = self.make_index([self.items[-1]], "failed")
        self.sftp.files[self.cfg["remote_run"] + "/backup-ready.json"] = json_bytes(index)
        self.sftp.files[self.cfg["remote_run"] + "/backup-copy-status.json"] = json_bytes({"off_instance_acknowledged": True})
        self.sftp.files[self.cfg["remote_run"] + "/shutdown-request.json"] = json_bytes({"returncode": 0})
        with patch.object(monitor, "restore_and_publish", return_value={"status": "published", "server_acceptance": "unknown"}):
            result = self.collect()
        self.assertEqual(result["status"], "shutdown_request_observed")
        self.assertEqual(result["run_status"], "failed")
        self.assertIs(result["local_restore_verified"], True)
        self.assertIs(result["complete_study_replayed"], False)
        self.assertIs(result["server_acknowledged"], True)
        self.assertIs(result["provider_power_state_verified"], False)

    def test_shutdown_after_server_rejects_ack_preserves_false_acceptance(self):
        self.sftp.files[self.cfg["remote_run"] + "/backup-ready.json"] = json_bytes(self.index)
        self.sftp.files[self.cfg["remote_run"] + "/backup-copy-status.json"] = json_bytes({"off_instance_acknowledged": False})
        self.sftp.files[self.cfg["remote_run"] + "/shutdown-request.json"] = json_bytes({"returncode": 0})
        with patch.object(monitor, "restore_and_publish", return_value={"status": "published", "server_acceptance": "unknown"}):
            result = self.collect()
        self.assertIs(result["server_acknowledged"], False)
        self.assertIs(result["complete_study_replayed"], True)
        self.assertIs(result["provider_power_state_verified"], False)

    def test_shutdown_without_ack_record_preserves_unknown_acceptance(self):
        self.sftp.files[self.cfg["remote_run"] + "/backup-ready.json"] = json_bytes(self.index)
        self.sftp.files[self.cfg["remote_run"] + "/shutdown-request.json"] = json_bytes({"returncode": 0})
        with patch.object(monitor, "restore_and_publish", return_value={"status": "published", "server_acceptance": "unknown"}):
            result = self.collect()
        self.assertIsNone(result["server_acknowledged"])
        self.assertIs(result["complete_study_replayed"], True)
        self.assertFalse((self.cfg["operations"] / "backup-copy-status.json").exists())

    def test_shutdown_failure_preserves_nonzero_returncode(self):
        self.sftp.files[self.cfg["remote_run"] + "/backup-ready.json"] = json_bytes(self.index)
        self.sftp.files[self.cfg["remote_run"] + "/backup-copy-status.json"] = json_bytes({"off_instance_acknowledged": True})
        self.sftp.files[self.cfg["remote_run"] + "/shutdown-request.json"] = json_bytes({"returncode": 1})
        with patch.object(monitor, "restore_and_publish", return_value={"status": "published", "server_acceptance": "unknown"}):
            result = self.collect()
        self.assertEqual(result["status"], "shutdown_request_failed")
        self.assertEqual(result["returncode"], 1)
        self.assertIs(result["server_acknowledged"], True)
        self.assertIs(result["provider_power_state_verified"], False)

    def test_deadline_without_final_index_does_not_invent_local_restore(self):
        self.clock.advance(149 * 60 + 59)
        with patch.object(monitor, "restore_and_publish") as restore:
            result = self.collect()
            restore.assert_not_called()
        self.assertEqual(result["status"], "deadline_reached")
        self.assertIsNone(result["run_status"])
        self.assertIsNone(result["server_acknowledged"])
        self.assertIs(result["local_restore_verified"], False)
        self.assertIs(result["complete_study_replayed"], False)

    def test_cli_success_requires_complete_study_accepted_ack_and_zero_shutdown_return(self):
        path = self.base / "terminal-config.json"
        path.write_bytes(json_bytes(self.raw_cfg))
        complete = {"status": "shutdown_request_observed", "returncode": 0,
            "run_status": "complete", "local_restore_verified": True, "complete_study_replayed": True,
            "server_acknowledged": True, "provider_power_state_verified": False}
        cases = [(complete, 0),
            ({**complete, "run_status": "failed", "complete_study_replayed": False}, 2),
            ({**complete, "server_acknowledged": False}, 2),
            ({**complete, "server_acknowledged": None}, 2),
            ({**complete, "status": "shutdown_request_failed", "returncode": 1}, 2),
            ({**complete, "status": "unknown", "server_acknowledged": None}, 2)]
        for result, expected_code in cases:
            with self.subTest(result=result), \
                    patch.object(sys, "argv", ["monitor", "--config", str(path), "--connect"]), \
                    patch.object(monitor, "offline_preflight", return_value=(self.plan, {"gpu_calls": 0})), \
                    patch.object(monitor, "connect", return_value=result), \
                    patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(monitor.main(), expected_code)

    def simulated_connection(self, *, fail_auth=False):
        """Strict Paramiko 2.x-shaped stub; it has no real socket implementation."""
        cfg = dict(self.cfg)
        cfg["ssh_host"] = "synthetic.example"
        cfg["known_hosts"].parent.mkdir(parents=True, exist_ok=True)
        cfg["known_hosts"].write_text("synthetic known-host fixture", encoding="utf-8")
        calls, timers = [], []
        secret = "SYNTHETIC-PASSWORD-DO-NOT-LOG"
        sftp = self.sftp

        class Channel:
            def settimeout(self, seconds): calls.append(("channel_timeout", seconds))
            def invoke_subsystem(self, name): calls.append(("subsystem", name))
            def close(self): calls.append(("channel_close",))

        class Transport:
            def set_keepalive(self, seconds): calls.append(("keepalive", seconds))
            def open_session(self, timeout):
                calls.append(("open_session", timeout))
                return Channel()

        class Client:
            def load_host_keys(self, path): calls.append(("known_hosts", path))
            def set_missing_host_key_policy(self, policy): calls.append(("reject_unknown_host",))
            # No channel_timeout keyword: the actual local Paramiko 2.8.1 rejects it.
            def connect(self, hostname, *, port, username, password, look_for_keys, allow_agent,
                        timeout, auth_timeout, banner_timeout):
                calls.append(("connect", hostname, timeout, auth_timeout, banner_timeout))
                if fail_auth:
                    raise OSError(secret + " synthetic authentication detail")
            def get_transport(self): return Transport()
            def close(self): calls.append(("client_close",))

        class Timer:
            def __init__(self, interval, callback):
                self.interval, self.callback = interval, callback
                self.started = self.cancelled = False
                timers.append(self)
            def start(self): self.started = True
            def cancel(self): self.cancelled = True

        fake = SimpleNamespace(SSHClient=Client, RejectPolicy=lambda: object(),
            SFTPClient=lambda channel: sftp)
        return cfg, calls, timers, secret, fake, Timer

    def test_paramiko2_shaped_connection_bounds_subsystem_without_remote_commands(self):
        cfg, calls, timers, secret, fake, timer = self.simulated_connection()
        with patch.dict(sys.modules, {"paramiko": fake}), \
                patch.object(monitor, "utcnow", return_value=self.clock.now()), \
                patch.object(monitor, "TimeBudget", return_value=self.budget), \
                patch.object(monitor.threading, "Timer", timer), \
                patch.object(monitor.getpass, "getpass", return_value=secret), \
                patch.object(monitor, "collect", return_value={"status": "deadline_reached"}) as collect:
            self.assertEqual(monitor.connect(cfg, self.plan)["status"], "deadline_reached")
            collect.assert_called_once()
        self.assertIn(("subsystem", "sftp"), calls)
        self.assertEqual(len([call for call in calls if call[0] == "connect"]), 1)
        self.assertEqual([t.interval for t in timers], [self.budget.remaining(), 15])
        self.assertTrue(all(t.started and t.cancelled for t in timers))
        self.assertEqual(calls.count(("client_close",)), 1)
        self.assertFalse((cfg["operations"] / "monitor.lock").exists())
        self.assertNotIn(secret, (cfg["operations"] / "monitor-config.json").read_text(encoding="utf-8"))

    def test_auth_failure_cleans_local_lock_and_never_logs_transport_error_details(self):
        cfg, calls, timers, secret, fake, timer = self.simulated_connection(fail_auth=True)
        with patch.dict(sys.modules, {"paramiko": fake}), \
                patch.object(monitor, "utcnow", return_value=self.clock.now()), \
                patch.object(monitor, "TimeBudget", return_value=self.budget), \
                patch.object(monitor.threading, "Timer", timer), \
                patch.object(monitor.getpass, "getpass", return_value=secret), \
                patch.object(monitor, "collect") as collect, \
                patch("sys.stdout", new_callable=io.StringIO) as stdout:
            with self.assertRaises(OSError): monitor.connect(cfg, self.plan)
            collect.assert_not_called()
        self.assertEqual(calls.count(("client_close",)), 1)
        self.assertFalse((cfg["operations"] / "monitor.lock").exists())
        saved = (cfg["operations"] / "events.jsonl").read_text(encoding="utf-8")
        self.assertNotIn(secret, saved + stdout.getvalue())
        self.assertNotIn("authentication detail", saved + stdout.getvalue())
        event = json.loads(saved)
        self.assertEqual(event["error"], "OSError")
        self.assertIs(event["provider_power_state_verified"], False)
        self.assertTrue(all(t.cancelled for t in timers))

    def test_default_cli_preflight_never_connects_or_creates_run_outputs(self):
        raw = deepcopy(self.raw_cfg)
        for name in ("downloads", "restored", "operations"):
            raw[name] = str(self.base / "new-offline-only" / name)
        path = self.base / "config.json"
        path.write_bytes(json_bytes(raw))
        with patch.object(sys, "argv", ["monitor", "--config", str(path)]), \
                patch.object(monitor, "offline_preflight", return_value=(self.plan, {"gpu_calls": 0})), \
                patch.object(monitor, "connect") as connect, patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(monitor.main(), 0)
            connect.assert_not_called()
        self.assertFalse((self.base / "new-offline-only").exists())

    def test_cli_transport_exception_never_echoes_private_details_or_traceback(self):
        path = self.base / "private-error-config.json"
        path.write_bytes(json_bytes(self.raw_cfg))
        detail = "SYNTHETIC-PRIVATE-PASSWORD synthetic-host.example private-user-path"
        with patch.object(sys, "argv", ["monitor", "--config", str(path), "--connect"]), \
                patch.object(monitor, "offline_preflight", return_value=(self.plan, {"gpu_calls": 0})), \
                patch.object(monitor, "connect", side_effect=OSError(detail)), \
                patch("sys.stdout", new_callable=io.StringIO) as stdout, \
                patch("sys.stderr", new_callable=io.StringIO) as stderr:
            self.assertEqual(monitor.main(), 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(json.loads(stderr.getvalue()), {"status": "failed", "error": "OSError",
            "provider_power_state_verified": False})
        self.assertNotIn(detail, stdout.getvalue() + stderr.getvalue())
        self.assertNotIn("Traceback", stdout.getvalue() + stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
