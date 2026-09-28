from copy import deepcopy
from dataclasses import asdict, replace
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_json, read_jsonl, sha256
from liftcut_agent.model_policy import ModelConfig, Reply, encode
from liftcut_agent.model_runner import run_model_suite
from liftcut_agent.model_transport import MockWorkflowTransport
from liftcut_agent.run_audit import audit_run, build_ledger, episode_metrics


class RunAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.scenarios = read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")
        cls.hashes = {"cases_sha256": sha256(ROOT / "benchmark/interactive-dev.jsonl"),
                      "catalog_sha256": sha256(ROOT / "benchmark/catalog.json")}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / "run"
        self.make_run(self.directory)

    @staticmethod
    def write(path, value):
        path.write_text(encode(value) + "\n", encoding="utf-8", newline="\n")

    @staticmethod
    def read(path):
        return read_json(path.read_text(encoding="utf-8"))

    def make_run(self, directory, *, mode="mock", config=None, factory=MockWorkflowTransport, selected=None):
        directory.mkdir()
        config = config or ModelConfig()
        selected = selected or self.scenarios[:1]
        report, episodes = run_model_suite(selected, self.catalog, config, factory, mode=mode)
        metadata = {"started_at": "2026-09-28T00:00:00+00:00", "code": {"commit": "test-fixture", "dirty": True},
                    "mode": mode, "endpoint": None, "config": asdict(config),
                    "scenario_ids": [s["id"] for s in selected], **self.hashes}
        self.write(directory / "config.json", asdict(config))
        self.write(directory / "manifest.json", metadata)
        for name, rows in (("episodes", episodes), ("calls", [
                {"scenario_id": episode["scenario_id"], **call} for episode in episodes for call in episode["calls"]])):
            (directory / f"{name}.jsonl").write_text("".join(encode(row) + "\n" for row in rows),
                                                   encoding="utf-8", newline="\n")
        report.update(metadata)
        report.update({f"{name}_sha256": sha256(directory / f"{name}.jsonl") for name in ("calls", "episodes")})
        self.write(directory / "report.json", report)

    def audit(self, directory=None):
        return audit_run(directory or self.directory, self.scenarios, self.catalog, **self.hashes)

    def change_report(self, **changes):
        path = self.directory / "report.json"
        self.write(path, {**self.read(path), **changes})

    def test_mock_is_replayed_but_excluded_from_real_spending(self):
        audit = self.audit()
        self.assertEqual((audit["replayed"], audit["passed"], audit["first_candidate_valid"]), (1, 1, 1))
        ledger = build_ledger([audit])
        self.assertEqual((ledger["mock_runs"], ledger["live_requests"], ledger["live_estimated_cost_usd"]), (1, 0, "0"))
        self.assertNotIn("passed", ledger)  # Do not pool accuracy across overlapping suites.

    def test_saved_pilot_replays_and_reports_identical_idempotent_retry(self):
        audit = self.audit(ROOT / "reports/deepseek-pilot-2026-09-28")
        self.assertEqual((audit["passed"], audit["requests"], audit["estimated_cost_usd"]), (1, 8, "0.0052893"))
        self.assertEqual(audit["scenarios"][0]["immediate_identical_timeout_retries"], 1)
        self.assertEqual(audit["scenarios"][0]["writes"], 1)

    def test_saved_full_baseline_retains_protocol_and_terminal_failures(self):
        audit = self.audit(ROOT / "reports/deepseek-development-2026-09-28")
        self.assertEqual((audit["replayed"], audit["passed"], audit["requests"]), (14, 8, 70))
        self.assertEqual(audit["policy_failures"], {"expected_single_tool_call": 5})
        for row in audit["scenarios"]:
            if row["policy_failure"]:
                self.assertEqual(row["failed_response_tools"], ["get_context", "get_memories"])
                self.assertIsNone(row["first_candidate_valid"])
        self.assertEqual(audit["scenarios"][-1]["issues"], ["terminal_outcome_mismatch"])
        self.assertEqual(audit["scenarios"][-1]["writes"], 0)

    def test_report_counts_cost_and_latency_cannot_override_replay(self):
        original = self.read(self.directory / "report.json")
        for key, value in (("passed", 99), ("known_usage_cost_usd", "123"), ("request_latency_p95_seconds", 12)):
            with self.subTest(key=key):
                self.write(self.directory / "report.json", {**original, key: value})
                with self.assertRaisesRegex(ValueError, "summary mismatch"):
                    self.audit()

    def test_manifest_report_metadata_must_match(self):
        self.change_report(code={"commit": "different", "dirty": False})
        with self.assertRaisesRegex(ValueError, "metadata mismatch"):
            self.audit()

    def test_input_file_hashes_are_bound(self):
        with self.assertRaisesRegex(ValueError, "input file hashes"):
            audit_run(self.directory, self.scenarios, self.catalog, **{**self.hashes, "cases_sha256": "wrong"})

    def test_config_changes_are_rejected(self):
        path = self.directory / "config.json"
        config = self.read(path)
        config["max_requests"] -= 1
        self.write(path, config)
        with self.assertRaisesRegex(ValueError, "configuration mismatch"):
            self.audit()

    def test_artifact_hash_is_checked_before_trusting_log(self):
        path = self.directory / "calls.jsonl"
        path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "artifact hash mismatch"):
            self.audit()

    def test_separate_call_log_must_equal_replayed_episodes_even_with_updated_hash(self):
        path = self.directory / "calls.jsonl"
        rows = read_jsonl(path)
        rows[0]["estimated_cost_usd"] = "9"
        path.write_text("".join(encode(row) + "\n" for row in rows), encoding="utf-8")
        self.change_report(calls_sha256=sha256(path))
        with self.assertRaisesRegex(ValueError, "call log and episode"):
            self.audit()

    def test_forged_episode_action_fails_replay_even_with_updated_hash(self):
        path = self.directory / "episodes.jsonl"
        episodes = read_jsonl(path)
        episodes[0]["calls"][0]["action"]["tool"] = "apply_plan"
        self.write(path, episodes[0])
        self.change_report(episodes_sha256=sha256(path))
        with self.assertRaisesRegex(ValueError, "artifact action"):
            self.audit()

    def test_missing_episode_is_not_a_completed_zero_cost_run(self):
        path = self.directory / "episodes.jsonl"
        path.write_text("", encoding="utf-8")
        self.change_report(episodes_sha256=sha256(path))
        with self.assertRaisesRegex(ValueError, "incomplete run"):
            self.audit()

    def test_invalid_scenario_selection_is_rejected(self):
        path = self.directory / "manifest.json"
        original = self.read(path)
        for ids in ([], ["unknown"], ["interactive-001", "interactive-001"]):
            with self.subTest(ids=ids):
                self.write(path, {**original, "scenario_ids": ids})
                self.change_report(scenario_ids=ids)
                with self.assertRaisesRegex(ValueError, "scenario"):
                    self.audit()

    def test_unknown_usage_remains_unknown_in_ledger(self):
        class UnavailableTransport:
            def complete(self, payload):
                return Reply(None, error="transport_timeout")
        directory = Path(self.temp.name) / "unknown"
        config = replace(ModelConfig(), input_usd_per_million="0.30", output_usd_per_million="1.20", max_reserved_usd="0.75")
        self.make_run(directory, config=config, factory=UnavailableTransport, mode="live")
        audit = self.audit(directory)
        ledger = build_ledger([audit])
        self.assertFalse(ledger["live_usage_complete"])
        self.assertIsNone(ledger["live_estimated_cost_usd"])
        self.assertEqual(ledger["live_known_usage_cost_usd"], "0")
        self.assertEqual(audit["passed"], 0)

    def test_copied_run_cannot_be_double_counted(self):
        copied = Path(self.temp.name) / "copy"
        shutil.copytree(self.directory, copied)
        with self.assertRaisesRegex(ValueError, "duplicate run"):
            build_ledger([self.audit(), self.audit(copied)])

    def test_duplicate_episode_identity_is_rejected_across_different_runs(self):
        first = self.audit()
        second = deepcopy(first)
        second.update(run_id="different", episodes_sha256="different")
        with self.assertRaisesRegex(ValueError, "overlapping episode"):
            build_ledger([first, second])

    def test_pilot_and_full_costs_add_without_pooling_accuracy(self):
        runs = [self.audit(ROOT / f"reports/{name}-2026-09-28") for name in ("deepseek-pilot", "deepseek-development")]
        ledger = build_ledger(runs)
        self.assertEqual((ledger["live_runs"], ledger["live_requests"], ledger["live_estimated_cost_usd"]), (2, 78, "0.0486840"))
        self.assertEqual([row["passed"] for row in ledger["runs"]], [1, 8])
        self.assertNotIn("total", ledger)
        self.assertEqual(ledger, self.read(ROOT / "reports/development-baseline-audit-2026-09-28.json"))

    def test_candidate_repair_and_unobserved_candidate_have_distinct_denominators(self):
        _, episodes = run_model_suite(self.scenarios[:1], self.catalog, ModelConfig(), MockWorkflowTransport)
        episode = episodes[0]
        validation = next(event for event in episode["trace"]["events"] if event.get("action", {}).get("tool") == "validate_plan")
        rejected = deepcopy(validation)
        rejected["observation"]["result"] = {"valid": False, "issues": ["time_budget"]}
        episode["trace"]["events"].insert(0, rejected)
        metrics = episode_metrics(self.scenarios[0], episode)
        self.assertFalse(metrics["first_candidate_valid"])
        self.assertTrue(metrics["recovered_after_candidate_rejection"])
        self.assertEqual(metrics["candidate_rejections"][0]["issues"], ["time_budget"])
        # Metrics never normalize away a rejection; replay separately validates real artifacts.
        episode["trace"]["events"] = []
        self.assertIsNone(episode_metrics(self.scenarios[0], episode)["first_candidate_valid"])

    def test_cli_writes_once_and_rejects_reusing_output(self):
        output = Path(self.temp.name) / "ledger.json"
        command = [sys.executable, str(ROOT / "audit.py"), "--run-dir", str(self.directory), "--output", str(output)]
        first = subprocess.run(command, capture_output=True, encoding="utf-8")
        self.assertEqual(first.returncode, 0, first.stderr)
        original = output.read_bytes()
        second = subprocess.run(command, capture_output=True, encoding="utf-8")
        self.assertEqual(second.returncode, 2)
        self.assertEqual(output.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
