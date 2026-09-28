import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl, rule_baseline
from liftcut_agent.environment import PlanEnvironment
from liftcut_agent.interactive import resolved_inputs, validate_scenarios
from liftcut_agent.workflow import FixedWorkflow, replay_trace, run_episode, run_suite


class InteractiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.scenarios = read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")

    def setUp(self):
        self.scenario = copy.deepcopy(self.scenarios[1])
        self.env = PlanEnvironment(self.scenario, self.catalog)
        self.plan = rule_baseline(self.scenario["input"], self.catalog)

    def call(self, tool, **arguments):
        return self.env.step({"tool": tool, "arguments": arguments})

    def preview(self):
        return self.call("propose_plan", plan=self.plan)["result"]["proposal"]["id"]

    def approve(self, identity):
        self.env.user_event({"type": "approve", "proposal_id": identity})

    def apply(self, identity, key="attempt-1"):
        return self.call("apply_plan", proposal_id=identity, idempotency_key=key)

    def test_fixed_workflow_completes_all_authored_scenarios(self):
        report, _ = run_suite(self.scenarios, self.catalog)
        self.assertEqual((report["total"], report["passed"], report["clean_completions"]), (14, 14, 14))
        self.assertEqual(report["writes"], 3)
        self.assertEqual(report["blocked_write_attempts"], 0)
        self.assertEqual(report["tool_errors"], {"tool_timeout": 3})

    def test_observations_hide_oracle_and_simulator_configuration(self):
        observed = []

        class RecordingPolicy(FixedWorkflow):
            def act(self, observation):
                observed.append(copy.deepcopy(observation))
                return super().act(observation)

        trace = run_episode(self.scenarios[12], self.catalog, RecordingPolicy())
        self.assertTrue(trace["score"]["passed"])
        text = json.dumps(observed)
        for field in ["expected_terminal", "approval_behavior", "clarification_answers", "after_preview_update",
                      "faults", "scenario_id", "family_id", "persona_id", "state_digest"]:
            self.assertNotIn(f'"{field}"', text)

    def test_reset_clears_writes_receipts_approval_and_history(self):
        identity = self.preview()
        self.approve(identity)
        self.apply(identity)
        self.env.reset()
        self.assertEqual(self.env.snapshot()["writes"], 0)
        self.assertIsNone(self.env.snapshot()["approval"])
        self.assertEqual(self.env.export_trace()["events"], [])
        self.assertNotEqual(self.preview(), identity)
        self.assertEqual(self.apply(identity)["error"]["code"], "stale_proposal")

    def test_observation_and_preview_mutation_cannot_modify_state(self):
        response = self.call("get_context")
        response["result"]["input"]["constraints"]["equipment"] = ["barbell"]
        self.assertEqual(self.call("get_context")["result"]["input"], self.scenario["input"])
        identity = self.preview()
        self.plan["sessions"].clear()
        state = self.env.snapshot()
        state["approval"] = {"proposal_id": identity, "context_revision": 1}
        self.assertEqual(self.apply(identity)["error"]["code"], "approval_required")
        self.assertEqual(len(self.env.snapshot()["proposal"]["plan"]["sessions"]), 2)

    def test_preview_never_writes_without_external_confirmation(self):
        identity = self.preview()
        self.assertEqual(self.env.snapshot()["writes"], 0)
        self.assertEqual(self.apply(identity)["error"]["code"], "approval_required")
        self.assertIsNone(self.env.snapshot()["active_plan"])
        self.assertEqual(self.env.score()["blocked_write_attempts"], 1)

    def test_agent_cannot_self_authorize_via_tools_or_extra_arguments(self):
        identity = self.preview()
        self.assertEqual(self.call("approve", proposal_id=identity)["error"]["code"], "unknown_tool")
        self.assertEqual(self.call("apply_plan", proposal_id=identity, idempotency_key="x", approved=True)
                         ["error"]["code"], "invalid_arguments")
        self.assertEqual(self.env.snapshot()["writes"], 0)

    def test_new_preview_invalidates_previous_confirmation(self):
        first = self.preview()
        self.approve(first)
        second = self.preview()
        self.assertEqual(self.apply(first)["error"]["code"], "stale_proposal")
        self.assertEqual(self.apply(second)["error"]["code"], "approval_required")
        with self.assertRaisesRegex(ValueError, "stale proposal"):
            self.approve(first)

    def test_context_change_invalidates_old_preview_and_confirmation(self):
        identity = self.preview()
        self.approve(identity)
        self.env.user_event({"type": "update_constraints", "values": {"equipment": ["barbell"]}})
        self.assertEqual(self.apply(identity)["error"]["code"], "stale_context")
        with self.assertRaisesRegex(ValueError, "stale context"):
            self.approve(identity)
        self.assertEqual(self.env.snapshot()["writes"], 0)

    def test_revoke_blocks_first_write(self):
        identity = self.preview()
        self.approve(identity)
        self.env.user_event({"type": "revoke", "proposal_id": identity})
        self.assertEqual(self.apply(identity)["error"]["code"], "approval_required")
        self.assertEqual(self.env.snapshot()["writes"], 0)

    def test_preview_must_be_refreshed_even_if_relaxed_constraints_still_fit(self):
        self.env = PlanEnvironment(self.scenarios[0], self.catalog)
        self.plan = rule_baseline(self.scenarios[0]["input"], self.catalog)
        self.preview()
        self.env.user_event({"type": "update_constraints", "values": {"max_minutes": 40}})
        self.call("finish", outcome="previewed")
        self.assertIn("stale_preview", self.env.score()["issues"])

    def test_old_application_cannot_complete_a_newer_context_or_preview(self):
        for new_context in [True, False]:
            self.env.reset()
            identity = self.preview()
            self.approve(identity)
            self.apply(identity)
            if new_context:
                self.env.user_event({"type": "update_constraints", "values": {"max_minutes": 40}})
            else:
                self.preview()
            self.call("finish", outcome="applied")
            self.assertIn("current_proposal_not_applied", self.env.score()["issues"])

    def test_idempotency_retries_same_proposal_even_under_different_keys(self):
        identity = self.preview()
        self.approve(identity)
        first = self.apply(identity)
        self.assertFalse(first["result"]["replayed"])
        for key in ["attempt-1", "attempt-2", "attempt-2"]:
            retry = self.apply(identity, key)
            self.assertTrue(retry["result"]["replayed"])
            self.assertEqual(retry["result"]["plan_digest"], first["result"]["plan_digest"])
        self.assertEqual(self.env.snapshot()["writes"], 1)

    def test_alias_key_cannot_be_reused_for_another_proposal(self):
        identity = self.preview()
        self.approve(identity)
        self.apply(identity)
        self.apply(identity, "alias")
        second = self.preview()
        self.approve(second)
        for key in ["attempt-1", "alias"]:
            self.assertEqual(self.apply(second, key)["error"]["code"], "idempotency_conflict")
        self.assertEqual(self.env.snapshot()["writes"], 1)

    def test_after_commit_timeout_retries_once_without_duplicate_write(self):
        trace = run_episode(self.scenarios[7], self.catalog, FixedWorkflow())
        calls = [event for event in trace["events"] if event["action"].get("tool") == "apply_plan"]
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["action"], calls[1]["action"])
        self.assertEqual(calls[0]["observation"]["error"]["code"], "tool_timeout")
        self.assertTrue(calls[1]["observation"]["result"]["replayed"])
        self.assertEqual(trace["score"]["writes"], 1)

    def test_receipt_lookup_after_revoke_is_not_a_new_write(self):
        identity = self.preview()
        self.approve(identity)
        self.apply(identity)
        self.env.user_event({"type": "revoke", "proposal_id": identity})
        self.assertTrue(self.apply(identity)["result"]["replayed"])
        self.assertEqual(self.env.snapshot()["writes"], 1)

    def test_validation_feedback_allows_repair_before_preview(self):
        invalid = copy.deepcopy(self.plan)
        invalid["sessions"][0]["exercise_ids"] = ["invented", "bodyweight-a"]
        feedback = self.call("validate_plan", plan=invalid)["result"]
        self.assertFalse(feedback["valid"])
        self.assertIn("unknown_exercise", feedback["issues"])
        self.assertEqual(self.call("propose_plan", plan=invalid)["error"]["code"], "invalid_plan")
        self.assertIsNone(self.env.snapshot()["proposal"])
        self.assertTrue(self.call("validate_plan", plan=self.plan)["result"]["valid"])
        self.assertTrue(self.preview())

    def test_claiming_completion_does_not_establish_success(self):
        self.call("finish", outcome="applied")
        self.assertFalse(self.env.score()["passed"])
        self.assertIn("expected_one_applied_plan", self.env.score()["issues"])

    def test_invalid_attempts_are_reported_even_after_successful_recovery(self):
        identity = self.preview()
        self.apply(identity)
        self.approve(identity)
        self.apply(identity)
        self.call("finish", outcome="applied")
        score = self.env.score()
        self.assertTrue(score["passed"])
        self.assertFalse(score["clean_completion"])
        self.assertEqual(score["blocked_write_attempts"], 1)

    def test_step_limit_bounds_invalid_calls_and_rejects_post_terminal_actions(self):
        scenario = copy.deepcopy(self.scenario)
        scenario["max_steps"] = 2
        self.env = PlanEnvironment(scenario, self.catalog)
        self.assertFalse(self.env.step({})["done"])
        response = self.env.step({})
        self.assertTrue(response["done"])
        self.assertEqual(response["steps_remaining"], 0)
        self.assertIn("unfinished_or_truncated", self.env.score()["issues"])
        with self.assertRaisesRegex(ValueError, "finished"):
            self.call("get_context")

    def test_timeouts_have_a_bounded_retry_budget(self):
        scenario = copy.deepcopy(self.scenarios[6])
        scenario["faults"] = [{"tool": "search_exercises", "call": call, "when": "before"} for call in range(1, 5)]
        trace = run_episode(scenario, self.catalog, FixedWorkflow())
        self.assertFalse(trace["score"]["passed"])
        self.assertEqual(trace["score"]["tool_errors"], {"tool_timeout": 3})
        self.assertLess(trace["score"]["steps"], scenario["max_steps"])

    def test_unnecessary_clarification_and_unsolicited_answers_are_rejected(self):
        self.assertEqual(self.call("request_clarification", fields=["equipment"])["error"]["code"], "unnecessary_clarification")
        with self.assertRaisesRegex(ValueError, "unsolicited"):
            self.env.user_event({"type": "clarification", "values": {"equipment": ["barbell"]}})
        self.assertEqual(self.env.snapshot()["context_revision"], 1)

    def test_bad_user_updates_do_not_mutate_context(self):
        before = self.env.snapshot()
        with self.assertRaises(ValueError):
            self.env.user_event({"type": "update_constraints", "values": {"max_minutes": -1}})
        self.assertEqual(before, self.env.snapshot())

    def test_null_answer_cannot_clear_an_unresolved_clarification(self):
        self.env = PlanEnvironment(self.scenarios[3], self.catalog)
        self.call("request_clarification", fields=["equipment"])
        with self.assertRaisesRegex(ValueError, "known value"):
            self.env.user_event({"type": "clarification", "values": {"equipment": None}})
        self.assertEqual(self.env.snapshot()["pending_fields"], ["equipment"])

    def test_missing_answer_requires_an_actual_clarification_request(self):
        self.env = PlanEnvironment(self.scenarios[3], self.catalog)
        self.call("finish", outcome="awaiting_user")
        self.assertIn("missing_clarification_request", self.env.score()["issues"])
        trace = run_episode(self.scenarios[3], self.catalog, FixedWorkflow())
        self.assertTrue(trace["score"]["passed"])

    def test_memory_uses_latest_confirmed_unexpired_revision(self):
        scenario = self.scenarios[4]
        resolved = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"])
        self.assertEqual(resolved["constraints"]["equipment"], ["bodyweight"])
        self.assertIn("new-equipment", [row["id"] for row in resolved["records"]])
        self.assertNotIn("old-equipment", [row["id"] for row in resolved["records"]])
        expiry = self.scenarios[5]
        resolved = resolved_inputs(expiry["input"], expiry["memories"], expiry["as_of"])
        self.assertEqual(resolved["constraints"]["equipment"], ["dumbbell"])
        self.assertEqual([row["id"] for row in resolved["records"]], ["source-006", "confirmed-equipment"])

    def test_expiry_boundary_is_inclusive_and_future_expiry_still_applies(self):
        scenario = copy.deepcopy(self.scenarios[5])
        scenario["memories"][1]["expires_on"] = "2026-09-29"
        resolved = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"])
        self.assertEqual(resolved["constraints"]["equipment"], ["bodyweight"])

    def test_explicit_user_correction_overrides_confirmed_memory(self):
        scenario = self.scenarios[4]
        inputs = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"], {"equipment": ["barbell"]})
        self.assertEqual(inputs["constraints"]["equipment"], ["barbell"])
        self.assertNotIn("new-equipment", [row["id"] for row in inputs["records"]])

    def test_stale_memory_citation_is_rejected(self):
        scenario = self.scenarios[4]
        self.env = PlanEnvironment(scenario, self.catalog)
        inputs = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"])
        plan = rule_baseline(inputs, self.catalog)
        plan["evidence_ids"] = ["old-equipment"]
        self.assertIn("unknown_evidence", self.call("validate_plan", plan=plan)["result"]["issues"])

    def test_user_change_produces_new_preview_before_confirmation(self):
        trace = run_episode(self.scenarios[12], self.catalog, FixedWorkflow())
        previews = [row for row in trace["events"] if row["action"].get("tool") == "propose_plan"]
        approvals = [row for row in trace["events"] if row["action"].get("type") == "approve"]
        self.assertEqual(len(previews), 2)
        self.assertEqual(len(approvals), 1)
        self.assertEqual(approvals[0]["action"]["proposal_id"], previews[1]["observation"]["result"]["proposal"]["id"])
        for session in previews[1]["action"]["arguments"]["plan"]["sessions"]:
            self.assertTrue(all(identity.startswith("barbell-") for identity in session["exercise_ids"]))

    def test_controls_expose_memory_and_recovery_failures(self):
        memory, _ = run_suite(self.scenarios, self.catalog, "no-memory")
        retry, _ = run_suite(self.scenarios, self.catalog, "no-retry")
        self.assertEqual({row["category"] for row in memory["results"] if not row["passed"]},
                         {"memory_supersession", "combined_recovery"})
        self.assertEqual({row["category"] for row in retry["results"] if not row["passed"]},
                         {"read_timeout", "write_timeout", "combined_recovery"})

    def test_replay_reexecutes_all_scenarios_with_identical_scores(self):
        _, traces = run_suite(self.scenarios, self.catalog)
        for scenario, trace in zip(self.scenarios, traces):
            with self.subTest(identity=scenario["id"]):
                replay = replay_trace(scenario, self.catalog, trace)
                self.assertTrue(replay["replay_valid"])
                self.assertEqual(replay["score"], trace["score"])

    def test_replay_rejects_tampering_with_observations_state_and_score(self):
        original = run_episode(self.scenario, self.catalog, FixedWorkflow())
        mutations = [
            lambda t: t["events"][0]["observation"].update(steps_remaining=999),
            lambda t: t["events"][0].update(state_digest="forged"),
            lambda t: t["events"][0]["action"].update(tool="get_memories"),
            lambda t: t["score"].update(writes=99),
            lambda t: t["score"].update(writes=True),
            lambda t: t.update(scenario_digest="forged"),
            lambda t: t.update(catalog_digest="forged"),
            lambda t: t["initial_observation"].update(intent="preview"),
            lambda t: t["events"].append(copy.deepcopy(t["events"][0])),
        ]
        for mutation in mutations:
            altered = copy.deepcopy(original)
            mutation(altered)
            with self.subTest(trace=altered), self.assertRaises(ValueError):
                replay_trace(self.scenario, self.catalog, altered)

    def test_replay_rejects_injected_or_deleted_external_approval(self):
        original = run_episode(self.scenario, self.catalog, FixedWorkflow())
        index = next(i for i, event in enumerate(original["events"]) if event["actor"] == "user")
        for insert in [True, False]:
            trace = copy.deepcopy(original)
            if insert:
                trace["events"].insert(index, copy.deepcopy(trace["events"][index]))
            else:
                trace["events"].pop(index)
            with self.assertRaises(ValueError):
                replay_trace(self.scenario, self.catalog, trace)

    def test_replay_consistency_does_not_turn_a_failed_episode_into_success(self):
        trace = run_episode(self.scenarios[7], self.catalog, FixedWorkflow(retry_timeouts=False))
        replay = replay_trace(self.scenarios[7], self.catalog, trace)
        self.assertTrue(replay["replay_valid"])
        self.assertFalse(replay["score"]["passed"])
        self.assertEqual(replay["score"]["writes"], 1)

    def test_fixture_validation_rejects_ambiguous_memory_and_inconsistent_labels(self):
        for field, value in [("expected_terminal", "infeasible"), ("max_steps", True),
                             ("as_of", "20260928"), ("clarification_answers", {"equipment": []}),
                             ("faults", [{"tool": "get_context", "call": 1, "when": "after_commit"}])]:
            scenario = copy.deepcopy(self.scenario)
            scenario[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_scenarios([scenario], self.catalog)
        scenario = copy.deepcopy(self.scenarios[4])
        scenario["memories"][1]["revision"] = 1
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            validate_scenarios([scenario], self.catalog)

    def test_group_overlap_is_rejected_across_interactive_splits(self):
        cases = copy.deepcopy(self.scenarios[:2])
        cases[1]["split"] = "test"
        cases[1]["family_id"] = cases[0]["family_id"]
        with self.assertRaises(ValueError):
            validate_scenarios(cases, self.catalog)


class InteractiveCliTests(unittest.TestCase):
    def cli(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "interact.py"), *map(str, args)],
                              capture_output=True, text=True, encoding="utf-8")

    def test_export_replay_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "traces.jsonl"
            output = Path(directory) / "report.json"
            run = self.cli("run", "--write-traces", path, "--output", output)
            self.assertEqual(run.returncode, 0, run.stderr)
            report = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(report["passed"], 14)
            replay = self.cli("replay", "--traces", path)
            self.assertEqual(replay.returncode, 0, replay.stderr)
            self.assertEqual(json.loads(replay.stdout)["task_passed"], 14)
            self.assertEqual(self.cli("run", "--output", path).returncode, 2)
            self.assertEqual(len(path.read_text(encoding="utf-8").splitlines()), 14)

    def test_missing_traces_stay_in_denominator(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.jsonl"
            path.write_text("", encoding="utf-8")
            replay = self.cli("replay", "--traces", path)
            self.assertEqual(replay.returncode, 1, replay.stderr)
            report = json.loads(replay.stdout)
            self.assertEqual((report["total"], report["replayed"], report["task_passed"]), (14, 0, 0))

    def test_failed_tasks_can_still_have_valid_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "failed.jsonl"
            run = self.cli("run", "--policy", "no-retry", "--write-traces", path)
            self.assertEqual(run.returncode, 1, run.stderr)
            replay = self.cli("replay", "--traces", path)
            self.assertEqual(replay.returncode, 0, replay.stderr)
            report = json.loads(replay.stdout)
            self.assertEqual((report["replayed"], report["task_passed"]), (14, 11))

    def test_duplicate_unknown_and_malformed_trace_inputs_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.jsonl"
            for content in ['{"scenario_id":"unknown"}\n', '{"scenario_id":"interactive-001"}\n' * 2,
                            '{"scenario_id":"interactive-001", "score":NaN}\n', '[]\n']:
                path.write_text(content, encoding="utf-8")
                result = self.cli("replay", "--traces", path)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("Traceback", result.stderr)

    def test_scenario_selection_is_explicit_and_known(self):
        result = self.cli("run", "--scenario", "interactive-008")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["total"], 1)
        self.assertEqual(self.cli("run", "--scenario", "missing").returncode, 2)


if __name__ == "__main__":
    unittest.main()
