"""Bounded D2 execution/closure faults. No network, GPU or real shutdown."""
from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import d2_execution as d2
from counterfactual_diagnostics import fixtures, ReferenceTransport
from liftcut_agent.benchmark import load_catalog
from server_workspace import dump_new
from run_counterfactual_window import finalize, observed_progress, phases, run_phase
from d2_receipt_transfer import validate_index, validate_receipt, transfer_receipt
from monitor_counterfactual_diagnostics import parse_config, validate_remote, download
from d2_setup import boot_proxy
from audit_counterfactual_diagnostics import g1_assessment
from test_replication_receipt_transfer import FakeSFTP, Clock as FakeClock, payload as old_payload, REMOTE
from liftcut_agent.interactive import digest


class Clock:
    def __init__(self):
        self.value = d2.aware("2026-10-02T12:01:00+00:00")

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += timedelta(seconds=seconds)


def synthetic_receipt(complete=True):
    # Deliberately fabricated schema fixture; never written into real run paths.
    bind = {"synthetic_schema_fixture": True}
    index = {"version": "d2-backup-v1", "binding": bind, "evidence_kind": "scripted_contract",
             "status": "complete" if complete else "partial", "archive": "evidence.tar.gz", "bytes": 10, "sha256": "0" * 64}
    receipt = {"version": "d2-backup-receipt-v1", "binding": bind, "index_digest": digest(index),
        "evidence_kind": "scripted_contract", "run_status": index["status"], "archive": index["archive"],
        "bytes": index["bytes"], "sha256": index["sha256"], "verified_files": 1,
        "all_inventory_files_verified": True, "complete_study_replayed": complete,
        "episodes_replayed": 320 if complete else 0, "adapter_files_verified": complete,
        "token_ids_verified": complete, "model_result": False, "test_episodes": 0}
    return bind, index, receipt


class ExecutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.original = fixtures(cls.catalog)
        cls.cases = d2.ordered_cases(cls.original)

    def execute(self, seconds=5400, timing=1.):
        cases, timings, clock = self.cases, [], Clock()
        class Transport:
            case_index = 0
            current = ReferenceTransport(cases[0])
            def complete(self, payload):
                timings.append({"model_called": True, "elapsed_seconds": timing})
                return self.current.complete(payload)
            def advance(self, row):
                self.case_index += 1
                if self.case_index < 80:
                    self.current = ReferenceTransport(cases[self.case_index])
        transport = Transport()
        return d2.execute_arm(cases, self.catalog, transport, "s0", clock.now() + timedelta(seconds=seconds),
            1., clock=clock, timing_rows=timings, on_episode=transport.advance)

    def test_registered_calibration_is_inside_all_eighty_unique_cases(self):
        self.assertEqual(len(self.cases), 80)
        self.assertEqual({c["id"] for c in self.cases}, {c["id"] for c in self.original})
        self.assertEqual(self.cases[:12], [self.original[i] for i in d2.CALIBRATION_INDICES])
        self.assertEqual(sum(c["contract"]["max_requests"] for c in self.cases), 136)
        self.assertEqual({c["panel"] for c in self.cases[:12]}, set(d2.PANELS))

    def test_full_execution_forecast_uses_all_remaining_arms(self):
        report, episodes = self.execute()
        self.assertEqual(report["completed_attempts"], 80)
        self.assertEqual(len(report["estimates"]), 68)
        first = report["estimates"][0]
        self.assertEqual(first["remaining_request_caps"], 3 * 136 + sum(c["contract"]["max_requests"] for c in self.cases[12:]))
        self.assertTrue(all(p["correct"] == p["total"] for p in report["panels"].values()))
        self.assertEqual(first["observations"], 14)

    def test_forecast_stops_without_resampling_or_missing_denominator(self):
        report, episodes = self.execute(seconds=1000)
        self.assertEqual(len(episodes), 12)
        self.assertEqual(report["missing"], 68)
        self.assertEqual(report["total"], 80)
        self.assertEqual(report["stop_reason"], "forecast_exceeds_work_window")
        self.assertTrue(all(not r["correct"] for r in report["results"] if not r["attempt_complete"]))

    def test_deadline_before_first_case_preserves_denominator(self):
        report, episodes = self.execute(seconds=0)
        self.assertEqual(episodes, [])
        self.assertEqual(report["missing"], 80)
        self.assertEqual(report["stop_reason"], "work_deadline")

    def test_slow_observation_changes_gate(self):
        report, _ = self.execute(timing=10.)
        self.assertEqual(report["completed_attempts"], 12)
        self.assertEqual(report["stop_reason"], "forecast_exceeds_work_window")

    def test_clock_rollback_does_not_extend_window(self):
        clock, ticks = Clock(), [0.]
        safe = d2.Clock(now=clock.now, monotonic=lambda: ticks[0])
        initial = safe.now()
        clock.value -= timedelta(hours=1)
        ticks[0] = 30.
        self.assertEqual(safe.now(), initial + timedelta(seconds=30))

    def test_deadlines_reject_late_future_or_naive_openings(self):
        now = Clock().now()
        for boot in ((now - timedelta(minutes=11)).isoformat(), (now + timedelta(seconds=1)).isoformat(), "2026-10-02T12:00:00"):
            with self.assertRaises(ValueError):
                d2.deadlines(boot, now)
        work, hard = d2.deadlines("2026-10-02T12:00:00+00:00", now)
        self.assertEqual((hard - work).total_seconds(), 1800)

    def test_boot_proxy_cannot_hide_earlier_container_start(self):
        now = Clock().now()
        old = now - timedelta(minutes=30)
        self.assertEqual(boot_proxy(now.isoformat(), now, old), old)

    def test_partial_order_tampering_rejected(self):
        _, episodes = self.execute(seconds=1000)
        for bad in (list(reversed(episodes)), episodes + [episodes[0]]):
            with self.assertRaises(ValueError):
                d2.partial_summary(self.cases, bad, "test")

    def test_invalid_timings_rejected(self):
        for value in (-1, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                d2.remaining_estimate([{"model_called": True, "elapsed_seconds": value}], 0, 10, 0)

    def test_presence_keeps_all_arms_and_truncated_last_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "evaluation/s0/episodes.jsonl"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"case_id": self.cases[0]["id"]}) + '\n{"truncated":', encoding="utf-8")
            report = observed_progress(root, self.cases)
            self.assertEqual(report["total"], 320)
            self.assertEqual(report["durable_episodes"], 1)

    def test_no_training_or_paid_api_phase(self):
        commands = phases(*([Path("x")] * 6), "a" * 40)
        self.assertEqual([name for name, _ in commands], ["evaluate-s0", "evaluate-t", "evaluate-m", "evaluate-tm", "audit"])
        self.assertNotIn("train", json.dumps(commands))

    def test_expired_phase_never_invokes_subprocess(self):
        clock = Clock()
        with tempfile.TemporaryDirectory() as tmp, patch("subprocess.run") as run:
            with self.assertRaises(TimeoutError):
                run_phase("test", ["x"], Path(tmp), clock.now(), clock, runner=run)
            run.assert_not_called()

    def test_archive_failure_still_requests_shutdown(self):
        clock, calls = Clock(), []
        def fail(_):
            raise OSError("synthetic backup failure")
        with tempfile.TemporaryDirectory() as tmp:
            result = finalize(Path(tmp), "partial", [], {}, clock.now() + timedelta(minutes=10), clock,
                              archive=fail, shutdown=lambda: calls.append("stub") or 0)
            self.assertIsNone(result)
            self.assertEqual(calls, ["stub"])

    def test_no_ack_grace_is_bounded_and_shutdown_not_billing_proof(self):
        clock, calls = Clock(), []
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = lambda _: {"archive": "evidence.tar.gz", "bytes": 10, "sha256": "0" * 64}
            finalize(root, "partial", [], {}, clock.now() + timedelta(seconds=90), clock,
                archive=archive, sleep=clock.sleep, shutdown=lambda: calls.append("stub") or 0)
            self.assertEqual(calls, ["stub"])
            self.assertFalse(d2.read(root / "backup-copy-status.json")["off_instance_acknowledged"])
            self.assertEqual(d2.read(root / "shutdown-request.json")["provider_billing_stopped"], "unknown")

    def test_g1_excludes_technical_failures_and_repaired_other_errors(self):
        rows = [{"case_id": error + str(i), "panel": "repair", "factors": {"error": error, "variant": i},
                 "policy_failure": None, "interface_errors": [], "model_requests": 1,
                 "target_field_repaired": False, "premature_infeasible_before_repair": False}
                for error in ("unknown_evidence", "session_count_mismatch") for i in (0, 1)]
        self.assertTrue(g1_assessment({"t": {"case_results": rows}})["any_behavior_trigger"])
        for key, value in (("policy_failure", "timeout"), ("interface_errors", ["invalid_arguments"]), ("target_field_repaired", True)):
            changed = deepcopy(rows)
            for i in (0, 2):
                changed[i][key] = value
            self.assertFalse(g1_assessment({"t": {"case_results": changed}})["any_behavior_trigger"])


