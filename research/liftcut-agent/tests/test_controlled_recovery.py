from copy import deepcopy
import itertools
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from controlled_recovery import DATA, RecoveryTransport, config, fixtures, prepare, public_episode_id
from controlled_rollout import PrefixTransport, evaluation_cases, run_controlled, summarize_controlled
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest, resolved_inputs
from liftcut_agent.model_policy import Reply, RunBudget
from liftcut_agent.model_runner import run_model_episode
from liftcut_agent.model_transport import MockWorkflowTransport
from recovery_dataset import load_frozen
from run_controlled_window import deadline, phases, evidence_backup
from restore_recovery import restore
from audit_controlled import audit_generations
from liftcut_agent.qwen_transport import parse_tool_message


class ControlledTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.prepared = Path(cls.tmp.name)
        prepare(cls.prepared / "decisions")
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.cases = load_frozen(DATA)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_no_hidden_outcome_in_visible_ids_or_episode_identity(self):
        for row in self.cases:
            for record in row["input"]["records"] + row["memories"]:
                self.assertRegex(record["id"], r"^(record|memory)-[0-9a-f]{12}$")
        for group in {s["family_id"] for s in self.cases}:
            cases = [s for s in self.cases if s["family_id"] == group and s["category"] in {"approved", "pending", "declined", "revoked"}]
            self.assertEqual(len(cases), 4)
            self.assertEqual(len({public_episode_id(s) for s in cases}), 1)
            self.assertEqual(len({digest(s["input"]) for s in cases}), 1)

    def test_counterfactual_requests_and_proposal_replies_match_before_user_event(self):
        selected = [s for s in self.cases if s["family_id"] == "r2-bundle-05"
                    and s["category"] in {"approved", "pending", "declined", "revoked"}]
        traces = [run_model_episode(s, self.catalog, config(), MockWorkflowTransport(), RunBudget(config()),
                                   episode_id=public_episode_id(s)) for s in selected]
        # get_context, get_memories, search, validate, propose: the entire wire prefix agrees.
        self.assertTrue(all(e["calls"][:5] == traces[0]["calls"][:5] for e in traces))

    def test_memory_permutations_and_adversarial_ids_preserve_effective_constraints(self):
        for row in [s for s in self.cases if s["category"] == "memory"]:
            expected = resolved_inputs(row["input"], row["memories"], row["as_of"])["constraints"]
            for permutation in itertools.permutations(row["memories"]):
                mem = deepcopy(list(permutation))
                for i, m in enumerate(mem):
                    m["id"] = ["looks-current", "looks-old", "looks-approved"][i]
                self.assertEqual(resolved_inputs(row["input"], mem, row["as_of"])["constraints"], expected)
            bad = deepcopy(row["memories"])
            # Removing the real latest usable preference exposes a different constraint.
            latest = max((m for m in bad if m["confirmed"] and not m["expires_on"]), key=lambda m: m["revision"])
            latest["confirmed"] = False
            self.assertNotEqual(resolved_inputs(row["input"], bad, row["as_of"])["constraints"], expected)

    def test_training_export_excludes_test_and_invalid_targets(self):
        for variant in ("clean", "recovery"):
            rows = read_jsonl(self.prepared / "decisions" / variant / "decisions.jsonl")
            self.assertEqual(len(rows), 324)
            self.assertEqual({r["split"] for r in rows}, {"train"})
            self.assertTrue(all("r2-" not in json.dumps(r["messages"]) for r in rows))
            questions = [r for r in rows if r["messages"][-1]["tool_calls"][0]["function"]["name"] == "request_clarification"]
            self.assertEqual(len(questions), 20)
            self.assertEqual({tuple(r["messages"][-1]["tool_calls"][0]["function"]["arguments"]["fields"]) for r in questions},
                             {("max_minutes",), ("equipment",), ("available_days",)})
        rejected = json.loads((self.prepared / "decisions/recovery/manifest.json").read_text())["rejected_targets"]
        self.assertEqual(len(rejected), 48)
        self.assertEqual(sum(r["action"]["tool"] == "validate_plan" for r in rejected), 20)

    def test_prefix_is_zero_usage_and_refuses_changed_request_or_post_prefix_state(self):
        prefix = read_jsonl(self.prepared / "decisions/prefixes.jsonl")[0]
        class Never:
            def complete(self, payload):
                raise AssertionError("unexpected model call")
        transport = PrefixTransport(prefix, Never())
        with self.assertRaisesRegex(ValueError, "prefix request"):
            transport.complete({"tampered": True})
        transport = PrefixTransport(prefix, Never())
        for call in prefix["calls"]:
            reply = transport.complete(call["request"])
            self.assertEqual(json.loads(reply.body)["usage"]["total_tokens"], 0)
        with self.assertRaisesRegex(ValueError, "first live request"):
            transport.complete({"tampered": True})

    def workflow_suite(self):
        replies = {}
        for scenario in [s for s in self.cases if s["split"] == "dev"]:
            for transport in (MockWorkflowTransport(), RecoveryTransport(scenario["category"])):
                ep = run_model_episode(scenario, self.catalog, config(), transport, RunBudget(config()),
                                       episode_id=public_episode_id(scenario))
                for call in ep["calls"]:
                    # Prefer clean actions on shared normal histories. A frozen
                    # prefix, not this simulated model, is responsible for injection.
                    replies.setdefault(digest(call["request"]), call["response"])
        class WorkflowLookup:
            def complete(self, payload):
                return Reply(**replies[digest(payload)])
        return run_controlled(self.prepared, self.catalog, WorkflowLookup())

    def test_all_controlled_states_replay_without_attributing_prefix_errors_to_model(self):
        report, episodes = self.workflow_suite()
        self.assertEqual(report["replay"]["replayed"], 21)
        self.assertEqual(report["panels"]["normal"]["passed"], 12)
        continuation = report["panels"]["continuation"]
        self.assertEqual(continuation["passed"], 9)
        self.assertEqual(continuation["first_recovery_acceptable"], 9)
        self.assertEqual(continuation["autonomous_blocked_writes"], 0)
        self.assertEqual(continuation["invalid_validations"], 0)
        self.assertEqual(sum(e["trace"]["score"]["blocked_write_attempts"] for e in episodes), 3)
        self.assertTrue(all(r["autonomous_clean_completion"] for r in report["results"]))

    def test_missing_or_changed_prefix_artifacts_cannot_be_reported_as_complete(self):
        _, episodes = self.workflow_suite()
        scenarios, prefixes = evaluation_cases(self.prepared)
        with self.assertRaisesRegex(ValueError, "missing"):
            summarize_controlled(scenarios, prefixes, episodes[:-1])
        episodes[12]["calls"][0]["response"]["elapsed_seconds"] = 1.0
        with self.assertRaisesRegex(ValueError, "synthetic prefix"):
            summarize_controlled(scenarios, prefixes, episodes)

    def test_window_accounts_for_time_already_spent_and_rejects_late_launch(self):
        now = datetime(2026, 9, 29, 3, tzinfo=timezone.utc)
        boot = now - timedelta(hours=1)
        self.assertEqual(deadline(boot.isoformat(), now), boot + timedelta(hours=4))
        for bad in (now + timedelta(minutes=1), now - timedelta(hours=3)):
            with self.assertRaises(ValueError):
                deadline(bad.isoformat(), now)
        with self.assertRaises(ValueError):
            deadline("2026-09-29T02:00:00", now)

    def test_phases_use_v2_training_and_no_test_rollout(self):
        commands = phases(Path("model"), Path("manifest"), Path("prepared"), Path("output"))
        self.assertEqual(len(commands), 6)
        for name, argv in commands:
            self.assertFalse(any("test.jsonl" in v for v in argv))
            if name.startswith("train-"):
                self.assertEqual(argv[argv.index("--study") + 1], "v2")
            if name.startswith("evaluate-"):
                self.assertTrue(any(v.endswith("gpu_controlled.py") for v in argv))

    def test_evidence_archive_is_restorable_and_does_not_duplicate_training_weights(self):
        with tempfile.TemporaryDirectory() as folder:
            run = Path(folder) / "run"
            (run / "training/clean/final").mkdir(parents=True)
            (run / "training/clean/final/adapter_model.safetensors").write_bytes(b"fake-test-weight")
            (run / "evaluation").mkdir()
            (run / "evaluation/trace.json").write_text("{}")
            (run / "window-status.json").write_text('{"status":"complete"}')
            archive = evidence_backup(run)
            receipt = restore(run / archive["archive"], Path(folder) / "restored", archive["sha256"])
            self.assertEqual(receipt["verified_files"], 2)
            self.assertFalse((Path(receipt["run_directory"]) / "training").exists())

    def test_native_generation_audit_rejects_missing_or_changed_model_text(self):
        raw = '<tool_call>{"name":"get_context","arguments":{}}</tool_call><|im_end|>'
        body = {"choices": [{"message": parse_tool_message(raw, 1), "finish_reason": "tool_calls"}],
                "usage": {"prompt_tokens": 30, "completion_tokens": 2}}
        call = {"response": {"body": json.dumps(body), "elapsed_seconds": .1}}
        generation = {"request_number": 1, "elapsed_seconds": .1, "raw_text": raw,
                      "eos_reached": True, "prompt_tokens": 30, "output_ids": [1, 2]}
        audit_generations([call], [generation])
        with self.assertRaisesRegex(ValueError, "cover model calls"):
            audit_generations([call], [])
        generation["raw_text"] = raw.replace("get_context", "get_memories")
        with self.assertRaisesRegex(ValueError, "native text"):
            audit_generations([call], [generation])


if __name__ == "__main__":
    unittest.main()
