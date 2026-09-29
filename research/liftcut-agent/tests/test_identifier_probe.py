from copy import deepcopy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))
from blind_recovery_ids import PROBE, blind, identifier_hints
from recovery_dataset import load_frozen
from audit_identifier_probe import paired, verify_intervention


class IdentifierProbeTests(unittest.TestCase):
    def test_hidden_label_or_user_behavior_changes_are_rejected(self):
        original = load_frozen()
        probe = [blind(row) for row in original]
        verify_intervention(original, probe)
        probe[0]["category"] = "different"
        with self.assertRaisesRegex(ValueError, "beyond"):
            verify_intervention(original, probe)

    def test_paired_changes_require_complete_matched_order(self):
        before = [{"scenario_id": "a", "passed": True}, {"scenario_id": "b", "passed": False}]
        after = [{"scenario_id": "a", "passed": False}, {"scenario_id": "b", "passed": True}]
        result = paired(before, after)
        self.assertEqual(result["counts"], {"both_passed": 0, "before_only": 1, "after_only": 1, "both_failed": 0})
        with self.assertRaisesRegex(ValueError, "identity/order"):
            paired(before, list(reversed(after)))
        with self.assertRaisesRegex(ValueError, "identity/order"):
            paired(before, after[:1])

    def test_original_leak_is_detected_and_probe_preserves_every_other_field(self):
        original = load_frozen()
        probe = {row["id"]: row for row in load_frozen(PROBE)}
        self.assertEqual(len(original), 48)
        self.assertEqual(sum(bool(identifier_hints(row)) for row in original), 48)
        identities = set()
        for row in original:
            before = deepcopy(row)
            transformed = blind(row)
            self.assertEqual(row, before)
            self.assertEqual(transformed, probe[row["id"]])
            self.assertFalse(identifier_hints(transformed))
            restored = deepcopy(transformed)
            for old, new, target in zip(row["input"]["records"], transformed["input"]["records"], restored["input"]["records"]):
                self.assertRegex(new["id"], r"^record-[0-9a-f]{12}$")
                self.assertNotIn(new["id"], identities)
                identities.add(new["id"])
                target["id"] = old["id"]
            for old, new, target in zip(row["memories"], transformed["memories"], restored["memories"]):
                self.assertRegex(new["id"], r"^memory-[0-9a-f]{12}$")
                self.assertNotIn(new["id"], identities)
                identities.add(new["id"])
                target["id"] = old["id"]
            self.assertEqual(restored, row)


if __name__ == "__main__":
    unittest.main()
