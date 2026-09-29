from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import audit_state_diagnostics as audit_module
from state_diagnostics import config, fixtures, prepare, ReferenceTransport, run_suite
from audit_state_diagnostics import audit
from gpu_state_diagnostics import expected_adapter, PARSER, PRECISION, read, verify_adapter
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import Reply, encode
from liftcut_agent.qwen_transport import parse_tool_message
from recovery_dataset import write_rows
from restore_state_diagnostics import restore_diagnostics
from run_controlled_window import evidence_backup
from run_state_diagnostic_window import deadlines, phases, valid_ack
from server_workspace import dump_new, sha256


class NativeReference(ReferenceTransport):
    """Fabricated native text for audit tests; never a GPU/model result."""
    def __init__(self, cases):
        super().__init__(cases)
        self.generations = []

    def complete(self, payload):
        self.number += 1
        selected = self.lookup[digest(payload)]
        raw = '<tool_call>' + encode({"name": selected["tool"], "arguments": selected["arguments"]}) + '</tool_call><|im_end|>'
        self.generations.append({"request_number": self.number, "raw_text": raw, "output_ids": [1, 2],
            "model_called": True, "prompt_tokens": 100, "eos_reached": True, "parse_error": None, "elapsed_seconds": 0.0})
        return Reply(encode({"choices": [{"finish_reason": "tool_calls", "message": parse_tool_message(raw, self.number)}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 2, "total_tokens": 102}}))


class StateDiagnosticOperationsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.prepared = self.root / "prepared"
        prepare(self.prepared)
        self.plan = self.root / "reviewed.json"
        self.plan.write_text('{}', encoding="utf-8")
        self.patchers = [patch.object(audit_module, "verify_prepared", return_value={}),
                         patch.object(audit_module, "REVIEWED", self.plan)]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def make_run(self):
        run = self.root / "run"
        catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cases = fixtures(catalog)
        for arm in ("clean", "mixed"):
            transport = NativeReference(cases)
            live_calls = []
            result, episodes = run_suite(cases, catalog, transport,
                on_call=lambda identity, call: live_calls.append({"case_id": identity, "call": call}))
            path = run / "evaluation" / arm
            dump_new(path / "manifest.json", {"version": "state-diagnostics-v1", "arm": arm,
                "adapter_sha256": expected_adapter(arm), "prepared_plan_sha256": sha256(self.plan),
                "parser_version": PARSER, "precision": PRECISION, "test_evaluation": False,
                "training_steps": 0, "max_requests_per_case": 3, "max_requests_arm": 57,
                "model": read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json"), "code_commit": "a" * 40})
            dump_new(path / "config.json", asdict(config()))
            dump_new(path / "report.json", result)
            write_rows(path / "episodes.jsonl", episodes)
            write_rows(path / "calls.jsonl", live_calls)
            write_rows(path / "generations.jsonl", transport.generations)
        dump_new(run / "window-status.json", {"status": "complete"})
        dump_new(run / "comparison.json", audit(run, self.prepared))
        return run

    def test_complete_native_audit_archive_restore_and_ack(self):
        run = self.make_run()
        backup = evidence_backup(run)
        ack = restore_diagnostics(run / backup["archive"], self.root / "restored", backup["sha256"], self.prepared)
        self.assertTrue(ack["complete_pair_replayed"])
        self.assertTrue(valid_ack(self.root / "restored/off-instance-backup.json", backup, "complete"))
        self.assertEqual(read(run / "comparison.json")["total_states_replayed"], 38)

    def test_native_text_drift_invalidates_model_claim(self):
        run = self.make_run()
        path = run / "evaluation/clean/generations.jsonl"
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        rows[0]["raw_text"] = rows[0]["raw_text"].replace("awaiting_user", "previewed")
        path.write_text("".join(encode(r) + "\n" for r in rows), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "native text"):
            audit(run, self.prepared)

    def test_extra_durable_call_is_not_silently_dropped(self):
        run = self.make_run()
        path = run / "evaluation/clean/calls.jsonl"
        with path.open("a", encoding="utf-8") as stream:
            stream.write(path.read_text(encoding="utf-8").splitlines()[0] + "\n")
        with self.assertRaisesRegex(ValueError, "durable live calls"):
            audit(run, self.prepared)

    def test_wrong_adapter_or_missing_case_prevents_complete_audit(self):
        run = self.make_run()
        path = run / "evaluation/mixed/manifest.json"
        manifest = read(path)
        manifest["adapter_sha256"] = expected_adapter("clean")
        path.write_text(encode(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "provenance"):
            audit(run, self.prepared)

    def test_tampered_comparison_cannot_create_backup_ack(self):
        run = self.make_run()
        (run / "comparison.json").write_text("{}", encoding="utf-8")
        backup = evidence_backup(run)
        with self.assertRaisesRegex(ValueError, "comparison differs"):
            restore_diagnostics(run / backup["archive"], self.root / "restored", backup["sha256"], self.prepared)
        self.assertFalse((self.root / "restored/off-instance-backup.json").exists())

    def test_partial_archive_acknowledges_bytes_only(self):
        run = self.root / "partial"
        dump_new(run / "window-status.json", {"status": "failed"})
        dump_new(run / "evaluation/clean/partial.json", {"calls": "partial synthetic evidence"})
        backup = evidence_backup(run)
        ack = restore_diagnostics(run / backup["archive"], self.root / "restored", backup["sha256"], self.prepared, allow_partial=True)
        self.assertFalse(ack["complete_pair_replayed"])
        self.assertTrue(valid_ack(self.root / "restored/off-instance-backup.json", backup, "failed"))
        self.assertFalse(valid_ack(self.root / "restored/off-instance-backup.json", backup, "complete"))
        self.assertFalse(valid_ack(self.root / "restored/off-instance-backup.json", {"sha256": "wrong"}, "failed"))

    def test_deadlines_include_setup_and_refuse_late_launch(self):
        boot = datetime(2026, 9, 29, tzinfo=timezone.utc)
        soft, hard = deadlines(boot.isoformat(), boot + timedelta(minutes=10))
        self.assertEqual(soft - boot, timedelta(minutes=35))
        self.assertEqual(hard - boot, timedelta(minutes=60))
        for now in (boot - timedelta(seconds=1), boot + timedelta(minutes=10, seconds=1)):
            with self.assertRaises(ValueError):
                deadlines(boot.isoformat(), now)
        with self.assertRaises(ValueError):
            deadlines("2026-09-29T00:00:00", boot)

    def test_window_has_no_training_or_test_phases(self):
        commands = phases(Path("model"), Path("manifest"), Path("prepared"), Path("adapters"), Path("output"))
        self.assertEqual([name for name, argv in commands], ["evaluate-clean", "evaluate-mixed", "audit"])
        for _, argv in commands[:2]:
            self.assertIn("--allow-gpu", argv)
            self.assertNotIn("--cases", argv)
            self.assertTrue(any(p.endswith("gpu_state_diagnostics.py") for p in argv))

    def test_wrong_adapter_bytes_fail_before_model_load(self):
        directory = self.root / "adapter"
        directory.mkdir()
        (directory / "adapter_config.json").write_text("{}", encoding="utf-8")
        (directory / "adapter_model.safetensors").write_bytes(b"not-an-adapter")
        with self.assertRaisesRegex(ValueError, "adapter differs"):
            verify_adapter("clean", directory)


if __name__ == "__main__":
    unittest.main()
