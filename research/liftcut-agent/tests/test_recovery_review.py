from copy import deepcopy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from blind_recovery_ids import PROBE
from liftcut_agent.benchmark import load_catalog, read_jsonl
from recovery_dataset import load_frozen
from review_recovery import RUN, contract_probes, evaluation_summary, fixture_coverage, partial_diagnostic


class RecoveryReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.cases = {s["id"]: s for s in load_frozen(PROBE)}
        cls.episodes = read_jsonl(RUN / "identifier-probe/clean/episodes.jsonl")

    def test_counterfactual_exposes_masked_equipment_issue_without_rewriting_score(self):
        episode = next(e for e in self.episodes if e["scenario_id"] == "r1-04-partial_clarification")
        case = self.cases[episode["scenario_id"]]
        before = deepcopy((case, episode))
        result = partial_diagnostic(case, episode, self.catalog)
        self.assertEqual(result["original_issues"], ["wrong_action"])
        self.assertEqual(result["same_plan_issues_if_fixture_answer_supplied_to_grader_only"],
                         ["equipment_or_exclusion_violation"])
        self.assertEqual((case, episode), before)
        self.assertFalse(episode["trace"]["score"]["passed"])

    def test_counterfactual_does_not_assume_all_partial_cases_have_bad_equipment(self):
        episode = next(e for e in self.episodes if e["scenario_id"] == "r1-06-partial_clarification")
        result = partial_diagnostic(self.cases[episode["scenario_id"]], episode, self.catalog)
        self.assertEqual(result["same_plan_issues_if_fixture_answer_supplied_to_grader_only"], [])
        self.assertFalse(episode["trace"]["score"]["passed"])

    def test_counterfactual_rejects_a_history_where_information_already_arrived(self):
        episode = deepcopy(next(e for e in self.episodes if e["scenario_id"] == "r1-04-partial_clarification"))
        episode["trace"]["events"][2] = {"index": 2, "actor": "user", "action": {}}
        with self.assertRaisesRegex(ValueError, "unchanged"):
            partial_diagnostic(self.cases[episode["scenario_id"]], episode, self.catalog)

    def test_rejected_clarification_is_not_counted_as_accepted_information_request(self):
        result = evaluation_summary(self.episodes, [], self.cases, self.catalog)
        partial = result["by_category"]["partial_clarification"]
        self.assertEqual(partial["clarification_requests"], 3)
        self.assertEqual(partial["accepted_clarification_requests"], 0)
        self.assertEqual(partial["passed"], 0)

    def test_memory_coverage_counts_input_order_instead_of_asserting_diversity(self):
        cases = load_frozen()
        original = fixture_coverage(cases)
        self.assertEqual(original["missing_constraint_cases"], 3)
        self.assertEqual(original["missing_cases_with_memory_update"], 3)
        self.assertEqual(original["memory_cases_with_highest_revision_last"], 6)
        for case in cases:
            case["memories"].reverse()
        self.assertEqual(fixture_coverage(cases)["memory_cases_with_highest_revision_last"], 0)

    def test_contract_counterexamples_are_reproducible_and_do_not_modify_cases(self):
        cases = load_frozen()
        before = deepcopy(cases)
        result = contract_probes(cases, self.catalog)
        self.assertTrue(result["selected_memory_evidence_omitted_but_plan_valid"])
        self.assertTrue(result["hidden_approval_change_preserves_initial_and_reads"])
        self.assertTrue(result["hidden_approval_change_alters_scenario_derived_proposal_id"])
        self.assertEqual(cases, before)


if __name__ == "__main__":
    unittest.main()
