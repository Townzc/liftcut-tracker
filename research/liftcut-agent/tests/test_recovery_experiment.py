from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import shutil
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))
from audit_recovery import audit_rollout
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.environment import PlanEnvironment, ScriptedUser
from liftcut_agent.workflow import FixedWorkflow
from prepare_recovery import schedules
from recovery_dataset import DATA, check_splits, decisions, fixtures, load_frozen, prepare, write_rows
from run_recovery_window import archive_run, deadline_from_boot, execute_phases, phase_commands, wait_guard_armed


class RecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.temporary = tempfile.TemporaryDirectory()
        cls.prepared = Path(cls.temporary.name) / "demonstrations"
        cls.preparation = prepare(cls.prepared)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_split_freeze_and_all_labels_realizable(self):
        self.assertEqual(len(load_frozen()), 48)
        self.assertEqual(self.preparation["contract_passed"], 48)
        self.assertEqual(self.preparation["paired_decisions"], 150)

    def test_relabeling_groups_does_not_hide_duplicate_task(self):
        original = fixtures()[0]
        duplicate = deepcopy(original)
        duplicate.update(id="new", family_id="new", persona_id="new", split="test")
        duplicate["input"]["records"][0]["id"] = "new-source"
        with self.assertRaisesRegex(ValueError, "semantic task"):
            check_splits([original, duplicate], self.catalog)

    def test_family_cannot_cross_splits(self):
        rows = fixtures()
        rows[-1]["family_id"] = rows[0]["family_id"]
        with self.assertRaisesRegex(ValueError, "cross-split"):
            check_splits(rows, self.catalog)

    def test_changed_frozen_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "data"
            shutil.copytree(DATA, target)
            with (target / "test.jsonl").open("a", encoding="utf-8") as stream:
                stream.write("\n")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                load_frozen(target)

    def test_test_targets_cannot_be_exported(self):
        with self.assertRaisesRegex(ValueError, "only training"):
            decisions([row for row in fixtures() if row["split"] == "test"], [], "clean")

    def test_rejected_actions_are_history_not_targets(self):
        manifest = json.loads((self.prepared / "recovery/manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["rejected_targets"]), 24)
        rows = read_jsonl(self.prepared / "recovery/decisions.jsonl")
        for row in rows:
            functions = row["messages"][-1]["tool_calls"]
            if row["category"] in {"pending", "revoked", "declined"}:
                self.assertTrue(all(c["function"]["name"] != "apply_plan" for c in functions))
            for call in functions:
                if call["function"]["name"] == "request_clarification":
                    self.assertEqual(call["function"]["arguments"], {"fields": ["max_minutes"]})
        # Verify actual rejected calls remain visible before positive continuations.
        self.assertTrue(any('approval_required' in json.dumps(row["messages"][:-1]) for row in rows))

    def test_mixed_missing_and_known_clarification_is_atomic_rejection(self):
        case = next(s for s in fixtures() if s["category"] == "partial_clarification")
        env = PlanEnvironment(case, self.catalog)
        response = env.step({"tool": "request_clarification", "arguments": {"fields": ["max_minutes", "min_exercises"]}})
        self.assertEqual(response["error"]["code"], "unnecessary_clarification")
        self.assertEqual(env.snapshot()["pending_fields"], [])
        good = env.step({"tool": "request_clarification", "arguments": {"fields": ["max_minutes"]}})
        self.assertTrue(good["ok"])
        self.assertEqual(env.snapshot()["pending_fields"], ["max_minutes"])

    def test_revocation_blocks_write_and_pending_is_distinct(self):
        for category, outcome in (("revoked", "declined"), ("pending", "awaiting_user")):
            case = next(s for s in fixtures() if s["category"] == category)
            env, workflow, user = PlanEnvironment(case, self.catalog), FixedWorkflow(), ScriptedUser(case)
            observation = env.initial_observation()
            while True:
                action = workflow.act(observation)
                if action["tool"] == "finish":
                    self.assertEqual(action["arguments"]["outcome"], outcome)
                    proposal = env.snapshot()["proposal"]["id"]
                    blocked = env.step({"tool": "apply_plan", "arguments": {"proposal_id": proposal, "idempotency_key": "attempt"}})
                    self.assertEqual(blocked["error"]["code"], "approval_required")
                    self.assertEqual(env.snapshot()["writes"], 0)
                    break
                response = env.step(action)
                observation = {"tool_result": response, "user_events": user.advance(env)}

    def make_schedule_data(self, directory, *, corrupt=False, leak=False):
        cases = [s for s in fixtures() if s["split"] == "train"]
        for variant in ("clean", "recovery"):
            decisions_data, tokens = [], []
            for i, case in enumerate(cases):
                decisions_data.append({"scenario_id": case["id"], "split": "test" if leak else "train", "pair_id": case["id"] + ":0"})
                ids = [1] * (3 if variant == "clean" else 5) + [20 + i, 2]
                if corrupt and variant == "recovery" and i == 0:
                    ids[-1] = 3
                prompt = len(ids) - 2
                tokens.append({"input_ids": ids, "labels": [-100] * prompt + ids[prompt:],
                               "prompt_tokens": prompt, "target_tokens": 2, "attention_mask": [1] * len(ids)})
            write_rows(directory / "decisions" / variant / "decisions.jsonl", decisions_data)
            write_rows(directory / "tokens" / variant / "tokens.jsonl", tokens)

    def test_schedule_equal_targets_steps_and_half_recovery_exposure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_schedule_data(root)
            schedule, tokens, _ = schedules(root)
            self.assertEqual(len(schedule["clean"]), len(schedule["mixed"]))
            for clean, mixed in zip(schedule["clean"], schedule["mixed"]):
                self.assertEqual(clean["index"], mixed["index"])
                a, b = tokens[clean["variant"]][clean["index"]], tokens[mixed["variant"]][mixed["index"]]
                self.assertEqual(a["labels"][a["prompt_tokens"]:], b["labels"][b["prompt_tokens"]:])
            self.assertEqual(sum(r["variant"] == "recovery" for r in schedule["mixed"]), 24)

    def test_schedule_rejects_target_mutation_and_heldout_rows(self):
        for options in ({"corrupt": True}, {"leak": True}):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.make_schedule_data(root, **options)
                with self.assertRaises(ValueError):
                    schedules(root)

    def test_deadline_counts_setup_time_and_rejects_late_start(self):
        now = datetime(2026, 9, 28, 12, tzinfo=timezone.utc)
        self.assertEqual(deadline_from_boot("2026-09-28T11:30:00+00:00", now).hour, 13)
        for boot in ("2026-09-28T10:00:00+00:00", "2026-09-28T12:01:00+00:00", "2026-09-28T11:30:00"):
            with self.assertRaises(ValueError):
                deadline_from_boot(boot, now)

    def test_phase_plan_never_evaluates_training_file(self):
        phases = phase_commands(Path("weights"), Path("manifest"), Path("prepared"), Path("runs"))
        self.assertEqual(len(phases), 6)
        self.assertEqual(sum(name.startswith("train-") for name, _ in phases), 2)
        for name, argv in phases:
            if name.startswith("evaluate-"):
                self.assertNotIn(str(DATA / "train.jsonl"), argv)
                self.assertIn(str(DATA / "test.jsonl"), argv)

    def test_archive_refuses_overwrite_and_hashes_selected_run(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "run"
            output.mkdir()
            (output / "log.txt").write_text("synthetic log", encoding="utf-8")
            result = archive_run(output)
            self.assertEqual(len(result["sha256"]), 64)
            with self.assertRaises(FileExistsError):
                archive_run(output)

    def test_failed_training_prevents_later_training_and_evaluation(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("run_recovery_window.subprocess.run", side_effect=subprocess.CalledProcessError(1, "train")) as run:
                with self.assertRaises(subprocess.CalledProcessError):
                    execute_phases([("train-clean", ["train"]), ("evaluate", ["evaluate"])],
                                   datetime.now(timezone.utc) + timedelta(hours=1), Path(directory))
                self.assertEqual(run.call_count, 1)
                self.assertTrue(run.call_args.kwargs["check"])
                self.assertGreater(run.call_args.kwargs["timeout"], 0)

    def test_soft_deadline_launches_no_new_process(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("run_recovery_window.subprocess.run") as run:
                with self.assertRaises(TimeoutError):
                    execute_phases([("train", ["train"])], datetime.now(timezone.utc), Path(directory))
                run.assert_not_called()

    def test_guard_wait_handles_file_before_record_flush(self):
        guard, receipt = Mock(), Mock()
        guard.poll.return_value = None
        receipt.exists.return_value = True
        receipt.read_text.side_effect = ["", '{"status":"armed"}\n']
        with patch("run_recovery_window.time.sleep"):
            wait_guard_armed(guard, receipt)
        self.assertEqual(receipt.read_text.call_count, 2)

    def test_generic_gpu_audit_replays_existing_v2_records(self):
        scenarios = read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")
        directory = ROOT / "reports/qwen-gpu-pilot-2026-09-28/native/adapter"
        episodes, report, _ = audit_rollout(directory, scenarios, self.catalog)
        self.assertEqual(len(episodes), 14)
        self.assertEqual(report["passed"], 10)

    def test_generic_gpu_audit_rejects_tampered_scores(self):
        scenarios = read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "run"
            shutil.copytree(ROOT / "reports/qwen-gpu-pilot-2026-09-28/native/adapter", target)
            report = json.loads((target / "report.json").read_text(encoding="utf-8"))
            report["passed"] = 14
            (target / "report.json").write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "saved metrics"):
                audit_rollout(target, scenarios, self.catalog)


if __name__ == "__main__":
    unittest.main()
