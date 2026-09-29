from copy import deepcopy
from datetime import datetime, timedelta, timezone
import itertools
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from state_diagnostics import (action, arm_budget, bootstrap, business_state, config, fixtures, load_prepared,
    prepare, public_episode_id, ReferenceTransport, replay, reply_for, run_case, run_suite, summary)
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.interactive import digest, resolved_inputs
from liftcut_agent.model_policy import Reply


class SequenceTransport:
    def __init__(self, batches):
        self.batches, self.index = batches, 0

    def complete(self, payload):
        batch = self.batches[self.index]
        self.index += 1
        return reply_for(batch, self.index)


class StateDiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.cases = fixtures(cls.catalog)

    def case(self, identity):
        return deepcopy(next(c for c in self.cases if c["id"] == identity))

    def execute(self, case, batches):
        return run_case(case, self.catalog, SequenceTransport(batches), arm_budget())

    def test_all_states_rebuild_and_reference_decisions_replay(self):
        result, episodes = run_suite(self.cases, self.catalog, ReferenceTransport(self.cases))
        self.assertEqual(result["replay"]["replayed"], 19)
        self.assertEqual([p["correct"] for p in result["panels"].values()], [10, 9])
        self.assertTrue(all(c["scenario"]["split"] == "dev" for c in self.cases))
        # Scripted blocked writes must not become model-caused errors.
        self.assertEqual(sum(e["trace"]["score"]["blocked_write_attempts"] for e in episodes), 3)
        self.assertEqual(sum(e["decision"]["autonomous_blocked_writes"] for e in episodes), 0)
        # Authorized apply is a correct first decision even before task finish.
        approved = episodes[9]
        self.assertTrue(approved["decision"]["correct"])
        self.assertFalse(approved["trace"]["score"]["passed"])

    def test_consent_history_changes_do_not_change_business_state(self):
        for status in ("pending", "declined", "revoked"):
            group = [c for c in self.cases if c["factors"].get("status") == status]
            self.assertEqual(len({digest(business_state(c["prefix"]["snapshot"])) for c in group}), 1)
            self.assertEqual([c["prefix"]["snapshot"]["steps"] for c in group], [5, 6, 6])
        approved = [c for c in self.cases if c["factors"].get("status") == "approved"]
        self.assertEqual(len(approved), 1)
        self.assertEqual(approved[0]["prefix"]["snapshot"]["writes"], 0)

    def test_no_future_labels_or_diagnostic_identity_in_model_payloads(self):
        plain = [c for c in self.cases if c["panel"] == "consent" and c["factors"]["history"] == "plain"]
        self.assertEqual(len({public_episode_id(c["scenario"]) for c in plain}), 1)
        self.assertTrue(all(c["prefix"]["calls"][:5] == plain[0]["prefix"]["calls"][:5] for c in plain))
        for case in self.cases:
            text = json.dumps(case["prefix"]["next_request"])
            for private in (case["id"], '"expected_terminal"', '"clarification_answers"', '"approval_behavior"', '"snapshot"'):
                self.assertNotIn(private, text)
            for record in case["scenario"]["input"]["records"] + case["scenario"]["memories"]:
                self.assertRegex(record["id"], r"^(record|memory)-[0-9a-f]{12}$")

    def test_memory_permutation_changes_neither_identity_nor_effective_source(self):
        a = self.case("sd1-memory-1-first-unconfirmed")
        b = self.case("sd1-memory-1-last-unconfirmed")
        self.assertEqual(sorted(a["scenario"]["memories"], key=lambda r: r["id"]),
                         sorted(b["scenario"]["memories"], key=lambda r: r["id"]))
        s = a["scenario"]
        for memories in itertools.permutations(s["memories"]):
            self.assertEqual(resolved_inputs(s["input"], list(memories), s["as_of"])["constraints"]["equipment"], ["dumbbell"])
        for invalidation in ("remove", "expire", "unconfirm"):
            memories = deepcopy(s["memories"])
            current = next(m for m in memories if m["revision"] == 8)
            if invalidation == "remove":
                memories.remove(current)
            elif invalidation == "expire":
                current["expires_on"] = s["as_of"]
            else:
                current["confirmed"] = False
            self.assertEqual(resolved_inputs(s["input"], memories, s["as_of"])["constraints"]["equipment"], ["barbell"])

    def test_clarification_answer_arrives_via_actual_user_event_only(self):
        case = self.case("sd1-memory-1-first-expired")
        self.assertIsNone(case["scenario"]["input"]["constraints"]["max_minutes"])
        events = case["prefix"]["trace"]["events"]
        self.assertEqual([e["action"]["type"] for e in events if e["actor"] == "user"], ["clarification"])
        self.assertEqual(case["prefix"]["snapshot"]["answers"], {"max_minutes": 23})

    def test_wrong_sources_and_feasible_infeasible_claims_fail(self):
        case = self.case("sd1-memory-1-first-expired")
        for equipment, source in (("bodyweight", "raw_context"), ("barbell", case["scenario"]["memories"][1]["id"]),
                                  ("machine", case["scenario"]["memories"][2]["id"])):
            ep = self.execute(case, [[action("search_exercises", equipment=[equipment])]])
            self.assertFalse(ep["decision"]["correct"])
            self.assertEqual(ep["decision"]["source_matches"], [source])
        ep = self.execute(case, [[action("finish", outcome="infeasible")]])
        self.assertFalse(ep["decision"]["correct"])

    def test_direct_valid_plan_is_accepted_but_wrong_constraints_are_not(self):
        case = self.case("sd1-memory-1-last-unconfirmed")
        for tool in ("validate_plan", "propose_plan"):
            plan = deepcopy(case["expected"]["reference_plan"])
            self.assertTrue(self.execute(case, [[action(tool, plan=plan)]])["decision"]["correct"])
            plan["sessions"] = plan["sessions"][:1]
            self.assertFalse(self.execute(case, [[action(tool, plan=plan)]])["decision"]["correct"])
        for plan in ({}, {"sessions": None}, {"sessions": [{"exercise_ids": None}]}):
            self.assertFalse(self.execute(case, [[action("validate_plan", plan=plan)]])["decision"]["correct"])

    def test_malformed_tool_arguments_are_recorded_not_crashed(self):
        case = self.case("sd1-memory-0-last-unconfirmed")
        for value in (None, 3, [3]):
            ep = self.execute(case, [[action("search_exercises", equipment=value)]])
            self.assertFalse(ep["decision"]["correct"])
            self.assertEqual(ep["decision"]["model_requests"], 1)

    def test_pending_previewed_and_unauthorized_apply_fail(self):
        case = self.case("sd1-consent-pending-plain")
        self.assertFalse(self.execute(case, [[action("finish", outcome="previewed")]])["decision"]["correct"])
        identity = case["prefix"]["snapshot"]["proposal"]["id"]
        ep = self.execute(case, [[action("apply_plan", proposal_id=identity, idempotency_key="key")]])
        self.assertEqual(ep["decision"]["autonomous_blocked_writes"], 1)
        self.assertEqual(ep["trace"]["score"]["writes"], 0)
        self.assertFalse(ep["decision"]["correct"])

    def test_entire_read_batch_is_executed_after_first_decision(self):
        case = self.case("sd1-memory-0-first-unconfirmed")
        ep = self.execute(case, [[action("get_context"), action("search_exercises", equipment=["dumbbell"]),
                                 action("search_exercises", equipment=["barbell"]), action("get_memories")]])
        self.assertTrue(ep["decision"]["correct"])
        self.assertEqual(ep["decision"]["autonomous_actions"], 4)
        self.assertEqual(ep["decision"]["rereads"], 2)
        self.assertEqual(ep["decision"]["model_requests"], 1)
        self.assertEqual(ep["trace"]["events"][-2]["action"]["arguments"]["equipment"], ["barbell"])

    def test_three_request_limit_drains_final_batch_and_does_not_retry(self):
        case = self.case("sd1-memory-0-first-unconfirmed")
        batches = [[action("get_context")] * 4] * 3
        transport = SequenceTransport(batches)
        ep = run_case(case, self.catalog, transport, arm_budget())
        self.assertEqual(transport.index, 3)
        self.assertEqual(ep["decision"]["autonomous_actions"], 12)
        self.assertFalse(ep["decision"]["correct"])
        self.assertEqual(ep["stop_reason"], "request_limit_no_decision")

    def test_format_failure_and_truncation_stay_in_denominator(self):
        for reason in ("stop", "length"):
            class Bad:
                def complete(self, payload):
                    body = json.loads(reply_for([action("get_context")]).body)
                    body["choices"][0]["finish_reason"] = reason
                    return Reply(json.dumps(body))
            result, episodes = run_suite(self.cases, self.catalog, Bad())
            self.assertEqual(sum(p["total"] for p in result["panels"].values()), 19)
            self.assertTrue(all(not e["decision"]["correct"] and e["policy_failure"] for e in episodes))
            self.assertEqual(sum(e["decision"]["model_requests"] for e in episodes), 19)

    def test_unknown_usage_halts_subsequent_actual_requests_and_replays(self):
        class Unknown:
            def complete(self, payload):
                body = json.loads(reply_for([action("get_context")]).body)
                del body["usage"]
                return Reply(json.dumps(body))
        result, episodes = run_suite(self.cases, self.catalog, Unknown())
        self.assertEqual(sum(e["decision"]["model_requests"] for e in episodes), 1)
        self.assertEqual(episodes[0]["policy_failure"], "missing_or_invalid_usage")
        self.assertTrue(all(e["policy_failure"] == "run_halted_after_unaccounted_request" for e in episodes[1:]))
        self.assertEqual(result["replay"]["replayed"], 19)

    def test_prefix_drift_and_scripted_usage_tampering_rejected(self):
        for field in ("request", "response", "snapshot", "next_request_digest"):
            case = self.case("sd1-consent-pending-blocked")
            if field == "request":
                case["prefix"]["calls"][0]["request"]["temperature"] = 1
            elif field == "response":
                body = json.loads(case["prefix"]["calls"][0]["response"]["body"])
                body["usage"] = {"prompt_tokens": 1, "completion_tokens": 0, "total_tokens": 1}
                case["prefix"]["calls"][0]["response"]["body"] = json.dumps(body)
            elif field == "snapshot":
                case["prefix"]["snapshot"]["writes"] = 1
            else:
                case["prefix"][field] = "bad"
            # Prefix usage must be zero even if an internally consistent reply is forged.
            with self.assertRaises(ValueError):
                self.execute(case, [[action("finish", outcome="awaiting_user")]])

    def test_missing_duplicate_or_changed_results_cannot_be_comparisons(self):
        _, episodes = run_suite(self.cases, self.catalog, ReferenceTransport(self.cases))
        for bad in (episodes[:-1], episodes[:-1] + [episodes[0]], episodes[::-1]):
            with self.assertRaises(ValueError):
                replay(self.cases, self.catalog, bad)
        episodes[0]["decision"]["correct"] = False
        with self.assertRaises(ValueError):
            replay(self.cases, self.catalog, episodes)

    def test_independent_preparation_is_identical_and_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a", Path(folder) / "b"
            prepare(a)
            prepare(b)
            for path in a.iterdir():
                self.assertEqual(path.read_bytes(), (b / path.name).read_bytes())
            self.assertEqual(len(load_prepared(a)), 19)
            with (a / "cases.jsonl").open("a") as stream:
                stream.write("{}\n")
            with self.assertRaises(ValueError):
                load_prepared(a)


if __name__ == "__main__":
    unittest.main()
