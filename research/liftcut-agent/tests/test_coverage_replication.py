"""R1 operational tests use explicitly synthetic native replies and fake weights."""
import ast
from collections import Counter
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import random
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import audit_coverage_replication as auditor
import prepare_coverage_replication as preparation
import restore_coverage_replication as restorer
import run_coverage_replication_window as window
from prepare_coverage_replication import VERSION, REVIEWED, ARMS, order_for, require_seed, run_binding, arm_binding, read
from review_coverage_replication import summarize
from coverage_rollout import run_normal
from state_coverage import config
from state_diagnostics import prepare, fixtures, run_suite
from gpu_state_diagnostics import PARSER, PRECISION
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import encode
from recovery_dataset import write_rows
from run_recovery_window import archive_run
from run_controlled_window import evidence_backup
from server_workspace import dump_new, sha256
from test_state_coverage_operations import NativeWorkflow, NativeReference


class ReplicationScheduleTests(unittest.TestCase):
    def test_seed42_reproduces_old_sampler_and_new_seeds_change_both_epochs(self):
        expected, rng = [], random.Random(42)
        for _ in range(2):
            epoch = list(range(504))
            rng.shuffle(epoch)
            expected.extend(epoch)
        self.assertEqual(order_for(42, 504), expected)
        for seed in (43, 44):
            order = order_for(seed, 504)
            self.assertEqual(order, order_for(seed, 504))
            self.assertEqual(Counter(order), Counter({i: 2 for i in range(504)}))
            self.assertNotEqual(order[:504], expected[:504])
            self.assertNotEqual(order[504:], expected[504:])
        self.assertNotEqual(order_for(43, 504), order_for(44, 504))

    def test_seed42_cannot_be_accidentally_launched_as_a_new_paid_run(self):
        for seed in (42, 45, True, "43"):
            with self.assertRaises(ValueError):
                require_seed(seed, executing=True)

    def test_real_training_entrypoint_sets_requested_seed_before_init_and_after_probe(self):
        tree = ast.parse((ROOT / "gpu_train_coverage_replication.py").read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "set_seed"]
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(ast.unparse(call.args[0]) == "args.seed" for call in calls))
        source = (ROOT / "gpu_train_coverage_replication.py").read_text(encoding="utf-8")
        self.assertLess(source.index("set_seed(args.seed)"), source.index("model = get_peft_model"))
        self.assertLess(source.index("probe.loss.backward()"), source.rindex("set_seed(args.seed)"))

    def test_summary_requires_all_registered_seeds_and_keeps_sign_reversal(self):
        original = read(ROOT / "reports/qwen-state-coverage-2026-09-29/comparison.json")
        results = {seed: deepcopy(original) for seed in (42, 43, 44)}
        results[43]["comparisons"]["pairs"]["s0->t"]["normal"]["net"] = 1
        result = summarize(results)
        self.assertTrue(result["pairs"]["s0->t"]["effects"]["normal"]["sign_reversal"])
        self.assertEqual(result["representative_checkpoint_seed"], 42)
        self.assertFalse(result["prospective_non_regression_guard"]["tm"]["all_three_pass"])
        self.assertEqual(result["prospective_non_regression_guard"]["tm"]["per_seed"]["42"]["autonomous_blocked_writes"], 3)
        for incomplete in ({42: original, 43: original}, {42: original, 43: original, 45: original}):
            with self.assertRaisesRegex(ValueError, "registered seeds"):
                summarize(incomplete)

    def test_seed42_preparation_fingerprints_remain_identical_to_historical_report(self):
        report = read(REVIEWED)
        original = read(preparation.ORIGINAL_PLAN)
        self.assertEqual(report["seeds"]["42"]["arms"], original["arms"])
        for seed in ("42", "43", "44"):
            self.assertEqual(len(report["seeds"][seed]["per_update_target_tokens"]), 126)
            self.assertEqual(sum(report["seeds"][seed]["per_update_target_tokens"]), 41788)

    def test_other_seed_schedule_tampering_cannot_hide_behind_selected_seed(self):
        report = read(REVIEWED)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dump_new(root / "manifest.json", report)
            for seed in (42, 43, 44):
                dump_new(root / f"seed-{seed}/plan.json", report["seeds"][str(seed)])
                dump_new(root / f"seed-{seed}/schedule.json", {a: [{"variant": a, "index": i} for i in order_for(seed, 504)] for a in ARMS})
            with patch.object(preparation, "build_report", return_value=report):
                preparation.verify_prepared(root, root, root, 43)
                path = root / "seed-44/schedule.json"
                schedule = read(path)
                schedule["t"][0]["index"] = (schedule["t"][0]["index"] + 1) % 504
                path.write_text(encode(schedule), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "seed schedule mismatch"):
                    preparation.verify_prepared(root, root, root, 43)


class ReplicationOperationsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.seed, cls.commit = 43, "a" * 40
        cls.diagnostic = cls.root / "diagnostic"
        prepare(cls.diagnostic)
        cls.plan = {"seed": 43, "legacy_preparation_sha256": "b" * 64,
            "diagnostic_plan_sha256": "c" * 64, "expected_runtime": {"scope": "SYNTHETIC TEST ONLY"},
            "arms": {a: {"optimizer_steps": 1, "decisions": 1, "supervised_tokens": 2, "input_tokens": 5,
                         "max_sequence_tokens": 5, "sample_order_sha256": "d" * 64, "target_schedule_sha256": "e" * 64} for a in ARMS}}
        schedule = {a: [{"variant": a, "index": 0}] for a in ARMS}
        tokens = {a: [{"input_ids": [1, 2, 3, 4, 5], "target_tokens": 2}] for a in ARMS}
        cls.token_audit = {"scope": "SYNTHETIC TEST ONLY; not a tokenizer or model execution"}
        patches = [patch.object(auditor, "verify_prepared", return_value=cls.plan),
            patch.object(auditor, "verify_diagnostics", return_value={}),
            patch.object(auditor, "schedules", return_value=(schedule, tokens, {})),
            patch.object(auditor, "audit_tokens", return_value=cls.token_audit),
            patch.object(restorer, "verify_prepared", return_value=cls.plan)]
        for item in patches:
            item.start()
            cls.addClassCleanup(item.stop)
        cls.fixture = cls.root / "complete"
        cls.binding = run_binding(cls.plan, cls.commit)
        dump_new(cls.fixture / "run-binding.json", cls.binding)
        dump_new(cls.fixture / "generation-token-audit.json", cls.token_audit)
        catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cases = fixtures(catalog)
        model = read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json")
        for arm in ARMS:
            train, evaluation = cls.fixture / "training" / arm, cls.fixture / "evaluation" / arm
            binding = arm_binding(cls.plan, cls.commit, arm)
            dump_new(train / "final/adapter_config.json", {"r": 16, "lora_alpha": 32, "lora_dropout": 0.0, "bias": "none", "task_type": "CAUSAL_LM"})
            (train / "final/adapter_model.safetensors").write_bytes(b"FAKE TEST WEIGHTS " + arm.encode())
            hashes = {name: sha256(train / "final" / name) for name in ("adapter_config.json", "adapter_model.safetensors")}
            dump_new(train / "manifest.json", {"arm": arm, "model": model, "plan": cls.plan, "code_commit": cls.commit, "binding": binding})
            totals = {"decisions": 1, "supervised_tokens": 2, "input_tokens": 5}
            dump_new(train / "report.json", {"arm": arm, "steps": 1, "reload_close": True, "changed_adapter_tensors": 1,
                "adapter_sha256": hashes, "processed": totals, "first_step_loss": .1, "last_step_loss": .1,
                "binding": binding, "initial_adapter_sha256": "f" * 64})
            dump_new(train / "initialization.json", {"binding": binding, "initialization_seed": 43,
                "post_probe_seed": 43, "initial_adapter_sha256": "f" * 64})
            dump_new(train / "memory-probe.json", {"binding": binding, "sequence_tokens": 5,
                "optimizer_steps": 0, "initial_parameters_unchanged": True, "forward_backward_passed": True})
            for location in (train, evaluation):
                dump_new(location / "runtime.json", {"binding": binding, "runtime": cls.plan["expected_runtime"]})
            write_rows(train / "training.jsonl", [{"step": 1, "loss": .1, "gradient_norm_before_clip": .5,
                "binding_digest": digest(binding), **totals}])
            dump_new(evaluation / "manifest.json", {"version": VERSION, "arm": arm, "binding": binding,
                "model": model, "code_commit": cls.commit, "adapter_sha256": hashes,
                "prepared_plan_sha256": sha256(REVIEWED), "diagnostic_plan_sha256": sha256(auditor.DIAGNOSTIC_PLAN),
                "parser_version": PARSER, "precision": PRECISION, "test_evaluation": False})
            dump_new(evaluation / "config.json", asdict(config()))
            for panel in ("normal", "diagnostic"):
                generations, calls = [], []
                callback = lambda identity, call: calls.append({"case_id": identity, "call": call})
                if panel == "normal":
                    report, episodes = run_normal(catalog, lambda: NativeWorkflow(generations), on_call=callback)
                else:
                    report, episodes = run_suite(cases, catalog, NativeReference(cases, generations), on_call=callback)
                location = evaluation / panel
                dump_new(location / "report.json", report)
                for name, rows in (("episodes", episodes), ("calls", calls), ("generations", generations)):
                    write_rows(location / (name + ".jsonl"), rows)
        cls.result = cls.run_audit(cls.fixture)
        dump_new(cls.fixture / "comparison.json", cls.result)
        dump_new(cls.fixture / "window-status.json", {"status": "complete", "run_binding": cls.binding})

    @classmethod
    def run_audit(cls, run):
        return auditor.audit(run, cls.root, cls.diagnostic, cls.root, 43, cls.root)

    def setUp(self):
        self.scratch = Path(tempfile.mkdtemp(dir=self.root))

    def copied(self):
        return Path(shutil.copytree(self.fixture, self.scratch / "run"))

    def archive(self, run, *, status="complete"):
        archives, download = [], self.scratch / "downloads"
        download.mkdir()
        for arm in ARMS:
            if (run / "training" / arm).exists():
                item = archive_run(run / "training" / arm)
                archives.append({"part": arm, "binding": arm_binding(self.plan, self.commit, arm), "path": "training/" + item["archive"], **item})
                shutil.copyfile(run / "training" / item["archive"], download / item["archive"])
        item = evidence_backup(run)
        archives.append({"part": "evidence", "binding": self.binding, "path": item["archive"], **item})
        shutil.copyfile(run / item["archive"], download / item["archive"])
        index = {"status": status, "run_binding": self.binding, "archives": archives}
        dump_new(download / "backup-ready.json", {**index, "inventory_digest": digest(index)})
        return download, index

    def restore(self, download, *, partial=False):
        return restorer.assemble(download, self.root, self.diagnostic, self.root, 43, self.root, self.commit,
                                 self.scratch / "restored", allow_partial=partial)

    def edit(self, path, key, value):
        obj = read(path)
        obj[key] = value
        path.write_text(encode(obj), encoding="utf-8")

    def test_full_native_replay_five_archives_and_seed_bound_ack(self):
        download, index = self.archive(self.copied())
        result = self.restore(download)
        self.assertEqual(result["episodes_replayed"], 124)
        self.assertTrue(window.valid_ack(self.scratch / "restored/off-instance-backup.json", index))
        wrong = deepcopy(index)
        wrong["run_binding"]["seed"] = 44
        self.assertFalse(window.valid_ack(self.scratch / "restored/off-instance-backup.json", wrong))
        wrong = deepcopy(index)
        wrong["status"] = "unknown"
        self.assertFalse(window.valid_ack(self.scratch / "restored/off-instance-backup.json", wrong))

    def test_wrong_seed_or_arm_refuses_training_artifact_before_comparison(self):
        run = self.copied()
        wrong = arm_binding({**self.plan, "seed": 44}, self.commit, "s0")
        self.edit(run / "training/s0/report.json", "binding", wrong)
        with self.assertRaisesRegex(ValueError, "binding mismatch"):
            self.run_audit(run)
        self.edit(run / "training/s0/report.json", "binding", arm_binding(self.plan, self.commit, "t"))
        with self.assertRaisesRegex(ValueError, "binding mismatch"):
            self.run_audit(run)

    def test_wrong_log_seed_and_actual_adapter_bytes_are_rejected(self):
        run = self.copied()
        path = run / "training/s0/training.jsonl"
        self.edit(path, "binding_digest", "0" * 64)
        with self.assertRaisesRegex(ValueError, "log seed binding"):
            self.run_audit(run)
        shutil.copyfile(self.fixture / "training/s0/training.jsonl", path)
        (run / "training/s0/final/adapter_model.safetensors").write_bytes(b"WRONG BYTES")
        with self.assertRaisesRegex(ValueError, "adapter file"):
            self.run_audit(run)

    def test_initialization_probe_and_environment_drift_are_rejected(self):
        run = self.copied()
        path = run / "training/s0/initialization.json"
        self.edit(path, "post_probe_seed", 42)
        with self.assertRaisesRegex(ValueError, "initialization/probe"):
            self.run_audit(run)
        shutil.copyfile(self.fixture / "training/s0/initialization.json", path)
        self.edit(run / "training/s0/runtime.json", "runtime", {"packages": "changed"})
        with self.assertRaisesRegex(ValueError, "runtime differs"):
            self.run_audit(run)

    def test_forged_comparison_or_token_audit_cannot_produce_complete_ack(self):
        run = self.copied()
        self.edit(run / "generation-token-audit.json", "forged", True)
        download, _ = self.archive(run)
        with self.assertRaisesRegex(ValueError, "token audit differs"):
            self.restore(download)
        self.assertFalse((self.scratch / "restored/off-instance-backup.json").exists())

    def test_forged_complete_comparison_is_rejected_after_archive_verification(self):
        run = self.copied()
        self.edit(run / "comparison.json", "episodes_replayed", 125)
        download, _ = self.archive(run)
        with self.assertRaisesRegex(ValueError, "comparison differs"):
            self.restore(download)
        self.assertFalse((self.scratch / "restored/off-instance-backup.json").exists())

    def test_index_cannot_relabel_seed_even_with_a_recomputed_digest(self):
        download, index = self.archive(self.copied())
        index = deepcopy(index)
        index["run_binding"]["seed"] = 44
        index["inventory_digest"] = digest(index)
        with self.assertRaisesRegex(ValueError, "binding mismatch"):
            restorer.validate_index(index, self.plan, self.commit)

    def test_partial_receipt_proves_only_bytes_and_preserves_seed(self):
        run = self.scratch / "partial"
        dump_new(run / "run-binding.json", self.binding)
        dump_new(run / "window-status.json", {"status": "failed", "run_binding": self.binding})
        download, index = self.archive(run, status="failed")
        result = self.restore(download, partial=True)
        self.assertEqual(result["episodes_replayed"], 0)
        self.assertFalse(result["token_ids_verified"])
        self.assertTrue(window.valid_ack(self.scratch / "restored/off-instance-backup.json", index))

    def test_boot_limit_and_ten_phase_plan_never_include_reserved_tasks(self):
        boot = datetime(2026, 10, 1, tzinfo=timezone.utc)
        self.assertEqual(window.deadline(boot.isoformat(), boot + timedelta(minutes=10)), boot + timedelta(hours=3))
        with self.assertRaises(ValueError):
            window.deadline(boot.isoformat(), boot + timedelta(minutes=10, seconds=1))
        commands = window.phases(*[Path(n) for n in ("model", "manifest", "prepared", "diag", "replication", "tokenizer", "output")], 43, self.commit)
        self.assertEqual([n for n, _ in commands], [n for arm in ARMS for n in ("train-" + arm, "evaluate-" + arm)] + ["audit-tokens", "audit"])
        self.assertFalse(any("test.jsonl" in arg for _, argv in commands for arg in argv))
        for _, argv in commands[:8]:
            self.assertEqual(argv[argv.index("--seed") + 1], "43")
            self.assertEqual(argv[argv.index("--expected-code-commit") + 1], self.commit)

    def test_default_dry_run_does_not_start_processes_or_touch_output(self):
        args = ["window", "--seed", "43", "--expected-code-commit", self.commit, "--hourly-cny", "2.18"]
        for name in ("model-dir", "model-manifest", "prepared-dir", "diagnostic-dir", "replication-dir", "tokenizer-dir", "output-dir"):
            args += ["--" + name, str(self.scratch / name)]
        output = io.StringIO()
        with patch.object(sys, "argv", args), patch.object(sys, "stdout", output), \
                patch.object(window, "verify_prepared", return_value=self.plan), \
                patch.object(window, "verify_diagnostics", return_value={}), \
                patch.object(window.subprocess, "Popen") as popen, patch.object(window.subprocess, "run") as run:
            window.main()
            popen.assert_not_called()
            run.assert_not_called()
        self.assertTrue(json.loads(output.getvalue())["dry_run"])
        self.assertFalse((self.scratch / "output-dir").exists())
