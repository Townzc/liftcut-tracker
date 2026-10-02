from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from counterfactual_diagnostics import (PANELS, VALUES, action, arm_budget, fixtures, projection,
    ReferenceTransport, repair_score, replay, run_case, summary)
from liftcut_agent.benchmark import grade, load_catalog
from liftcut_agent.interactive import digest, proposal_case
from liftcut_agent.model_policy import Reply
from state_diagnostics import effective_inputs, reply_for


class SequenceTransport:
    def __init__(self, batches):
        self.batches, self.index = batches, 0

    def complete(self, payload):
        batch = self.batches[self.index]
        self.index += 1
        return batch if isinstance(batch, Reply) else reply_for(batch, self.index)


class CounterfactualDiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.cases = fixtures(cls.catalog)
        budget = arm_budget()
        cls.episodes = [run_case(c, cls.catalog, ReferenceTransport(c), budget) for c in cls.cases]

    def case(self, panel, **factors):
        return deepcopy(next(c for c in self.cases if c["panel"] == panel and all(
            c["factors"].get(k) == v for k, v in factors.items())))

    def execute(self, case, batches):
        return run_case(case, self.catalog, SequenceTransport(batches), arm_budget())

    def test_all_reference_contracts_replay_and_have_distinct_units(self):
        result = summary(self.cases, self.episodes)
        self.assertEqual({k: v["correct"] for k, v in result["panels"].items()}, PANELS)
        self.assertEqual(replay(self.cases, self.catalog, self.episodes), {"replayed": 80})
        approved = [e for c, e in zip(self.cases, self.episodes) if c["panel"] == "consent" and c["factors"]["status"] == "approved"]
        self.assertTrue(all(e["decision"]["correct"] and not e["trace"]["score"]["passed"] for e in approved))
        repair = [e for c, e in zip(self.cases, self.episodes) if c["panel"] == "repair"]
        self.assertTrue(all(e["decision"]["target_field_repaired"] and e["trace"]["score"]["passed"] for e in repair))

    def test_positions_rotate_without_changing_values_or_identity(self):
        for rotation in range(4):
            for invalid in ("unconfirmed", "expired"):
                group = [self.case("memory", rotation=rotation, clarification=True, position=p, invalid=invalid)
                         for p in ("first", "middle", "last")]
                self.assertEqual(len({digest(projection(c)) for c in group}), 1)
                self.assertEqual(len({digest(sorted(c["scenario"]["memories"], key=lambda r: r["id"])) for c in group}), 1)
                self.assertEqual(len({c["prefix"]["next_request_digest"] for c in group}), 3)
        self.assertEqual({effective_inputs(self.case("memory", rotation=r))["constraints"]["equipment"][0] for r in range(4)}, set(VALUES))

    def test_identity_mapping_is_bijective_and_only_changes_ids(self):
        by_id = {c["id"]: c for c in self.cases}
        for renamed in [c for c in self.cases if c["panel"] == "identity"]:
            source = by_id[renamed["paired_case_id"]]
            mapping = renamed["identity_bijection"]
            self.assertEqual(len(mapping), len(set(mapping.values())))
            self.assertTrue(set(mapping).isdisjoint(mapping.values()))
            restored = deepcopy(renamed["scenario"])
            inverse = {v: k for k, v in mapping.items()}
            for r in restored["input"]["records"] + restored["memories"]:
                r["id"] = inverse[r["id"]]
            restored["id"] = source["id"]
            self.assertEqual(restored, source["scenario"])
            self.assertEqual(projection(renamed), projection(source))
            self.assertNotEqual(renamed["prefix"]["next_request_digest"], source["prefix"]["next_request_digest"])

    def test_labels_and_future_user_answers_are_not_in_payload(self):
        for case in self.cases:
            payload = json.dumps(case["prefix"]["next_request"])
            for private in (case["id"], '"expected_terminal"', '"clarification_answers"', '"reference_actions"', '"proof"', '"identity_bijection"', '"snapshot"'):
                self.assertNotIn(private, payload)
            if case["panel"] in {"memory", "identity"}:
                self.assertEqual(effective_inputs(case)["constraints"]["max_minutes"], 30)

    def test_errors_are_single_field_and_negative_controls_have_proof(self):
        by_id = {c["id"]: c for c in self.cases}
        for case in self.cases:
            if case["panel"] == "repair":
                issues = case["prefix"]["trace"]["events"][-1]["observation"]["result"]["issues"]
                self.assertEqual(issues, [case["factors"]["error"]])
                self.assertEqual(grade(proposal_case(effective_inputs(case), self.catalog), case["expected"]["reference_plan"], self.catalog), [])
            if case["panel"] == "infeasible":
                proof = case["expected"]["proof"]
                self.assertGreater(proof["minimum_minutes"], proof["max_minutes"])
                a, b = effective_inputs(case), effective_inputs(by_id[case["paired_case_id"]])
                a["constraints"]["max_minutes"] = b["constraints"]["max_minutes"]
                self.assertEqual(a, b)

    def test_first_response_stops_even_if_only_rereads(self):
        case = self.case("memory")
        result = self.execute(case, [[action("get_context"), action("get_memories")]])
        self.assertEqual(result["decision"]["model_requests"], 1)
        self.assertEqual(result["decision"]["autonomous_actions"], 2)
        self.assertTrue(result["decision"]["defer"])
        self.assertFalse(result["decision"]["correct"])

    def test_entire_response_is_executed_and_contradictions_are_not_credited(self):
        case = self.case("memory")
        good = case["expected"]["reference_action"]
        bad = action("search_exercises", equipment=case["scenario"]["input"]["constraints"]["equipment"])
        result = self.execute(case, [[good, action("get_context"), bad]])
        self.assertEqual(result["decision"]["autonomous_actions"], 3)
        self.assertEqual([s["correct"] for s in result["decision"]["member_scores"]], [True, False])
        self.assertFalse(result["decision"]["correct"])

    def test_mutating_batch_rejected_before_any_execution(self):
        case = self.case("consent", status="approved")
        result = self.execute(case, [[case["expected"]["reference_action"], action("finish", outcome="applied")]])
        self.assertEqual(result["policy_failure"], "non_read_tool_in_batch")
        self.assertEqual(result["decision"]["autonomous_actions"], 0)

    def test_parse_failure_and_timeout_remain_in_denominator(self):
        for reply in (Reply("{}"), Reply("", error="timeout")):
            episodes = deepcopy(self.episodes)
            episodes[0] = self.execute(self.cases[0], [reply])
            result = summary(self.cases, episodes)
            self.assertEqual(result["panels"]["memory"]["total"], 48)
            self.assertEqual(result["panels"]["memory"]["correct"], 47)
            self.assertFalse(episodes[0]["decision"]["defer"])

    def test_repair_then_other_failure_is_not_unrepaired(self):
        case = self.case("repair", error="unknown_evidence")
        broken = deepcopy(case["expected"]["reference_plan"])
        broken["sessions"] = []
        result = self.execute(case, [[action("validate_plan", plan=broken)], [action("finish", outcome="infeasible")]])
        self.assertTrue(result["decision"]["target_field_repaired"])
        self.assertFalse(result["decision"]["premature_infeasible_before_repair"])
        self.assertFalse(result["decision"]["correct"])

    def test_missing_target_field_does_not_masquerade_as_repair(self):
        case = self.case("repair", error="unknown_evidence")
        result = self.execute(case, [[action("validate_plan", plan={"action": "report_infeasible"})], [action("finish", outcome="infeasible")]])
        self.assertFalse(result["decision"]["target_field_repaired"])
        self.assertTrue(result["decision"]["premature_infeasible_before_repair"])

    def test_malformed_plan_is_a_failure_not_a_scoring_crash(self):
        case = self.case("repair")
        result = self.execute(case, [[action("validate_plan", plan=42)], [action("finish", outcome="infeasible")]])
        self.assertFalse(result["decision"]["target_field_repaired"])
        self.assertFalse(result["decision"]["correct"])
        self.assertIn("invalid_arguments", result["trace"]["score"]["tool_errors"])

    def test_invalid_reread_is_not_defer(self):
        case = self.case("memory")
        result = self.execute(case, [[action("get_context", extra=True)]])
        self.assertFalse(result["decision"]["defer"])
        self.assertFalse(result["decision"]["correct"])

    def test_continuation_is_bounded_and_drains_last_batch(self):
        case = self.case("repair")
        result = self.execute(case, [[action("get_context"), action("get_memories")]] * 8)
        self.assertEqual(result["decision"]["model_requests"], 8)
        self.assertEqual(result["decision"]["autonomous_actions"], 16)
        self.assertEqual(result["stop_reason"], "request_limit")
        self.assertFalse(result["decision"]["correct"])

    def test_missing_duplicate_or_reordered_rows_are_rejected(self):
        for episodes in (self.episodes[:-1], [self.episodes[0]] * 80, list(reversed(self.episodes))):
            with self.assertRaisesRegex(ValueError, "denominator"):
                summary(self.cases, episodes)

    def test_tampered_raw_response_or_score_cannot_replay(self):
        for kind in ("score", "response"):
            episodes = deepcopy(self.episodes)
            if kind == "score":
                episodes[0]["decision"]["correct"] = False
            else:
                episodes[0]["calls"][-1]["response"]["body"] = "{}"
            with self.assertRaises(ValueError):
                replay(self.cases, self.catalog, episodes)


if __name__ == "__main__":
    unittest.main()
