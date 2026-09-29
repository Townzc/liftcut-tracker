from copy import deepcopy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from controlled_recovery import fixtures
from review_controlled import describe_episode
from restore_controlled import validate_index
from liftcut_agent.interactive import digest


def event(tool, arguments=None, ok=True):
    return {"actor": "agent", "action": {"tool": tool, "arguments": arguments or {}},
            "observation": {"ok": ok, "result": {"valid": True}}}


class ControlledReviewTests(unittest.TestCase):
    def test_backup_index_requires_every_part_and_matching_digest(self):
        index = {"status": "complete", "archives": [
            {"part": name, "archive": name + ".tar.gz", "path": ("" if name == "evidence" else "training/") + name + ".tar.gz"}
            for name in ("clean", "mixed", "evidence")]}
        index["inventory_digest"] = digest(index)
        validate_index(index)
        missing = deepcopy(index)
        missing["archives"].pop()
        with self.assertRaisesRegex(ValueError, "inconsistent"):
            validate_index(missing)
        missing["inventory_digest"] = digest({k: missing[k] for k in ("archives", "status")})
        with self.assertRaisesRegex(ValueError, "three distinct"):
            validate_index(missing)
        unsafe = deepcopy(index)
        unsafe["archives"][0]["archive"] = "../clean.tar.gz"
        unsafe["inventory_digest"] = digest({k: unsafe[k] for k in ("archives", "status")})
        with self.assertRaisesRegex(ValueError, "archive path"):
            validate_index(unsafe)

    def test_clarification_after_planning_cannot_satisfy_preplanning_gate(self):
        scenario = deepcopy(next(s for s in fixtures() if s["category"] == "missing_time"))
        scenario["input"]["constraints"]["equipment"] = None
        question = event("request_clarification", {"fields": ["max_minutes"]})
        plan = event("validate_plan", {"plan": {}})
        late = event("request_clarification", {"fields": ["equipment"]})
        ep = {"trace": {"events": [question, plan, late], "score": {}}, "policy_failure": None}
        actual = describe_episode(scenario, None, ep)
        self.assertEqual(actual["accepted_clarification_fields"], ["equipment", "max_minutes"])
        self.assertFalse(actual["clarified_before_planning"])
        ep["trace"]["events"] = [question, late, plan]
        self.assertTrue(describe_episode(scenario, None, ep)["clarified_before_planning"])

    def test_scripted_prefix_and_rejected_question_are_not_model_clarification(self):
        scenario = next(s for s in fixtures() if s["category"] == "missing_time")
        question = event("request_clarification", {"fields": ["max_minutes"]})
        rejected = event("request_clarification", {"fields": ["max_minutes"]}, ok=False)
        ep = {"trace": {"events": [question, rejected], "score": {}}, "policy_failure": None}
        actual = describe_episode(scenario, {"calls": [{}]}, ep)
        self.assertFalse(actual["clarified_before_planning"])
        self.assertEqual(actual["accepted_clarification_fields"], [])
        self.assertEqual(actual["autonomous_action_sequence"], ["request_clarification"])

    def test_failure_before_first_action_remains_visible(self):
        scenario = next(s for s in fixtures() if s["category"] == "missing_time")
        ep = {"trace": {"events": [], "score": {}}, "policy_failure": "output_truncated"}
        row = describe_episode(scenario, None, ep)
        self.assertIsNone(row["first_autonomous_action"])
        self.assertFalse(row["clarified_before_planning"])
        self.assertEqual(row["policy_failure"], "output_truncated")