class ReceiptTests(unittest.TestCase):
    def test_scripted_evidence_cannot_be_accepted_as_model(self):
        bind, index, receipt = synthetic_receipt()
        with self.assertRaises(ValueError):
            validate_receipt(json.dumps(receipt), index, bind)
        validate_receipt(json.dumps(receipt), index, bind, kind="scripted_contract")

    def test_partial_ack_has_no_replay_or_weight_claim(self):
        bind, index, receipt = synthetic_receipt(False)
        validate_receipt(json.dumps(receipt), index, bind, kind="scripted_contract")
        for key in ("episodes_replayed", "adapter_files_verified", "complete_study_replayed", "model_result"):
            changed = {**receipt, key: 320 if key == "episodes_replayed" else True}
            with self.assertRaises(ValueError):
                validate_receipt(json.dumps(changed), index, bind, kind="scripted_contract")

    def transfer(self, fault=None):
        bind, index, receipt = synthetic_receipt()
        clock = FakeClock()
        sftp = FakeSFTP(clock, fault)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "SYNTHETIC-RECEIPT.json"
            dump_new(path, receipt)
            result = transfer_receipt(sftp, path, REMOTE, index, bind, clock() + timedelta(minutes=5),
                                      now=clock, kind="scripted_contract")
            return result, sftp

    def test_exclusive_readback_publication_does_not_claim_consumption(self):
        result, sftp = self.transfer()
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["server_acceptance"], "unknown")
        self.assertTrue(any(c[0] == "rename" for c in sftp.calls))

    def test_upload_faults_do_not_publish(self):
        for fault in ("half_write", "silent_half_write", "close_failure", "read_close_failure", "hash_mismatch", "deadline_after_write"):
            result, sftp = self.transfer(fault)
            self.assertEqual(result["status"], "failed", fault)
            self.assertNotIn(REMOTE + "/off-instance-backup.json", sftp.files)

    def test_rename_ambiguity_is_unknown_not_success_or_retry(self):
        for fault in ("rename_before", "rename_after"):
            result, sftp = self.transfer(fault)
            self.assertEqual(result["status"], "unknown")
            self.assertEqual(sum(c[0] == "rename" for c in sftp.calls), 1)

    def test_wrong_index_rejected_before_upload(self):
        bind, index, receipt = synthetic_receipt()
        index["bytes"] = 600_000_000
        with self.assertRaises(ValueError):
            validate_index(index, bind, kind="scripted_contract")


if __name__ == "__main__":
    unittest.main()
