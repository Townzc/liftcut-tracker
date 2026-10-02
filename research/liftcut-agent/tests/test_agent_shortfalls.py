from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from analyze_agent_shortfalls import training_row, trace_audit
from liftcut_agent.benchmark import load_catalog, read_jsonl
from state_coverage import original


class ShortfallAuditTests(unittest.TestCase):
    def test_public_source_inventory_is_relative_and_platform_independent(self):
        report = json.loads((ROOT / "reports/agent-shortfalls-2026-10-02.json").read_text(encoding="utf-8"))
        for name in report["source_sha256"]:
            self.assertNotIn("\\", name)
            self.assertNotIn(":", name)
            self.assertFalse(name.startswith("/"))
            self.assertNotIn("..", name.split("/"))

    def test_training_rows_require_train_and_exact_token_pair(self):
        row = {"split": "train", "source_episode_id": "a", "source_call_index": 2, "category": "missing_time",
            "assistant_target_index": 1, "messages": [{"role": "tool", "content": '{"result":{"issues":["wrong_action"]}}'},
            {"tool_calls": [{"function": {"name": "request_clarification", "arguments": {"fields": ["max_minutes"]}}}]}]}
        token = {"source_episode_id": "a", "source_call_index": 2, "target_tokens": 23}
        self.assertEqual(training_row(row, token)["after_errors"], ["wrong_action"])
        for key, value in (("split", "test"), ("source_call_index", 3), ("assistant_target_index", 0)):
            changed = deepcopy(row)
            changed[key] = value
            with self.assertRaises(ValueError):
                training_row(changed, token)

    def test_actual_seed44_failure_separates_right_equipment_and_missing_time(self):
        scenarios = {c["id"]: c for c in original("dev")}
        episodes = read_jsonl(ROOT / "reports/qwen-coverage-replication-seed44-2026-10-02/evaluation/s0/normal/episodes.jsonl")
        episode = next(e for e in episodes if e["scenario_id"].endswith("memory_missing_time"))
        catalog = load_catalog(ROOT / "benchmark/catalog.json")
        result = trace_audit(scenarios[episode["scenario_id"]], catalog, episode["trace"])
        self.assertTrue(result["planning_with_missing_fields"])
        search = next(d for d in result["decisions"] if d["tool"] == "search_exercises")
        self.assertEqual(search["selected_equipment"], search["effective_equipment"])
        self.assertEqual(search["missing_fields_before"], ["max_minutes"])
        self.assertEqual(result["requested_clarifications"], [])
        self.assertEqual(result["invalid_validations"][0]["issues"], ["wrong_action"])
        self.assertEqual(result["tool_errors"], {})
        intervention = result["cpu_clarification_interventions"][0]
        self.assertEqual(intervention["remaining_missing_fields"], [])
        self.assertTrue(intervention["same_validation_after_clarification"]["result"]["valid"])
        self.assertFalse(result["passed"])  # CPU intervention does not rewrite the model result.

    def test_intervention_does_not_invent_an_unavailable_user_answer(self):
        scenarios = {c["id"]: c for c in original("dev")}
        episodes = read_jsonl(ROOT / "reports/qwen-coverage-replication-seed44-2026-10-02/evaluation/s0/normal/episodes.jsonl")
        episode = next(e for e in episodes if e["scenario_id"].endswith("unanswered_time"))
        original_trace = deepcopy(episode["trace"])
        result = trace_audit(scenarios[episode["scenario_id"]], load_catalog(ROOT / "benchmark/catalog.json"), episode["trace"])
        intervention = result["cpu_clarification_interventions"][0]
        self.assertEqual(intervention["real_fixture_user_events"], [])
        self.assertEqual(intervention["remaining_missing_fields"], ["max_minutes"])
        self.assertFalse(intervention["same_validation_after_clarification"]["result"]["valid"])
        self.assertEqual(episode["trace"], original_trace)


if __name__ == "__main__":
    unittest.main()
