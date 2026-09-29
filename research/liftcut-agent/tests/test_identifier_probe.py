from copy import deepcopy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))
from blind_recovery_ids import PROBE, blind, identifier_hints
from recovery_dataset import load_frozen


class IdentifierProbeTests(unittest.TestCase):
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
