"""Synthetic receipts and in-memory SFTP faults; no network, model, or real ACK."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import errno
import json
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import replication_receipt_transfer as transfer
from prepare_coverage_replication import ARMS, REVIEWED, arm_binding, read, run_binding
from liftcut_agent.interactive import digest

REMOTE = "/root/autodl-tmp/liftcut/runs/SYNTHETIC-TEST-seed44"
FINAL = REMOTE + "/off-instance-backup.json"


def payload(complete=True):
    """Fabricated byte-verification records; never used as actual experiment proof."""
    plan = read(REVIEWED)["seeds"]["44"]
    binding = run_binding(plan, transfer.EXECUTION_COMMIT)
    parts = [*ARMS, "evidence"] if complete else ["s0", "evidence"]
    archives = [{"part": part,
                 "binding": binding if part == "evidence" else arm_binding(plan, transfer.EXECUTION_COMMIT, part),
                 "path": ("" if part == "evidence" else "training/") + part + ".tar.gz",
                 "archive": part + ".tar.gz", "bytes": 10 + i, "sha256": str(i + 1) * 64}
                for i, part in enumerate(parts)]
    index = {"archives": archives, "status": "complete" if complete else "failed", "run_binding": binding}
    index["inventory_digest"] = digest(index)
    receipt = {"inventory_digest": index["inventory_digest"], "run_status": index["status"],
               "run_binding": binding, "archives": [
                   {**{k: a[k] for k in ("archive", "bytes", "sha256")},
                    "verified_files": 9, "all_inventory_files_verified": True} for a in archives],
               "all_archive_files_verified": True, "complete_study_replayed": complete,
               "episodes_replayed": 124 if complete else 0, "adapter_files_verified": complete,
               "token_ids_verified": complete, "test_episodes": 0}
    return plan, index, receipt


class Clock:
    def __init__(self):
        self.value = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)

    def __call__(self):
        return self.value


class FakeHandle:
    def __init__(self, sftp, path, writing):
        self.sftp, self.path, self.writing, self.offset = sftp, path, writing, 0

    def write(self, data):
        self.sftp.calls.append(("write", self.path))
        if self.sftp.fault in {"half_write", "silent_half_write"}:
            self.sftp.files[self.path] += data[:len(data) // 2]
            if self.sftp.fault == "half_write":
                raise OSError("SYNTHETIC write failure")
            return None
        self.sftp.files[self.path] += data
        if self.sftp.fault == "deadline_after_write":
            self.sftp.clock.value += timedelta(hours=1)
        return None  # Paramiko's normal return type.

    def read(self, count):
        self.sftp.calls.append(("read", self.path))
        content = self.sftp.files[self.path]
        if self.sftp.fault == "hash_mismatch" and self.path != FINAL:
            content = bytes([content[0] ^ 1]) + content[1:]
        chunk = content[self.offset:self.offset + count]
        self.offset += len(chunk)
        return chunk

    def close(self):
        self.sftp.calls.append(("close", self.path))
        if self.writing and self.sftp.fault == "close_failure":
            raise OSError("SYNTHETIC close failure")
        if not self.writing and self.sftp.fault == "read_close_failure":
            raise OSError("SYNTHETIC readback close failure")


class FakeSFTP:
    def __init__(self, clock, fault=None):
        self.clock, self.fault = clock, fault
        self.files, self.calls = {}, []

    def lstat(self, path):
        self.calls.append(("lstat", path))
        if path not in self.files:
            raise FileNotFoundError(errno.ENOENT, "SYNTHETIC absent")
        mode = stat.S_IFLNK if self.fault == "final_symlink" and path == FINAL else stat.S_IFREG
        return SimpleNamespace(st_size=len(self.files[path]), st_mode=mode | 0o600)

    def open(self, path, mode, bufsize=-1):
        self.calls.append(("open", path, mode, bufsize))
        if mode == "wx":
            if path in self.files:
                raise FileExistsError(errno.EEXIST, "SYNTHETIC existing temp")
            self.files[path] = b""
        elif mode != "rb":
            raise AssertionError("Unexpected nonexclusive mode")
        return FakeHandle(self, path, mode == "wx")

    def rename(self, old, new):
        self.calls.append(("rename", old, new))
        if new in self.files:
            raise FileExistsError(errno.EEXIST, "SYNTHETIC existing final")
        if self.fault == "rename_before":
            raise OSError("SYNTHETIC lost connection before outcome known")
        self.files[new] = self.files.pop(old)
        if self.fault == "rename_after":
            raise OSError("SYNTHETIC server renamed but confirmation lost")

    def posix_rename(self, *args):
        raise AssertionError("Overwrite rename must never be used")


class ReceiptValidationTests(unittest.TestCase):
    def test_complete_and_partial_synthetic_receipts_keep_distinct_claims(self):
        for complete in (False, True):
            plan, index, receipt = payload(complete)
            result = transfer.validate_receipt(json.dumps(receipt).encode(), index, plan, transfer.EXECUTION_COMMIT)
            self.assertEqual(result["episodes_replayed"], 124 if complete else 0)
            self.assertIs(result["adapter_files_verified"], complete)
            self.assertIs(result["token_ids_verified"], complete)

    def test_wrong_seed_commit_plan_and_index_are_rejected(self):
        plan, index, receipt = payload()
        for key, value in (("seed", 43), ("code_commit", "0" * 40), ("seed_plan_sha256", "0" * 64)):
            changed = deepcopy(receipt)
            changed["run_binding"][key] = value
            with self.subTest(binding=key), self.assertRaises(ValueError):
                transfer.validate_receipt(json.dumps(changed).encode(), index, plan, transfer.EXECUTION_COMMIT)
        bad_index = deepcopy(index)
        bad_index["inventory_digest"] = "0" * 64
        with self.assertRaises(ValueError):
            transfer.validate_receipt(json.dumps(receipt).encode(), bad_index, plan, transfer.EXECUTION_COMMIT)
        with self.assertRaises(ValueError):
            transfer.validate_receipt(json.dumps(receipt).encode(), index, plan, "a" * 40)
        plan["inference_seed"] = 44
        with self.assertRaises(ValueError):
            transfer.validate_receipt(json.dumps(receipt).encode(), index, plan, transfer.EXECUTION_COMMIT)

    def test_complete_flags_and_partial_flags_cannot_be_mixed(self):
        for complete in (False, True):
            plan, index, receipt = payload(complete)
            mutations = {"run_status": "failed" if complete else "complete",
                         "complete_study_replayed": not complete, "adapter_files_verified": not complete,
                         "token_ids_verified": not complete, "episodes_replayed": 0 if complete else 124,
                         "test_episodes": 1, "all_archive_files_verified": False}
            for key, value in mutations.items():
                changed = {**receipt, key: value}
                with self.subTest(complete=complete, field=key), self.assertRaises(ValueError):
                    transfer.validate_receipt(json.dumps(changed).encode(), index, plan, transfer.EXECUTION_COMMIT)

    def test_archive_mismatch_reorder_or_bool_counters_are_rejected(self):
        plan, index, receipt = payload()
        for key, value in (("archive", "wrong.tar.gz"), ("bytes", 1), ("sha256", "0" * 64),
                           ("verified_files", True), ("all_inventory_files_verified", False)):
            changed = deepcopy(receipt)
            changed["archives"][0][key] = value
            with self.subTest(field=key), self.assertRaises(ValueError):
                transfer.validate_receipt(json.dumps(changed).encode(), index, plan, transfer.EXECUTION_COMMIT)
        changed = deepcopy(receipt)
        changed["archives"].reverse()
        with self.assertRaises(ValueError):
            transfer.validate_receipt(json.dumps(changed).encode(), index, plan, transfer.EXECUTION_COMMIT)
        for key in ("test_episodes", "episodes_replayed"):
            changed = {**receipt, key: False}
            with self.assertRaises(ValueError):
                transfer.validate_receipt(json.dumps(changed).encode(), index, plan, transfer.EXECUTION_COMMIT)

    def test_duplicate_json_extra_fields_and_nonfinite_or_malformed_values_rejected(self):
        plan, index, receipt = payload()
        encoded = json.dumps(receipt).encode()
        bad = [b'{"test_episodes":0,' + encoded[1:], json.dumps({**receipt, "forged": True}).encode(),
               b'{"number":NaN}', b'not JSON', b'\xff', b'[]']
        for data in bad:
            with self.subTest(data=data[:30]), self.assertRaises(ValueError):
                transfer.validate_receipt(data, index, plan, transfer.EXECUTION_COMMIT)


class ReceiptTransferTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "SYNTHETIC-receipt.json"
        self.plan, self.index, self.receipt = payload()
        self.content = json.dumps(self.receipt).encode()
        self.path.write_bytes(self.content)
        self.clock = Clock()
        self.deadline = self.clock() + timedelta(minutes=5)
        self.events = []

    def run_transfer(self, sftp):
        return transfer.transfer_receipt(sftp, self.path, REMOTE, self.index, self.plan,
            transfer.EXECUTION_COMMIT, self.deadline, now=self.clock,
            emit=lambda name, **data: self.events.append((name, data)))

    def test_closed_exclusive_temp_verified_before_standard_atomic_publish(self):
        sftp = FakeSFTP(self.clock)
        result = self.run_transfer(sftp)
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["server_acceptance"], "unknown")
        self.assertEqual(sftp.files, {FINAL: self.content})
        temp = result["temp_path"]
        self.assertEqual(str(Path(temp).parent).replace('\\', '/'), REMOTE)
        calls = sftp.calls
        self.assertIn(("open", temp, "wx", 0), calls)
        close_index = calls.index(("close", temp))
        self.assertLess(close_index, calls.index(("lstat", temp)))
        self.assertLess(calls.index(("read", temp)), calls.index(("rename", temp, FINAL)))
        self.assertEqual(self.events[-1][0], "receipt_atomic_published")

    def test_partial_receipt_upload_keeps_zero_replay_and_false_research_claim(self):
        self.plan, self.index, self.receipt = payload(False)
        self.content = json.dumps(self.receipt).encode()
        self.path.write_bytes(self.content)
        result = self.run_transfer(FakeSFTP(self.clock))
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["run_status"], "failed")
        self.assertFalse(result["complete_study_receipt"])

    def test_half_write_close_failure_or_readback_hash_mismatch_never_publish(self):
        for fault in ("half_write", "silent_half_write", "close_failure", "read_close_failure", "hash_mismatch"):
            with self.subTest(fault=fault):
                sftp = FakeSFTP(self.clock, fault)
                result = self.run_transfer(sftp)
                self.assertEqual(result["status"], "failed")
                self.assertNotIn(FINAL, sftp.files)
                self.assertFalse(any(c[0] == "rename" for c in sftp.calls))
                self.assertIsNotNone(result["temp_path"])

    def test_unique_temp_names_and_exclusive_collision_never_overwrite(self):
        first, second = FakeSFTP(self.clock), FakeSFTP(self.clock)
        self.assertNotEqual(self.run_transfer(first)["temp_path"], self.run_transfer(second)["temp_path"])
        sftp = FakeSFTP(self.clock)
        identifier = "a" * 32
        temporary = REMOTE + "/.off-instance-backup.json." + identifier + ".tmp"
        sftp.files[temporary] = b"SYNTHETIC existing other transfer"
        with patch.object(transfer.uuid, "uuid4", return_value=SimpleNamespace(hex=identifier)):
            result = self.run_transfer(sftp)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(sftp.files, {temporary: b"SYNTHETIC existing other transfer"})
        self.assertFalse(any(c[0] in ("write", "rename") for c in sftp.calls))

    def test_existing_identical_final_is_only_observed_without_any_write(self):
        sftp = FakeSFTP(self.clock)
        sftp.files[FINAL] = self.content
        result = self.run_transfer(sftp)
        self.assertEqual(result["status"], "already_present")
        self.assertEqual(result["server_acceptance"], "unknown")
        self.assertFalse(any(c[0] in ("write", "rename") or (c[0] == "open" and c[2] == "wx") for c in sftp.calls))
        self.assertEqual(sftp.files, {FINAL: self.content})

    def test_existing_different_or_symlink_final_is_never_overwritten(self):
        for fault, content in ((None, b'x' * len(self.content)), ("final_symlink", self.content)):
            with self.subTest(fault=fault):
                sftp = FakeSFTP(self.clock, fault)
                sftp.files[FINAL] = content
                result = self.run_transfer(sftp)
                self.assertEqual(result["status"], "failed")
                self.assertEqual(sftp.files, {FINAL: content})
                self.assertFalse(any(c[0] in ("write", "rename") for c in sftp.calls))

    def test_rename_confirmation_loss_is_unknown_and_later_call_observes_landed_bytes(self):
        sftp = FakeSFTP(self.clock, "rename_after")
        result = self.run_transfer(sftp)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(self.events[-1][0], "receipt_publish_unknown")
        self.assertFalse(any(name == "receipt_atomic_published" for name, _ in self.events))
        self.assertEqual(sftp.files[FINAL], self.content)
        sftp.fault = None
        before = len([c for c in sftp.calls if c[0] == "rename"])
        retry = self.run_transfer(sftp)
        self.assertEqual(retry["status"], "already_present")
        self.assertEqual(before, len([c for c in sftp.calls if c[0] == "rename"]))
        self.assertEqual(retry["server_acceptance"], "unknown")

    def test_rename_failure_without_landing_is_still_unknown_not_auto_retried(self):
        sftp = FakeSFTP(self.clock, "rename_before")
        result = self.run_transfer(sftp)
        self.assertEqual(result["status"], "unknown")
        self.assertNotIn(FINAL, sftp.files)
        self.assertEqual(sum(c[0] == "rename" for c in sftp.calls), 1)

    def test_original_deadline_checked_before_io_and_before_publication(self):
        sftp = FakeSFTP(self.clock)
        self.clock.value = self.deadline
        self.assertEqual(self.run_transfer(sftp)["status"], "failed")
        self.assertEqual(sftp.calls, [])
        self.clock.value -= timedelta(minutes=1)
        sftp = FakeSFTP(self.clock, "deadline_after_write")
        result = self.run_transfer(sftp)
        self.assertEqual(result["status"], "failed")
        self.assertNotIn(FINAL, sftp.files)
        self.assertFalse(any(c[0] == "rename" for c in sftp.calls))

    def test_invalid_receipt_or_remote_path_never_touches_sftp(self):
        sftp = FakeSFTP(self.clock)
        self.path.write_text('{}', encoding='utf-8')
        with self.assertRaises(ValueError):
            self.run_transfer(sftp)
        self.assertEqual(sftp.calls, [])
        self.path.write_bytes(self.content)
        for remote in ("/tmp/run", REMOTE + "/../other", REMOTE + "\n", "/root/autodl-tmp/liftcut/runs"):
            with self.subTest(remote=remote), self.assertRaises(ValueError):
                transfer.transfer_receipt(sftp, self.path, remote, self.index, self.plan,
                    transfer.EXECUTION_COMMIT, self.deadline, now=self.clock)
        self.assertEqual(sftp.calls, [])


if __name__ == "__main__":
    unittest.main()
