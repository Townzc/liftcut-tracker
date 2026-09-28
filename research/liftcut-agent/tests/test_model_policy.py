from contextlib import contextmanager
from copy import deepcopy
from dataclasses import asdict, replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl, rule_baseline
from liftcut_agent.environment import PlanEnvironment
from liftcut_agent.model_policy import ModelConfig, ModelPolicy, PolicyFailure, Reply, RunBudget, encode, parse_action
from liftcut_agent.model_runner import replay_model_suite, run_model_suite
from liftcut_agent.model_transport import HttpTransport, MockWorkflowTransport, endpoint_url


def response(tool="get_context", arguments="{}", identity="call-1", **changes):
    result = {"model": "test-model", "choices": [{"finish_reason": "tool_calls", "message": {
        "role": "assistant", "content": None, "tool_calls": [{"id": identity, "type": "function",
        "function": {"name": tool, "arguments": arguments}}]}}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}}
    result.update(changes)
    return result


class ConstantTransport:
    def __init__(self, reply):
        self.reply, self.requests = reply, []

    def complete(self, payload):
        self.requests.append(deepcopy(payload))
        return deepcopy(self.reply)


@contextmanager
def server(handler):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}/v1"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join()


class QuietHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass


class ModelPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.scenarios = read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")

    def setUp(self):
        self.config = ModelConfig()
        self.observation = PlanEnvironment(self.scenarios[0], self.catalog).initial_observation()

    def policy(self, data=None, *, reply=None, config=None):
        config = config or self.config
        transport = ConstantTransport(reply or Reply(encode(data or response())))
        return ModelPolicy(config, transport, RunBudget(config))

    def test_full_protocol_smoke_and_replay_all_fourteen_cases(self):
        report, episodes = run_model_suite(self.scenarios, self.catalog, self.config, MockWorkflowTransport)
        self.assertEqual((report["passed"], report["requests"]), (14, 97))
        self.assertIn("synthetic", report["scope"])
        self.assertEqual(report["tool_errors"], {"tool_timeout": 3})
        replay = replay_model_suite(self.scenarios, self.catalog, self.config, episodes)
        self.assertEqual((replay["replayed"], replay["task_passed"]), (14, 14))

    def test_one_function_call_is_parsed_without_repair_or_extra_authority(self):
        policy = self.policy(response("apply_plan", '{"proposal_id":"p1","idempotency_key":"x","approved":true}'))
        action = policy.act(self.observation)
        env = PlanEnvironment(self.scenarios[0], self.catalog)
        self.assertEqual(env.step(action)["error"]["code"], "invalid_arguments")
        self.assertTrue(policy.calls[0]["action"]["arguments"]["approved"])
        request = policy.calls[0]["request"]
        self.assertFalse(request["parallel_tool_calls"])
        self.assertEqual(request["max_completion_tokens"], 1024)
        self.assertNotIn("Authorization", encode(request))

    def test_payload_contains_only_observations_and_tool_schemas(self):
        report, episodes = run_model_suite([self.scenarios[12]], self.catalog, self.config, MockWorkflowTransport)
        self.assertEqual(report["passed"], 1)
        wire = encode([call["request"] for call in episodes[0]["calls"]])
        for key in ["expected_terminal", "approval_behavior", "after_preview_update", "clarification_answers",
                    "scenario_id", "family_id", "persona_id", "faults", "state_digest"]:
            self.assertNotIn(f'"{key}"', wire)

    def test_tool_responses_precede_external_user_events_and_match_call_ids(self):
        _, episodes = run_model_suite([self.scenarios[1]], self.catalog, self.config, MockWorkflowTransport)
        messages = episodes[0]["calls"][-1]["request"]["messages"]
        seen_approval = False
        for index, message in enumerate(messages):
            if message["role"] == "tool":
                previous = messages[index - 1]
                self.assertEqual(previous["role"], "assistant")
                self.assertEqual(message["tool_call_id"], previous["tool_calls"][0]["id"])
            if message["role"] == "user" and "user_events" in json.loads(message["content"]):
                self.assertEqual(messages[index - 1]["role"], "tool")
                seen_approval = True
        self.assertTrue(seen_approval)

    def test_malformed_arguments_are_not_extracted_normalized_or_retried(self):
        for arguments in ['```json\n{}\n```', '{"x":1,"x":2}', '{"x":NaN}', '{"x":1e999}',
                          '{"x":"\\ud800"}', '[]', 'null']:
            policy = self.policy(response(arguments=arguments))
            with self.subTest(arguments=arguments), self.assertRaises(PolicyFailure):
                policy.act(self.observation)
            self.assertEqual(len(policy.calls), 1)
            self.assertIsNone(policy.calls[0]["action"])
            self.assertEqual(json.loads(policy.calls[0]["response"]["body"])["choices"][0]["message"]
                             ["tool_calls"][0]["function"]["arguments"], arguments)

    def test_refusal_text_only_multiple_calls_and_truncation_never_execute(self):
        mutations = [
            lambda d: d["choices"][0].update(finish_reason="length"),
            lambda d: d["choices"][0].update(finish_reason="content_filter"),
            lambda d: d["choices"][0]["message"].update(refusal="No"),
            lambda d: d["choices"][0]["message"].update(tool_calls=[]),
            lambda d: d["choices"][0]["message"]["tool_calls"].append(deepcopy(d["choices"][0]["message"]["tool_calls"][0])),
        ]
        for mutation in mutations:
            data = response()
            mutation(data)
            policy = self.policy(data)
            with self.assertRaises(PolicyFailure):
                policy.act(self.observation)
            self.assertIsNone(policy.calls[0]["action"])
            self.assertIsNotNone(policy.calls[0]["usage"])

    def test_reused_call_ids_are_rejected(self):
        with self.assertRaisesRegex(PolicyFailure, "reused"):
            parse_action(response(), {"call-1"})

    def test_reasoning_content_is_preserved_in_history(self):
        data = response()
        data["choices"][0]["message"]["reasoning_content"] = "Synthetic reasoning field."
        policy = self.policy(data)
        policy.act(self.observation)
        self.assertEqual(policy.messages[-1]["reasoning_content"], "Synthetic reasoning field.")

    def test_nullable_reasoning_field_and_provider_options_are_supported(self):
        data = response()
        data["choices"][0]["message"]["reasoning_content"] = None
        config = replace(self.config, thinking_mode="disabled", temperature=0, send_parallel_tool_calls=False)
        policy = self.policy(data, config=config)
        policy.act(self.observation)
        request = policy.calls[0]["request"]
        self.assertEqual(request["thinking"], {"type": "disabled"})
        self.assertEqual(request["temperature"], 0)
        self.assertNotIn("parallel_tool_calls", request)
        self.assertNotIn("reasoning_content", policy.messages[-1])

    def test_legacy_output_token_field_is_explicit_and_exclusive(self):
        policy = self.policy(config=replace(self.config, token_limit_field="max_tokens"))
        policy.act(self.observation)
        payload = policy.calls[0]["request"]
        self.assertEqual(payload["max_tokens"], 1024)
        self.assertNotIn("max_completion_tokens", payload)

    def test_global_request_budget_includes_remaining_unattempted_scenarios(self):
        config = replace(self.config, max_requests=1)
        report, episodes = run_model_suite(self.scenarios, self.catalog, config, MockWorkflowTransport)
        self.assertEqual((report["total"], report["passed"], report["requests"]), (14, 0, 1))
        self.assertEqual(report["policy_failures"], {"request_budget_exhausted": 14})
        self.assertEqual(episodes[0]["trace"]["score"]["steps"], 1)
        self.assertEqual(episodes[1]["trace"]["score"]["steps"], 0)
        self.assertEqual(replay_model_suite(self.scenarios, self.catalog, config, episodes)["replayed"], 14)

    def test_request_output_and_cost_limits_stop_before_transport(self):
        configs = [(replace(self.config, max_request_bytes=1), "request_size_limit"),
                   (replace(self.config, max_reserved_output_tokens=1), "output_budget_exhausted"),
                   (replace(self.config, input_usd_per_million="1", max_reserved_usd="0"), "cost_reservation_exhausted")]
        for config, error in configs:
            policy = self.policy(config=config)
            with self.assertRaisesRegex(PolicyFailure, error):
                policy.act(self.observation)
            self.assertEqual(policy.transport.requests, [])
            self.assertEqual(policy.calls, [])

    def test_reservations_are_not_refunded_by_low_reported_usage(self):
        config = replace(self.config, max_reserved_output_tokens=1024)
        budget = RunBudget(config)
        budget.reserve({"model": "test"})
        with self.assertRaisesRegex(PolicyFailure, "output_budget"):
            budget.reserve({"model": "test"})

    def test_missing_usage_is_unknown_cost_and_halts_future_requests(self):
        transport = ConstantTransport(Reply(encode(response(usage=None))))
        report, episodes = run_model_suite(self.scenarios, self.catalog, self.config, lambda: transport)
        self.assertEqual(report["requests"], 1)
        self.assertEqual(report["unknown_usage_requests"], 1)
        self.assertIsNone(report["estimated_cost_usd"])
        self.assertFalse(report["usage_complete"])
        self.assertEqual(report["policy_failures"]["run_halted_after_unaccounted_request"], 13)
        self.assertEqual(replay_model_suite(self.scenarios, self.catalog, self.config, episodes)["task_passed"], 0)

    def test_invalid_usage_and_provider_overrun_are_detected(self):
        for usage in [{"prompt_tokens": True, "completion_tokens": 20, "total_tokens": 21},
                      {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 999},
                      {"prompt_tokens": 100, "completion_tokens": 1025, "total_tokens": 1125}]:
            policy = self.policy(response(usage=usage))
            with self.assertRaises(PolicyFailure):
                policy.act(self.observation)
            self.assertTrue(policy.budget.halted)

    def test_estimated_cost_uses_configured_rates_and_preserves_failed_parse_usage(self):
        config = replace(self.config, input_usd_per_million="1.25", output_usd_per_million="5", max_reserved_usd="1")
        policy = self.policy(response(arguments="invalid"), config=config)
        with self.assertRaises(PolicyFailure):
            policy.act(self.observation)
        self.assertEqual(policy.calls[0]["estimated_cost_usd"], "0.000225")

    def test_http_error_timeout_and_invalid_json_are_saved_without_retry(self):
        for reply, code in [(Reply('{"error":"bad"}', 429), "http_error"),
                            (Reply(None, None, "transport_timeout"), "transport_timeout"),
                            (Reply("not-json"), "invalid_response_json")]:
            policy = self.policy(reply=reply)
            with self.assertRaisesRegex(PolicyFailure, code):
                policy.act(self.observation)
            self.assertEqual(len(policy.transport.requests), 1)
            self.assertEqual(policy.calls[0]["response"]["body"], reply.body)
            self.assertTrue(policy.budget.halted)

    def test_bad_model_arguments_reach_environment_and_remain_in_trace(self):
        transport = ConstantTransport(Reply(encode(response("apply_plan", '{"proposal_id":"unknown","idempotency_key":"x"}'))))
        report, episodes = run_model_suite([self.scenarios[13]], self.catalog, self.config, lambda: transport)
        self.assertEqual(report["blocked_write_attempts"], 1)
        self.assertEqual(episodes[0]["trace"]["events"][0]["observation"]["error"]["code"], "stale_proposal")
        self.assertEqual(report["passed"], 0)

    def test_callbacks_preserve_partial_evidence_when_model_fails(self):
        calls, episodes = [], []
        transport = ConstantTransport(Reply("malformed"))
        report, _ = run_model_suite(self.scenarios[:1], self.catalog, self.config, lambda: transport,
            on_call=lambda identity, call: calls.append((identity, call)), on_episode=episodes.append)
        self.assertEqual(report["passed"], 0)
        self.assertEqual(calls[0][1]["response"]["body"], "malformed")
        self.assertEqual(episodes[0]["policy_failure"], "invalid_response_json")

    def test_replay_rejects_tampered_wire_history_action_accounting_and_user_approval(self):
        scenarios = [self.scenarios[1]]
        _, original = run_model_suite(scenarios, self.catalog, self.config, MockWorkflowTransport)
        mutations = [
            lambda e: e[0]["calls"][0]["request"].update(model="other"),
            lambda e: e[0]["calls"][0].update(action={"tool": "finish", "arguments": {"outcome": "applied"}}),
            lambda e: e[0]["calls"][0]["usage"].update(prompt_tokens=1),
            lambda e: e[0]["calls"][0]["response"].update(body=encode(response("finish", '{"outcome":"applied"}'))),
            lambda e: e[0]["calls"][0]["reservation"].update(reserved_usd="99"),
            lambda e: e[0]["trace"]["events"].pop(next(i for i, row in enumerate(e[0]["trace"]["events"]) if row["actor"] == "user")),
        ]
        for mutation in mutations:
            episodes = deepcopy(original)
            mutation(episodes)
            with self.assertRaises(ValueError):
                replay_model_suite(scenarios, self.catalog, self.config, episodes)

    def test_replay_rejects_changed_config_order_and_unknown_ids(self):
        scenarios = self.scenarios[:2]
        _, episodes = run_model_suite(scenarios, self.catalog, self.config, MockWorkflowTransport)
        with self.assertRaises(ValueError):
            replay_model_suite(scenarios, self.catalog, replace(self.config, max_requests=100), episodes)
        with self.assertRaises(ValueError):
            replay_model_suite(scenarios, self.catalog, self.config, list(reversed(episodes)))
        with self.assertRaises(ValueError):
            replay_model_suite(scenarios, self.catalog, self.config, [episodes[0], episodes[0]])
        report = replay_model_suite(scenarios, self.catalog, self.config, episodes[:1])
        self.assertEqual((report["total"], report["replayed"], report["missing"]), (2, 0, 1))

    def test_invalid_configuration_fails_before_evaluation(self):
        for changes in [{"max_requests": True}, {"max_requests": 0}, {"max_output_tokens": -1},
                        {"max_reserved_usd": "NaN"}, {"max_reserved_usd": "-1"}, {"max_reserved_usd": "1e1000"},
                        {"input_usd_per_million": 1.0}, {"token_limit_field": "invented"}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                replace(self.config, **changes)


class HttpTransportTests(unittest.TestCase):
    def test_endpoints_reject_cleartext_remote_urls_and_embedded_credentials(self):
        for endpoint in ["http://example.com/v1", "https://user:secret@example.com/v1", "https://example.com/v1?key=x",
                         "file:///tmp", "https://example.com/#fragment", "https://bad host/v1"]:
            with self.assertRaises(ValueError):
                endpoint_url(endpoint)
        self.assertEqual(endpoint_url("http://127.0.0.1:8000/v1/"), "http://127.0.0.1:8000/v1/chat/completions")

    def test_real_loopback_http_posts_native_payload_and_redacts_echoed_key(self):
        captured = []

        class Handler(QuietHandler):
            def do_POST(self):
                captured.append((self.path, self.headers["Authorization"], json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"echo":"local-test-secret"}')

        with server(Handler) as endpoint:
            transport = HttpTransport(endpoint, "local-test-secret", ModelConfig())
            reply = transport.complete({"model": "test", "messages": []})
        self.assertEqual(captured[0][0], "/v1/chat/completions")
        self.assertEqual(captured[0][1], "Bearer local-test-secret")
        self.assertEqual(captured[0][2]["model"], "test")
        self.assertNotIn("local-test-secret", reply.body)
        self.assertIn("[REDACTED]", reply.body)
        self.assertGreaterEqual(reply.elapsed_seconds, 0)

    def test_redirects_are_not_followed(self):
        paths = []

        class Handler(QuietHandler):
            def do_POST(self):
                paths.append(self.path)
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(307)
                self.send_header("Location", "/credential-collector")
                self.end_headers()

        with server(Handler) as endpoint:
            reply = HttpTransport(endpoint, "test-key", ModelConfig()).complete({})
        self.assertEqual(reply.status, 307)
        self.assertEqual(paths, ["/v1/chat/completions"])

    def test_oversized_responses_are_bounded(self):
        class Handler(QuietHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"x" * 100)

        with server(Handler) as endpoint:
            reply = HttpTransport(endpoint, "test-key", ModelConfig(max_response_bytes=10)).complete({})
        self.assertEqual(reply.error, "response_size_limit")
        self.assertEqual(len(reply.body), 10)

    def test_timeout_is_reported_without_exception_text_or_retry(self):
        transport = HttpTransport("http://127.0.0.1:8000/v1", "test-key", ModelConfig())
        with patch.object(transport._opener, "open", side_effect=TimeoutError("contains test-key")) as opened:
            reply = transport.complete({})
        self.assertEqual(reply.error, "transport_timeout")
        self.assertIsNone(reply.body)
        self.assertEqual(opened.call_count, 1)


class ModelCliTests(unittest.TestCase):
    def cli(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "model.py"), *map(str, args)],
                              capture_output=True, text=True, encoding="utf-8")

    def test_mock_outputs_and_replay_roundtrip_without_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "run"
            result = self.cli("mock", "--output-dir", output)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(read_jsonl(output / "calls.jsonl")), 97)
            replay = self.cli("replay", "--config", output / "config.json", "--episodes", output / "episodes.jsonl")
            self.assertEqual(replay.returncode, 0, replay.stderr)
            self.assertEqual(json.loads(replay.stdout)["task_passed"], 14)
            self.assertEqual(self.cli("mock", "--output-dir", output).returncode, 2)

    def test_live_requires_explicit_permission_and_reviewed_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "run"
            config = ROOT / "configs/model-live.example.json"
            result = self.cli("live", "--output-dir", output, "--config", config,
                              "--base-url", "https://example.invalid/v1")
            self.assertEqual(result.returncode, 2)
            result = self.cli("live", "--output-dir", output, "--config", config,
                              "--base-url", "https://example.invalid/v1", "--allow-live")
            self.assertEqual(result.returncode, 2)
            self.assertFalse(output.exists())

    def test_preflight_does_not_require_credentials_or_contact_endpoint(self):
        result = self.cli("preflight", "--config", ROOT / "configs/model-live.example.json",
                          "--base-url", "https://example.invalid/v1", "--scenario", "interactive-008")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["network_requests"], 0)
        self.assertEqual(json.loads(result.stdout)["maximum_requests_before_cost_guard"], 24)

    def test_budget_failures_exit_one_and_still_write_all_scenarios(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / "config.json"
            config.write_text(encode(asdict(ModelConfig(max_requests=1))), encoding="utf-8")
            output = Path(temporary) / "run"
            result = self.cli("mock", "--config", config, "--output-dir", output)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(len(read_jsonl(output / "episodes.jsonl")), 14)
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertEqual((report["passed"], report["total"]), (0, 14))


if __name__ == "__main__":
    unittest.main()
