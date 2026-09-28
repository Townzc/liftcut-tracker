from copy import deepcopy
from dataclasses import asdict, replace
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.environment import PlanEnvironment
from liftcut_agent.model_policy import ModelConfig, ModelPolicy, PolicyFailure, PROMPT, Reply, RunBudget, encode
from liftcut_agent.model_runner import replay_model_suite, run_model_suite
from liftcut_agent.model_transport import MockWorkflowTransport
from liftcut_agent.protocol import PENDING_INSTRUCTION, ProtocolConfig, ProtocolPolicy, load_config, parse_read_batch
from test_model_policy import ConstantTransport, response


def batch(*names):
    data = response()
    data["choices"][0]["message"]["tool_calls"] = [
        {"id": f"read-{i}", "type": "function", "function": {"name": name, "arguments": "{}"}}
        for i, name in enumerate(names)]
    return data


class InitialReadBatchTransport(MockWorkflowTransport):
    """Batch only the two initial reads; derive every answer from wire observations."""
    def complete(self, payload):
        if self.number == 1:
            context = json.loads(payload["messages"][-2]["content"])
            self.workflow.act({"tool_result": context, "user_events": []})
        reply = super().complete(payload)
        if self.number == 1:
            data = json.loads(reply.body)
            data["choices"][0]["message"]["tool_calls"].append(
                {"id": "initial-memory", "type": "function", "function": {"name": "get_memories", "arguments": "{}"}})
            return Reply(encode(data))
        return reply


class ProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.scenarios = read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")

    def policy(self, data, **changes):
        config = ProtocolConfig(tool_protocol="read_batch", **changes)
        transport = ConstantTransport(Reply(encode(data)))
        return ProtocolPolicy(config, transport, RunBudget(config))

    def test_legacy_config_and_manifest_are_unchanged(self):
        config = load_config(asdict(ModelConfig()))
        self.assertIs(type(config), ModelConfig)
        self.assertEqual(config.manifest()["adapter_version"], "model-policy-v0.1")
        for directory in ("deepseek-pilot", "deepseek-development"):
            path = ROOT / f"reports/{directory}-2026-09-28"
            conf = load_config(json.loads((path / "config.json").read_text(encoding="utf-8")))
            episodes = read_jsonl(path / "episodes.jsonl")
            ids = {episode["scenario_id"] for episode in episodes}
            result = replay_model_suite([s for s in self.scenarios if s["id"] in ids], self.catalog, conf, episodes)
            self.assertEqual(result["replayed"], len(ids))

    def test_four_configs_change_only_explicit_factors(self):
        for protocol in ("single", "read_batch"):
            for revision in ("original", "pending_approval_v1"):
                config = ProtocolConfig(tool_protocol=protocol, prompt_revision=revision)
                self.assertEqual(config, load_config(asdict(config)))
                self.assertEqual(config.prompt(), PROMPT + (PENDING_INSTRUCTION if revision != "original" else ""))
        for kwargs in ({"tool_protocol": "write_batch"}, {"prompt_revision": "future"}):
            with self.assertRaises(ValueError):
                ProtocolConfig(**kwargs)

    def test_new_strict_control_produces_identical_wire_requests(self):
        env = PlanEnvironment(self.scenarios[0], self.catalog)
        old = ModelPolicy(ModelConfig(), ConstantTransport(Reply(encode(response()))), RunBudget(ModelConfig()))
        new_config = ProtocolConfig()
        new = ProtocolPolicy(new_config, ConstantTransport(Reply(encode(response()))), RunBudget(new_config))
        old.act(env.initial_observation())
        new.act(env.initial_observation())
        self.assertEqual(old.calls[0]["request"], new.calls[0]["request"])

    def test_all_four_profiles_complete_offline_workflow_and_replay(self):
        for protocol in ("single", "read_batch"):
            for revision in ("original", "pending_approval_v1"):
                config = ProtocolConfig(tool_protocol=protocol, prompt_revision=revision)
                report, episodes = run_model_suite(self.scenarios, self.catalog, config, MockWorkflowTransport)
                self.assertEqual((report["passed"], report["requests"]), (14, 97))
                self.assertEqual(replay_model_suite(self.scenarios, self.catalog, config, episodes)["replayed"], 14)

    def test_batch_executes_two_steps_with_one_request_and_preserves_all_ids(self):
        config = ProtocolConfig(tool_protocol="read_batch")
        report, episodes = run_model_suite(self.scenarios[:2], self.catalog, config, InitialReadBatchTransport)
        self.assertEqual(report["passed"], 2)
        for episode in episodes:
            self.assertEqual(episode["trace"]["score"]["steps"], len(episode["calls"]) + 1)
            self.assertEqual(len(episode["calls"][0]["actions"]), 2)
            messages = episode["calls"][1]["request"]["messages"]
            self.assertEqual([m["role"] for m in messages[-3:]], ["assistant", "tool", "tool"])
            self.assertEqual([m["tool_call_id"] for m in messages[-2:]],
                             [c["id"] for c in messages[-3]["tool_calls"]])
        self.assertEqual(replay_model_suite(self.scenarios[:2], self.catalog, config, episodes)["task_passed"], 2)

    def test_mutating_clarification_unknown_and_terminal_tools_rejected_atomically(self):
        for tool in ("apply_plan", "propose_plan", "request_clarification", "finish", "unknown"):
            policy = self.policy(batch("get_context", tool))
            env = PlanEnvironment(self.scenarios[0], self.catalog)
            with self.subTest(tool=tool), self.assertRaisesRegex(PolicyFailure, "non_read_tool_in_batch"):
                policy.act(env.initial_observation())
            self.assertEqual(env.snapshot()["steps"], 0)
            self.assertFalse(policy.seen_ids)
            self.assertEqual(len(policy.calls), 1)
            self.assertIsNotNone(policy.calls[0]["usage"])

    def test_malformed_second_call_does_not_execute_first_or_consume_ids(self):
        data = batch("get_context", "get_memories")
        data["choices"][0]["message"]["tool_calls"][1]["function"]["arguments"] = '{"x":1,"x":2}'
        seen = set()
        with self.assertRaisesRegex(PolicyFailure, "invalid_tool_arguments_json"):
            parse_read_batch(data, seen, 24)
        self.assertFalse(seen)

    def test_extra_arguments_duplicate_ids_and_reused_ids_rejected(self):
        original = batch("get_context", "get_memories")
        data = deepcopy(original)
        data["choices"][0]["message"]["tool_calls"][1]["function"]["arguments"] = '{"approve":true}'
        with self.assertRaisesRegex(PolicyFailure, "invalid_read_batch_arguments"):
            parse_read_batch(data, set(), 24)
        data = deepcopy(original)
        data["choices"][0]["message"]["tool_calls"][1]["id"] = "read-0"
        for candidate, ids in ((data, set()), (original, {"read-1"})):
            with self.assertRaisesRegex(PolicyFailure, "invalid_or_reused_tool_call_id"):
                parse_read_batch(candidate, ids, 24)

    def test_size_and_step_limits_reject_whole_batch(self):
        with self.assertRaisesRegex(PolicyFailure, "read_batch_size_limit"):
            parse_read_batch(batch(*(["get_context"] * 5)), set(), 24)
        with self.assertRaisesRegex(PolicyFailure, "remaining_steps"):
            parse_read_batch(batch("get_context", "get_memories"), set(), 1)

    def test_valid_last_step_is_charged_and_truncates_without_extra_request(self):
        scenario = deepcopy(self.scenarios[0])
        scenario["max_steps"] = 2
        config = ProtocolConfig(tool_protocol="read_batch")
        report, episodes = run_model_suite([scenario], self.catalog, config,
            lambda: ConstantTransport(Reply(encode(batch("get_context", "get_memories")))))
        self.assertEqual((report["passed"], report["requests"], episodes[0]["trace"]["score"]["steps"]), (0, 1, 2))
        self.assertEqual(replay_model_suite([scenario], self.catalog, config, episodes)["replayed"], 1)

    def test_single_mutation_is_still_checked_by_environment(self):
        config = ProtocolConfig(tool_protocol="read_batch", max_requests=1)
        data = response("apply_plan", '{"proposal_id":"unapproved","idempotency_key":"x"}')
        report, episodes = run_model_suite(self.scenarios[:1], self.catalog, config,
                                          lambda: ConstantTransport(Reply(encode(data))))
        self.assertEqual(report["blocked_write_attempts"], 1)
        self.assertEqual(episodes[0]["trace"]["score"]["writes"], 0)

    def test_first_read_timeout_is_not_hidden_by_successful_second_read(self):
        scenario = deepcopy(self.scenarios[0])
        scenario["faults"] = [{"tool": "get_context", "call": 1, "when": "before"}]
        config = ProtocolConfig(tool_protocol="read_batch", max_requests=1)
        report, episodes = run_model_suite([scenario], self.catalog, config,
            lambda: ConstantTransport(Reply(encode(batch("get_context", "get_memories")))))
        self.assertEqual(report["tool_errors"], {"tool_timeout": 1})
        events = episodes[0]["trace"]["events"]
        self.assertFalse(events[0]["observation"]["ok"])
        self.assertTrue(events[1]["observation"]["ok"])
        self.assertEqual(report["passed"], 0)

    def test_user_events_follow_all_matching_tool_responses(self):
        policy = self.policy(batch("get_context", "get_memories"))
        env = PlanEnvironment(self.scenarios[0], self.catalog)
        first = policy.act(env.initial_observation())
        second = policy.act({"tool_result": env.step(first), "user_events": [{"event": {"type": "synthetic_update"}}]})
        with self.assertRaises(PolicyFailure):  # constant transport repeats IDs
            policy.act({"tool_result": env.step(second), "user_events": []})
        messages = policy.calls[-1]["request"]["messages"]
        self.assertEqual([m["role"] for m in messages[-4:]], ["assistant", "tool", "tool", "user"])

    def test_replay_rejects_dropped_batch_member_or_changed_second_response(self):
        config = ProtocolConfig(tool_protocol="read_batch")
        _, episodes = run_model_suite(self.scenarios[:1], self.catalog, config, InitialReadBatchTransport)
        changed = deepcopy(episodes)
        changed[0]["calls"][0]["actions"].pop()
        with self.assertRaises(ValueError):
            replay_model_suite(self.scenarios[:1], self.catalog, config, changed)
        changed = deepcopy(episodes)
        changed[0]["calls"][1]["request"]["messages"][-1]["tool_call_id"] = "wrong"
        with self.assertRaises(ValueError):
            replay_model_suite(self.scenarios[:1], self.catalog, config, changed)


if __name__ == "__main__":
    unittest.main()
