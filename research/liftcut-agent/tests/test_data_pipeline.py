from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl, sha256
from liftcut_agent.comparison import ARMS, FACTORS, compare_runs, paired
from liftcut_agent.protocol import ProtocolConfig
from liftcut_agent.model_policy import Reply, encode
from liftcut_agent.model_transport import MockWorkflowTransport
from liftcut_agent.trajectories import export_decisions, normalize_messages, target_tokens
import test_run_audit as audit_test
from test_protocol import InitialReadBatchTransport


class DataPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scenarios = read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.hashes = {"cases_sha256": sha256(ROOT / "benchmark/interactive-dev.jsonl"),
                      "catalog_sha256": sha256(ROOT / "benchmark/catalog.json")}
        cls.real_run = ROOT / "reports/deepseek-development-2026-09-28"
        cls.summary, cls.rows = export_decisions(cls.real_run, cls.scenarios, cls.catalog, **cls.hashes)

    def test_only_successful_episodes_become_positive_decisions(self):
        self.assertEqual((self.summary["selected_episodes"], len(self.summary["included_scenario_ids"]), len(self.rows)), (14, 8, 59))
        excluded = {row["scenario_id"] for row in self.summary["excluded"]}
        self.assertEqual(len(excluded), 6)
        self.assertFalse(excluded.intersection(row["scenario_id"] for row in self.rows))
        self.assertIn("interactive-014", excluded)  # Valid plans alone do not establish success.
        self.assertFalse(self.summary["tokenizer_masks_verified"])
        published = ROOT / "reports/development-decisions-2026-09-28"
        self.assertEqual(self.rows, read_jsonl(published / "decisions.jsonl"))
        manifest = json.loads((published / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest, {**self.summary, "decisions_sha256": sha256(published / "decisions.jsonl")})

    def test_lineage_recovery_and_final_target_are_retained(self):
        self.assertEqual(self.summary["recovery_episode_ids"], ["interactive-007", "interactive-008"])
        for row in self.rows:
            self.assertEqual(row["split"], "dev")
            self.assertTrue(row["family_id"] and row["persona_id"] and row["source_response_sha256"])
            self.assertEqual(row["assistant_target_index"], len(row["messages"]) - 1)
            self.assertEqual(row["messages"][-1]["role"], "assistant")
            self.assertTrue(all(isinstance(call["function"]["arguments"], dict)
                                for m in row["messages"] for call in m.get("tool_calls", [])))

    def test_normalization_never_mutates_source_or_discards_call_ids(self):
        source = [{"role": "assistant", "tool_calls": [{"id": "id1", "function": {"name": "tool", "arguments": '{"x":1}'}}]}]
        original = deepcopy(source)
        result = normalize_messages(source)
        self.assertEqual(source, original)
        self.assertEqual(result[0]["tool_calls"][0]["id"], "id1")
        self.assertEqual(result[0]["tool_calls"][0]["function"]["arguments"], {"x": 1})

    def test_held_out_scenarios_cannot_be_exported_as_smoke_targets(self):
        scenarios = deepcopy(self.scenarios)
        scenarios[0]["split"] = "test"
        with patch("liftcut_agent.trajectories.audit_run", return_value={"scenario_ids": [scenarios[0]["id"]]}):
            with self.assertRaisesRegex(ValueError, "development data only"):
                export_decisions(self.real_run, scenarios, self.catalog, **self.hashes)

    def test_tampered_run_is_rejected_before_any_positive_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "run"
            shutil.copytree(self.real_run, target)
            report = json.loads((target / "report.json").read_text(encoding="utf-8"))
            report["passed"] = 14
            (target / "report.json").write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaises(ValueError):
                export_decisions(target, self.scenarios, self.catalog, **self.hashes)

    def test_export_cli_does_not_overwrite_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data"
            args = [sys.executable, str(ROOT / "export_trajectories.py"), "--run-dir", str(self.real_run), "--output-dir", str(path)]
            first = subprocess.run(args, capture_output=True, encoding="utf-8")
            self.assertEqual(first.returncode, 0, first.stderr)
            digest = sha256(path / "decisions.jsonl")
            self.assertEqual(subprocess.run(args, capture_output=True).returncode, 2)
            self.assertEqual(sha256(path / "decisions.jsonl"), digest)

    def test_batched_target_keeps_both_decisions_and_matching_history(self):
        fixture = audit_test.RunAuditTests()
        fixture.setUpClass()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        directory = Path(fixture.temp.name) / "batched"
        fixture.make_run(directory, config=ProtocolConfig(tool_protocol="read_batch"), factory=InitialReadBatchTransport)
        summary, rows = export_decisions(directory, self.scenarios, self.catalog, **self.hashes)
        self.assertEqual(len(rows[0]["messages"][-1]["tool_calls"]), 2)
        self.assertEqual([m["role"] for m in rows[1]["messages"][-4:]], ["assistant", "tool", "tool", "assistant"])
        self.assertEqual(summary["source_mode"], "mock")

    def test_only_final_assistant_tokens_receive_labels(self):
        class Tokenizer:
            def apply_chat_template(self, messages, *, tools, tokenize, add_generation_prompt):
                return [11, 12, 13] if add_generation_prompt else [11, 12, 13, 21, 22, 99]
        encoded = target_tokens(self.rows[-1], Tokenizer())
        self.assertEqual(encoded["labels"], [-100, -100, -100, 21, 22, 99])
        self.assertEqual(encoded["attention_mask"], [1] * 6)
        self.assertEqual((encoded["prompt_tokens"], encoded["target_tokens"]), (3, 3))

    def test_invalid_decision_stays_in_recovery_context_but_is_not_a_positive_target(self):
        class RepairTransport(MockWorkflowTransport):
            saved = None
            injected = False

            def complete(self, payload):
                if self.saved is not None:
                    data, self.saved = self.saved, None
                    self.number += 1
                    data["choices"][0]["message"]["tool_calls"][0]["id"] = f"repair-{self.number}"
                    return Reply(encode(data))
                reply = super().complete(payload)
                data = json.loads(reply.body)
                function = data["choices"][0]["message"]["tool_calls"][0]["function"]
                if function["name"] == "validate_plan" and not self.injected:
                    self.saved, self.injected = deepcopy(data), True
                    arguments = json.loads(function["arguments"])
                    arguments["plan"]["sessions"][0]["exercise_ids"] = ["not-in-catalog"]
                    function["arguments"] = encode(arguments)
                    return Reply(encode(data))
                return reply
        fixture = audit_test.RunAuditTests()
        fixture.setUpClass()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        directory = Path(fixture.temp.name) / "repair"
        fixture.make_run(directory, factory=RepairTransport)
        summary, rows = export_decisions(directory, self.scenarios, self.catalog, **self.hashes)
        self.assertEqual(summary["included_scenario_ids"], ["interactive-001"])
        self.assertEqual(len(summary["excluded_decisions"]), 1)
        self.assertTrue(any("not-in-catalog" in encode(row["messages"][:-1]) for row in rows))
        self.assertTrue(all("not-in-catalog" not in encode(row["messages"][-1]) for row in rows))

    def test_prefix_instability_empty_target_and_truncation_fail_closed(self):
        for suffix, limit, error in (([8, 9], 8192, "prefix-stable"), ([1, 2], 8192, "empty"),
                                     ([1, 2, 3, 4], 3, "truncation")):
            class Tokenizer:
                def apply_chat_template(self, messages, **kwargs):
                    return [1, 2] if kwargs["add_generation_prompt"] else suffix
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                target_tokens(self.rows[0], Tokenizer(), max_length=limit)

    def test_tool_message_cannot_be_selected_as_supervised_target(self):
        row = deepcopy(self.rows[0])
        row["messages"][-1]["role"] = "tool"
        with self.assertRaisesRegex(ValueError, "invalid final assistant"):
            target_tokens(row, None)


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.fixture = audit_test.RunAuditTests()
        self.fixture.setUpClass()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = Path(self.fixture.temp.name) / "matrix"
        self.root.mkdir()
        for arm in ARMS:
            protocol, prompt = FACTORS[arm]
            self.fixture.make_run(self.root / arm, config=ProtocolConfig(tool_protocol=protocol, prompt_revision=prompt))

    def compare(self):
        return compare_runs(self.root, self.fixture.scenarios, self.fixture.catalog, **self.fixture.hashes)

    def test_complete_matrix_is_audited_and_mock_cost_is_excluded(self):
        report = self.compare()
        self.assertEqual(len(report["arms"]), 4)
        self.assertEqual(report["spending"]["live_requests"], 0)
        self.assertEqual(len(report["paired_comparisons"]), 4)
        self.assertTrue(all(arm["replayed"] == 1 for arm in report["arms"].values()))

    def test_changed_nonfactor_config_or_mislabelled_arm_is_rejected(self):
        path = self.root / ARMS[1] / "config.json"
        original = self.fixture.read(path)
        for changes in ({"max_requests": 335}, {"tool_protocol": "single"}):
            self.fixture.write(path, {**original, **changes})
            with self.assertRaises(ValueError):
                self.compare()

    def test_missing_arm_is_never_filled_from_previous_results(self):
        (self.root / ARMS[-1] / "config.json").unlink()
        with self.assertRaises(OSError):
            self.compare()

    def test_paired_changes_use_all_matched_scenarios(self):
        left = {"scenario_ids": ["a", "b", "c", "d"], "passed": 2,
                "scenarios": [{"scenario_id": s, "passed": p} for s, p in zip("abcd", [True, True, False, False])]}
        right = deepcopy(left)
        for row, value in zip(right["scenarios"], [True, False, True, False]):
            row["passed"] = value
        result = paired(left, right)
        self.assertEqual([result[k] for k in ("both_passed", "left_only", "right_only", "both_failed")], [1, 1, 1, 1])
        self.assertEqual(len(result["changed"]), 2)
        right["scenario_ids"].reverse()
        with self.assertRaisesRegex(ValueError, "unmatched"):
            paired(left, right)

    def test_preflight_has_no_network_or_credential_requirement(self):
        result = subprocess.run([sys.executable, str(ROOT / "protocol_experiment.py"), "preflight"],
                                capture_output=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual((report["network_requests"], report["aggregate_reservation_guard_usd"]), (0, "2.40"))

    def test_live_matrix_needs_explicit_flags_and_sufficient_aggregate_guard(self):
        command = [sys.executable, str(ROOT / "protocol_experiment.py"), "live", "--output-dir", str(self.root / "paid")]
        for flags in ([], ["--allow-live", "--base-url", "https://example.invalid", "--max-reserved-usd", "0.10"]):
            result = subprocess.run(command + flags, capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertFalse((self.root / "paid").exists())


if __name__ == "__main__":
    unittest.main()
