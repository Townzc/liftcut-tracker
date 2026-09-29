from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import audit_state_coverage as audit_module
from audit_state_coverage import audit, paired_comparisons
from coverage_rollout import run_normal
from state_coverage import ARMS, config
from state_diagnostics import prepare, fixtures, run_suite, ReferenceTransport
from gpu_state_diagnostics import PARSER, PRECISION, read
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import Reply, encode
from liftcut_agent.model_transport import MockWorkflowTransport
from liftcut_agent.qwen_transport import parse_tool_message
from recovery_dataset import write_rows
from run_recovery_window import archive_run
from run_controlled_window import evidence_backup
from run_state_coverage_window import deadline, phases, valid_ack
from restore_state_coverage import assemble, validate_index
from server_workspace import dump_new, sha256


def native_reply(action, generations):
    number = len(generations) + 1
    raw = '<tool_call>' + encode(action) + '</tool_call><|im_end|>'
    generations.append({"request_number": number, "raw_text": raw, "output_ids": [1, 2],
        "model_called": True, "prompt_tokens": 100, "eos_reached": True, "parse_error": None, "elapsed_seconds": 0.0})
    return Reply(encode({"choices": [{"finish_reason": "tool_calls", "message": parse_tool_message(raw, number)}],
                         "usage": {"prompt_tokens": 100, "completion_tokens": 2, "total_tokens": 102}}))


class NativeWorkflow(MockWorkflowTransport):
    def __init__(self, generations):
        super().__init__()
        self.generations = generations

    def complete(self, payload):
        body = json.loads(super().complete(payload).body)
        action = body["choices"][0]["message"]["tool_calls"][0]["function"]
        action["arguments"] = json.loads(action["arguments"])
        return native_reply(action, self.generations)


class NativeReference(ReferenceTransport):
    def __init__(self, cases, generations):
        super().__init__(cases)
        self.generations = generations

    def complete(self, payload):
        action = self.lookup[digest(payload)]
        return native_reply({"name": action["tool"], "arguments": action["arguments"]}, self.generations)


class CoverageOperationsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.diagnostic = cls.root / "diagnostic"
        prepare(cls.diagnostic)
        cls.plan = {"arms": {a: {"optimizer_steps": 1, "decisions": 1, "supervised_tokens": 2, "input_tokens": 5} for a in ARMS}}
        schedule = {a: [{"variant": a, "index": 0}] for a in ARMS}
        tokens = {a: [{"input_ids": [1, 2, 3, 4, 5], "target_tokens": 2}] for a in ARMS}
        cls.patchers = [patch.object(audit_module, "verify_prepared", return_value=cls.plan),
                        patch.object(audit_module, "verify_diagnostics", return_value={}),
                        patch.object(audit_module, "schedules", return_value=(schedule, tokens, {}))]
        for patcher in cls.patchers:
            patcher.start()
        cls.addClassCleanup(cls.tmp.cleanup)
        for patcher in cls.patchers:
            cls.addClassCleanup(patcher.stop)
        cls.fixture_run = cls.root / "complete"
        catalog, cases = load_catalog(ROOT / "benchmark/catalog.json"), fixtures(load_catalog(ROOT / "benchmark/catalog.json"))
        model = read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json")
        for arm in ARMS:
            train, evaluation = cls.fixture_run / "training" / arm, cls.fixture_run / "evaluation" / arm
            dump_new(train / "final/adapter_config.json", {"r": 16, "lora_alpha": 32, "lora_dropout": 0.0, "bias": "none", "task_type": "CAUSAL_LM"})
            (train / "final/adapter_model.safetensors").write_bytes(b'FAKE TEST WEIGHTS ' + arm.encode())
            hashes = {n: sha256(train / "final" / n) for n in ("adapter_config.json", "adapter_model.safetensors")}
            dump_new(train / "manifest.json", {"arm": arm, "model": model, "plan": cls.plan, "code_commit": "a" * 40})
            totals = {"decisions": 1, "supervised_tokens": 2, "input_tokens": 5}
            dump_new(train / "report.json", {"arm": arm, "steps": 1, "reload_close": True, "changed_adapter_tensors": 1,
                "adapter_sha256": hashes, "processed": totals, "first_step_loss": .1, "last_step_loss": .1})
            write_rows(train / "training.jsonl", [{"step": 1, "loss": .1, "gradient_norm_before_clip": .5, **totals}])
            dump_new(evaluation / "manifest.json", {"version": "state-coverage-evaluation-v1", "arm": arm,
                "model": model, "code_commit": "a" * 40, "adapter_sha256": hashes,
                "prepared_plan_sha256": sha256(audit_module.REVIEWED), "diagnostic_plan_sha256": sha256(audit_module.DIAGNOSTIC_PLAN),
                "parser_version": PARSER, "precision": PRECISION, "test_evaluation": False})
            dump_new(evaluation / "config.json", asdict(config()))
            for panel in ("normal", "diagnostic"):
                generations, calls = [], []
                callback = lambda identity, call: calls.append({"case_id": identity, "call": call})
                if panel == "normal":
                    report, episodes = run_normal(catalog, lambda: NativeWorkflow(generations), on_call=callback)
                else:
                    report, episodes = run_suite(cases, catalog, NativeReference(cases, generations), on_call=callback)
                path = evaluation / panel
                dump_new(path / "report.json", report)
                for name, rows in (("episodes", episodes), ("calls", calls), ("generations", generations)):
                    write_rows(path / (name + ".jsonl"), rows)
        cls.result = audit(cls.fixture_run, cls.root, cls.diagnostic)
        dump_new(cls.fixture_run / "comparison.json", cls.result)
        dump_new(cls.fixture_run / "window-status.json", {"status": "complete", "failures": []})

    def setUp(self):
        self.scratch = Path(tempfile.mkdtemp(dir=self.root))

    def copied(self):
        path = self.scratch / "run"
        shutil.copytree(self.fixture_run, path)
        return path

    def archive(self, run):
        archives, download = [], self.scratch / "download"
        download.mkdir()
        for arm in ARMS:
            item = archive_run(run / "training" / arm)
            archives.append({"part": arm, "path": "training/" + item["archive"], **item})
            shutil.copyfile(run / "training" / item["archive"], download / item["archive"])
        item = evidence_backup(run)
        archives.append({"part": "evidence", "path": item["archive"], **item})
        shutil.copyfile(run / item["archive"], download / item["archive"])
        index = {"archives": archives, "status": "complete"}
        dump_new(download / "backup-ready.json", {**index, "inventory_digest": digest(index)})
        return download, index

    def test_complete_native_audit_and_five_archive_restore_before_ack(self):
        self.assertEqual(self.result["episodes_replayed"], 124)
        self.assertEqual(self.result["comparisons"]["factor_screen_passed"], {"T": False, "M": False})
        download, index = self.archive(self.copied())
        receipt = assemble(download, self.root, self.diagnostic, self.scratch / "restored")
        self.assertEqual(receipt["episodes_replayed"], 124)
        self.assertTrue(receipt["adapter_files_verified"])
        self.assertTrue(valid_ack(self.scratch / "restored/off-instance-backup.json", index))

    def test_changed_native_text_or_durable_call_cannot_pass_audit(self):
        run = self.copied()
        path = run / "evaluation/t/diagnostic/generations.jsonl"
        rows = read_jsonl(path)
        rows[0]["raw_text"] = rows[0]["raw_text"].replace("awaiting_user", "previewed")
        path.write_text("".join(encode(r) + "\n" for r in rows), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "native text"):
            audit(run, self.root, self.diagnostic)

    def test_training_counter_or_actual_weight_mismatch_rejected(self):
        run = self.copied()
        path = run / "training/s0/training.jsonl"
        row = read_jsonl(path)[0]
        row["supervised_tokens"] = 3
        path.write_text(encode(row) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "sampler"):
            audit(run, self.root, self.diagnostic)
        shutil.copyfile(self.fixture_run / "training/s0/training.jsonl", path)
        (run / "training/s0/final/adapter_model.safetensors").write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError, "adapter file"):
            audit(run, self.root, self.diagnostic)

    def test_forged_comparison_cannot_create_complete_backup_receipt(self):
        run = self.copied()
        (run / "comparison.json").write_text('{}', encoding="utf-8")
        download, _ = self.archive(run)
        with self.assertRaisesRegex(ValueError, "comparison differs"):
            assemble(download, self.root, self.diagnostic, self.scratch / "restored")
        self.assertFalse((self.scratch / "restored/off-instance-backup.json").exists())

    def test_missing_arm_and_duplicate_archives_rejected_before_restore(self):
        parts = [{"part": a, "archive": a + ".tar.gz", "path": ("training/" if a != "evidence" else "") + a + ".tar.gz"} for a in (*ARMS, "evidence")]
        for archives in (parts[:-2] + parts[-1:], parts + parts[:1]):
            index = {"archives": archives, "status": "complete"}
            with self.assertRaisesRegex(ValueError, "backup parts"):
                validate_index({**index, "inventory_digest": digest(index)})

    def test_partial_backup_proves_only_saved_bytes(self):
        run = self.scratch / "partial"
        dump_new(run / "window-status.json", {"status": "failed"})
        item = evidence_backup(run)
        download = self.scratch / "download"
        download.mkdir()
        shutil.copyfile(run / item["archive"], download / item["archive"])
        index = {"status": "failed", "archives": [{"part": "evidence", "path": item["archive"], **item}]}
        dump_new(download / "backup-ready.json", {**index, "inventory_digest": digest(index)})
        receipt = assemble(download, self.root, self.diagnostic, self.scratch / "restored", allow_partial=True)
        self.assertFalse(receipt["complete_study_replayed"])
        self.assertEqual(receipt["episodes_replayed"], 0)
        self.assertTrue(valid_ack(self.scratch / "restored/off-instance-backup.json", index))
        self.assertFalse(valid_ack(self.scratch / "restored/off-instance-backup.json", {**index, "status": "complete"}))

    def test_factor_gate_requires_paired_gain_and_no_new_blocked_write_case(self):
        reports = deepcopy(self.result["arms"])
        for row in reports["s0"]["diagnostic"]["results"]:
            if row["factors"].get("history") == "read":
                row["correct"] = False
        self.assertTrue(paired_comparisons(reports)["pairs"]["s0->t"]["development_gate_passed"])
        # Offset counts elsewhere cannot hide a newly failing write case.
        reports["s0"]["normal"]["results"][0]["blocked_write_attempts"] = 1
        reports["t"]["normal"]["results"][1]["blocked_write_attempts"] = 1
        result = paired_comparisons(reports)["pairs"]["s0->t"]
        self.assertFalse(result["development_gate_passed"])
        self.assertEqual(len(result["cases_with_added_blocked_writes"]), 1)

    def test_three_hour_boot_deadline_and_all_four_training_evaluation_phases(self):
        boot = datetime(2026, 9, 29, tzinfo=timezone.utc)
        self.assertEqual(deadline(boot.isoformat(), boot + timedelta(minutes=10)), boot + timedelta(hours=3))
        for now in (boot - timedelta(seconds=1), boot + timedelta(minutes=10, seconds=1)):
            with self.assertRaises(ValueError):
                deadline(boot.isoformat(), now)
        commands = phases(*[Path(s) for s in ("model", "manifest", "prepared", "diagnostic", "output")])
        self.assertEqual([n for n, _ in commands], [n for a in ARMS for n in ("train-" + a, "evaluate-" + a)] + ["audit"])
        self.assertFalse(any("test.jsonl" in arg for _, argv in commands for arg in argv))


if __name__ == "__main__":
    unittest.main()
