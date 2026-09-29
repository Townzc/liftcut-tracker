from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from review_state_coverage import training_statistics
from liftcut_agent.interactive import digest
from publish_state_coverage import verify_restore_scope
from server_workspace import dump_new
from state_coverage import ARMS


class CoverageReviewStatisticsTests(unittest.TestCase):
    def fixture(self):
        counts = [330] * 125 + [538]
        total, log = 0, []
        for i, count in enumerate(counts):
            total += count
            log.append({"loss": 1.0 if i < 63 else 5.0 if i == 125 else 3.0, "supervised_tokens": total})
        report = {"processed": {"decisions": 1008, "input_tokens": 100000},
            "training_seconds_including_checkpoints": 100, "peak_allocated_bytes": 2**30,
            "peak_reserved_bytes": 2**31, "reload_max_logit_difference": 0}
        return log, report

    def test_epoch_loss_and_timer_scope_do_not_claim_task_accuracy(self):
        log, report = self.fixture()
        result = training_statistics(log, report)
        self.assertEqual(result["target_weighted_epoch_losses"][0], 1.0)
        self.assertAlmostEqual(result["target_weighted_epoch_losses"][1], (62 * 330 * 3 + 538 * 5) / 20998)
        self.assertNotAlmostEqual(result["target_weighted_epoch_losses"][1], (62 * 3 + 5) / 63)
        self.assertEqual(result["input_tokens_per_optimization_second"], 1000)
        self.assertEqual(result["peak_allocated_gib"], 1)
        self.assertIn("Excludes model load", result["timer_limit"])
        self.assertIn("loss is not task success", result["timer_limit"])

    def test_forged_target_denominator_is_rejected(self):
        log, report = self.fixture()
        log[-1]["supervised_tokens"] += 1
        with self.assertRaisesRegex(ValueError, "denominator"):
            training_statistics(log, report)


class CoveragePublicationReceiptTests(unittest.TestCase):
    def fixture(self, root, change=None):
        archives = [{"part": a, "archive": a + ".tar.gz", "path": ("" if a == "evidence" else "training/") + a + ".tar.gz",
                     "bytes": 123, "sha256": str(i) * 64} for i, a in enumerate((*ARMS, "evidence"))]
        payload = {"archives": archives, "status": "complete"}
        index = {**payload, "inventory_digest": digest(payload)}
        receipt = {"run_status": "complete", "inventory_digest": index["inventory_digest"],
            "all_archive_files_verified": True, "complete_study_replayed": True, "episodes_replayed": 124,
            "adapter_files_verified": True, "test_episodes": 0,
            "archives": [{k: a[k] for k in ("archive", "bytes", "sha256")} |
                         {"verified_files": 3, "all_inventory_files_verified": True} for a in archives]}
        if change:
            change(receipt)
        dump_new(root / "backup-index.json", index)
        dump_new(root / "off-instance-verification.json", receipt)
        dump_new(root / "window-status.json", {"status": "complete", "failures": []})

    def test_complete_receipt_must_reference_the_same_five_archives(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            self.assertTrue(verify_restore_scope(root)["adapter_files_verified"])

    def test_altered_archive_hash_or_count_cannot_claim_restore(self):
        changes = [lambda r: r["archives"][2].update(sha256="f" * 64),
                   lambda r: r["archives"].pop(),
                   lambda r: r["archives"][0].update(all_inventory_files_verified=False)]
        for change in changes:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                self.fixture(root, change)
                with self.assertRaisesRegex(ValueError, "five-archive inventory"):
                    verify_restore_scope(root)

    def test_metadata_only_or_partial_claim_cannot_publish_complete_study(self):
        for update in ({"adapter_files_verified": False}, {"complete_study_replayed": False},
                       {"episodes_replayed": 123}):
            with self.subTest(update=update), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                self.fixture(root, lambda r: r.update(update))
                with self.assertRaisesRegex(ValueError, "complete off-instance"):
                    verify_restore_scope(root)


if __name__ == "__main__":
    unittest.main()
