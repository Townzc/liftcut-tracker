from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from controlled_recovery import prepare
from gpu_state_diagnostics import read
from review_training_state_coverage import REPORT, coverage


class TrainingStateCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.prepared = Path(cls.tmp.name) / "prepared"
        prepare(cls.prepared / "decisions")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_exact_training_pools_reproduce_saved_coverage_and_missing_crosses(self):
        result = coverage(self.prepared)
        self.assertEqual(result, read(REPORT))
        self.assertEqual(result["memory_position_invalid_cross"],
            {"first/unconfirmed": 4, "first/expired": 0, "last/unconfirmed": 0, "last/expired": 4})
        self.assertTrue(all(r["raw_old_invalid_same_value"] and r["distinct_equipment_values"] == 2 for r in result["memory_fixtures"]))
        for pool in result["decision_pools"].values():
            self.assertEqual(pool["unique_decisions"], 324)
            self.assertEqual(pool["last_tool_to_target"]["get_context"], {"get_memories": 64})
            self.assertEqual(pool["finish_after_context_or_memory_read"], 0)

    def test_changed_training_rows_are_rejected_before_coverage_claim(self):
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "prepared"
            shutil.copytree(self.prepared, copied)
            changed = copied / "decisions/clean/decisions.jsonl"
            changed.write_bytes(changed.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "training decisions differ"):
                coverage(copied)


if __name__ == "__main__":
    unittest.main()
