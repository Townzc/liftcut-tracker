"""Guard the retrospective design audit against false recovery and denominator claims."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyze_coverage_followup import PUBLISHED, checked, describe_arm, read, sha, training_summary


class FollowupAnalysisTests(unittest.TestCase):
    def test_counts_observed_validation_errors_once_per_decision(self):
        feedback = {"role": "tool", "content": json.dumps({"result": {"issues": ["unknown_evidence"]}})}
        row = {"split": "train", "messages": [feedback, feedback,
            {"role": "assistant", "content": None, "tool_calls": [{"function": {
                "name": "finish", "arguments": {"outcome": "infeasible"}}}]}]}
        summary = training_summary([row])
        self.assertEqual(summary["decisions_after_named_validation_error"]["unknown_evidence"], 1)
        self.assertEqual(summary["finish_outcomes"], {"infeasible": 1})

    def test_instruction_mentions_and_other_errors_are_not_recovery_examples(self):
        row = {"split": "train", "messages": [
            {"role": "system", "content": "unknown_evidence session_count_mismatch"},
            {"role": "tool", "content": json.dumps({"result": {"issues": ["wrong_action"]}})},
            {"role": "assistant", "tool_calls": [{"function": {"name": "get_context", "arguments": {}}}]}]}
        self.assertEqual(sum(training_summary([row])["decisions_after_named_validation_error"].values()), 0)
        row["split"] = "test"
        with self.assertRaisesRegex(ValueError, "training decisions only"):
            training_summary([row])

    def test_true_infeasible_is_not_counted_as_repairable_failure(self):
        arm = read(PUBLISHED / "review.json")["arms"]["t"]
        result = describe_arm(arm)
        self.assertEqual({r["scenario_id"] for r in result["failed_tasks_with_named_validation_errors"]},
                         {"r2-05-missing_time", "r2-05-missing_equipment", "r2-05-missing_days"})
        self.assertEqual(result["memory_subgroups"]["invalid"],
                         {"expired": {"correct": 3, "total": 4}, "unconfirmed": {"correct": 1, "total": 4}})

    def test_missing_or_duplicated_probe_cannot_change_denominator(self):
        arm = read(PUBLISHED / "review.json")["arms"]["s0"]
        missing = copy.deepcopy(arm)
        missing["diagnostic_cases"] = [r for r in missing["diagnostic_cases"] if r["case_id"] != "sd1-memory-0-first-expired"]
        with self.assertRaisesRegex(ValueError, "eight paired"):
            describe_arm(missing)
        missing["diagnostic_cases"].append(next(r for r in missing["diagnostic_cases"] if r["case_id"] == "sd1-memory-0-last-expired"))
        with self.assertRaisesRegex(ValueError, "eight paired"):
            describe_arm(missing)

    def test_altered_prepared_data_rejected_before_analysis(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.jsonl"
            path.write_text("original", encoding="utf-8")
            expected = sha(path)
            path.write_text("altered", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                checked(path, expected)
