from collections import Counter
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from gpu_state_diagnostics import read
from publish_state_diagnostics import public_paths, verify_publication
from review_state_diagnostics import review
from server_workspace import dump_new, sha256
from state_diagnostics import REVIEWED, prepare

REPORT = ROOT / "reports/qwen-state-diagnostics-2026-09-29"


class StateDiagnosticEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.prepared = Path(cls.tmp.name) / "prepared"
        prepare(cls.prepared)
        # This stdlib test reuses frozen token evidence; tokenizer CI independently
        # recomputes these token IDs/lengths with the real pinned tokenizer.
        dump_new(cls.prepared / "tokenizer-report.json", read(REVIEWED)["tokenizer"])
        cls.result = verify_publication(REPORT, cls.prepared)
        cls.review = review(REPORT, cls.prepared)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_all_38_real_continuations_and_44_native_generations_replay(self):
        self.assertEqual(self.result["total_states_replayed"], 38)
        self.assertEqual(sum(a["actual_model_generations"] for a in self.result["arms"].values()), 44)
        self.assertEqual([self.result["arms"][a]["panels"]["consent"]["correct"] for a in ("clean", "mixed")], [5, 6])
        self.assertEqual([self.result["arms"][a]["panels"]["memory"]["correct"] for a in ("clean", "mixed")], [2, 1])
        self.assertEqual(self.review, read(REPORT / "review.json"))

    def test_all_read_history_consent_cases_restart_search_instead_of_finishing(self):
        for arm in ("clean", "mixed"):
            selected = [r for r in self.review["cases"][arm] if r["factors"].get("history") == "read"]
            self.assertEqual(len(selected), 3)
            for row in selected:
                self.assertFalse(row["correct"])
                self.assertEqual(row["first_decision"]["tool"], "search_exercises")
                self.assertEqual(row["rereads_before_decision"], 1)
                self.assertEqual([a["tool"] for a in row["autonomous_actions"]], ["get_memories", "search_exercises"])
            self.assertTrue(all(c["business_state_equal"] for c in self.review["consent_history_contrasts"][arm]))

    def test_memory_value_matches_keep_control_separate_and_do_not_imply_causality(self):
        def roles(arm):
            return Counter(m["role"] for r in self.review["cases"][arm] if r["factors"].get("position") is not None
                           for m in r["observed_value_matches"])
        self.assertEqual(roles("clean"), {"raw_context": 7, "current_confirmed_memory": 1})
        self.assertEqual(roles("mixed"), {"older_confirmed_memory": 6, "unconfirmed_memory": 1, "expired_memory": 1})
        self.assertIn("not establish", self.review["interpretation_limit"])

    def test_public_inventory_is_exact_and_contains_no_weights(self):
        manifest = read(REPORT / "publication-manifest.json")
        actual = {p.relative_to(REPORT).as_posix(): sha256(p) for p in REPORT.rglob("*")
                  if p.is_file() and p.name != "publication-manifest.json"}
        self.assertEqual(actual, manifest["files"])
        self.assertEqual(set(actual), set(public_paths()) | {"review.json", "README.md", "adapter-verification.json"})
        self.assertFalse(any(p.endswith((".safetensors", ".pt", ".bin")) for p in actual))

    def test_changed_public_file_rejected_before_audit(self):
        with tempfile.TemporaryDirectory() as folder:
            run = Path(folder) / "report"
            shutil.copytree(REPORT, run)
            changed = run / "evaluation/clean/generations.jsonl"
            changed.write_bytes(changed.read_bytes() + b" ")
            with self.assertRaisesRegex(ValueError, "inventory mismatch"):
                verify_publication(run, self.prepared)

    def test_updated_hash_cannot_hide_forged_descriptive_review(self):
        with tempfile.TemporaryDirectory() as folder:
            run = Path(folder) / "report"
            shutil.copytree(REPORT, run)
            changed = run / "review.json"
            value = read(changed)
            value["cases"]["clean"][0]["correct"] = True
            import json
            changed.write_text(json.dumps(value), encoding="utf-8")
            manifest_path = run / "publication-manifest.json"
            manifest = read(manifest_path)
            manifest["files"]["review.json"] = sha256(changed)
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "review differs"):
                verify_publication(run, self.prepared)


if __name__ == "__main__":
    unittest.main()
