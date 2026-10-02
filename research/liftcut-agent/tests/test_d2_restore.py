"""Real bounded archives; only integrity-only synthetic partial receipts."""
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import d2_execution as d2
import restore_counterfactual_diagnostics as recovery
from run_recovery_window import archive_run
from server_workspace import dump_new, sha256


class RestoreTests(unittest.TestCase):
    def archive(self, root, status="partial"):
        plan = d2.read(d2.REVIEWED)
        boot = "2026-10-02T12:00:00+00:00"
        bind = d2.binding(plan, "0" * 40, boot)
        run = root / "evidence"
        dump_new(run / "opening.json", {"binding": bind, "booted_at_proxy": boot, "budget": d2.BUDGET,
            "evidence_kind": "scripted_contract", "started_at_utc": "2026-10-02T12:01:00+00:00"})
        dump_new(run / "window-status.json", {"binding": bind, "status": status})
        backup = archive_run(run)
        index = {"version": "d2-backup-v1", "binding": bind, "evidence_kind": "scripted_contract", "status": status, **backup}
        return plan, index, root / "evidence.tar.gz"

    def test_partial_real_archive_integrity_receipt_makes_no_model_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan, index, archive = self.archive(root)
            with patch.object(recovery, "verify_plan", return_value=plan):
                result = recovery.restore_d2(archive, root / "restored", index, root, root, root,
                                             allow_partial=True, allow_scripted=True)
            self.assertEqual(result["episodes_replayed"], 0)
            self.assertFalse(result["adapter_files_verified"])
            self.assertFalse(result["model_result"])
            self.assertTrue(result["all_inventory_files_verified"])

    def test_partial_without_optin_restores_bytes_but_emits_no_ack(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan, index, archive = self.archive(root)
            with patch.object(recovery, "verify_plan", return_value=plan), self.assertRaises(ValueError):
                recovery.restore_d2(archive, root / "restored", index, root, root, root, allow_scripted=True)
            self.assertTrue((root / "restored/restore-receipt.json").exists())
            self.assertFalse((root / "restored/off-instance-backup.json").exists())

    def test_complete_without_actual_weights_never_emits_ack(self):
        import audit_counterfactual_diagnostics as auditing
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan, index, archive = self.archive(root, "complete")
            with patch.object(recovery, "verify_plan", return_value=plan), patch.object(auditing, "verify_plan", return_value=plan), self.assertRaises(ValueError):
                recovery.restore_d2(archive, root / "restored", index, root, root, root, allow_scripted=True)
            self.assertFalse((root / "restored/off-instance-backup.json").exists())

    def test_wrong_hash_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, index, archive = self.archive(root)
            index["sha256"] = "a" * 64
            with self.assertRaises(ValueError):
                recovery.restore_d2(archive, root / "restored", index, root, root, root, allow_scripted=True)
            self.assertFalse((root / "restored").exists())

    def test_member_count_bound_applies_before_generic_extractor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, index, _ = self.archive(root)
            archive = root / "over-count.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                for i in range(2001):
                    tar.addfile(tarfile.TarInfo("root/" + str(i)))
            index.update(bytes=archive.stat().st_size, sha256=sha256(archive))
            with self.assertRaisesRegex(ValueError, "bounded evidence"):
                recovery.restore_d2(archive, root / "restored", index, root, root, root, allow_scripted=True)
            self.assertFalse((root / "restored").exists())


if __name__ == "__main__":
    unittest.main()
