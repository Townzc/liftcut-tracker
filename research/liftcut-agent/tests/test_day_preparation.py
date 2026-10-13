"""Day lease, truthful telemetry, original-trial stop and receipt regressions (CPU only)."""
from copy import deepcopy
from datetime import timedelta
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
import day_lease
from analyze_resource_usage import analyze, activity_accounting
from d2_execution import aware, read
from e1_execution import binding, verify_plan, validate_opening
from e1_power import validate_bound_power
from e1_receipt import fields
from gpu_telemetry import parse_csv
from prepare_e1_execution import scripted_day_authorization
from run_e1_window import finalise
from server_workspace import dump_new


class DayPreparationTests(unittest.TestCase):
    def setUp(self):
        self.auth = scripted_day_authorization()
        self.lease = self.auth['power_lease']
        self.t = aware('2026-10-14T00:01:00+00:00')
        self.b = binding(verify_plan(), '0' * 40, self.auth, '20261014-000100', self.t.isoformat())

    def test_day_does_not_extend_e1_work_collection_or_trial_limit(self):
        self.assertEqual(self.b['work_cutoff'], '2026-10-14T01:31:00+00:00')
        self.assertEqual(self.b['collection_cutoff'], '2026-10-14T01:51:00+00:00')
        self.assertEqual(self.b['hard_cutoff'], '2026-10-14T02:00:00+00:00')
        self.assertEqual(self.b['power_shutdown_at_utc'], '2026-10-15T00:00:00+00:00')
        self.assertEqual(validate_bound_power(self.b, self.t), aware(self.b['hard_cutoff']))
        changed = deepcopy(self.b); changed['work_cutoff'] = changed['power_shutdown_at_utc']
        with self.assertRaises(ValueError):
            validate_opening({'binding': changed, 'at_utc': self.t.isoformat(), 'evidence_kind': 'model'}, verify_plan())

    def test_late_e1_start_and_inconsistent_original_opening_rejected(self):
        with self.assertRaises(ValueError):
            binding(verify_plan(), '0' * 40, self.auth, '20261014-000100', '2026-10-14T00:11:00+00:00')
        bad = deepcopy(self.auth); bad['booted_at_proxy'] = self.t.isoformat()
        with self.assertRaises(ValueError):
            binding(verify_plan(), '0' * 40, bad, '20261014-000100', self.t.isoformat())

    def test_day_scope_budget_and_time_cannot_expand(self):
        for key, value in [('reserve_cny', 60), ('paid_api_calls', 1), ('maximum_followup_gpu_trials', 3),
                           ('automatic_reboot', True), ('final_collection_buffer_minutes', 30),
                           ('shutdown_at_utc', '2026-10-15T00:01:00+00:00')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                day_lease.validate({**self.lease, key: value})

    def test_real_receipt_path_closes_trial_without_requesting_early_power(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp) / 'SCRIPTED'; run.mkdir()
            item = {'archive': 'evidence.tar.gz', 'bytes': 20, 'sha256': 'a' * 64}
            index = {'version': 'e1-delta-index-v1', 'binding': self.b, 'status': 'complete',
                     'evidence_kind': 'scripted_contract', 'archive_is_self_contained': False,
                     'archives': [{'path': 'evidence.tar.gz', **item}]}
            dump_new(run / 'off-instance-backup.json', {**fields(index, self.b, scripted=True), 'verified_files': 9})
            power = Mock()
            with patch('run_e1_window.verify_guard') as guard:
                finalise(run, Path(temp) / 'ops', 'complete', [], self.b, SimpleNamespace(now=lambda: self.t),
                         scripted=True, archive=lambda _: item, power=power, sleep=lambda _: None)
            power.assert_not_called(); guard.assert_called_once()
            self.assertTrue(read(run / 'backup-copy-status.json')['off_instance_acknowledged'])
            close = read(run / 'window-close.json')
            self.assertEqual(close['binding'], self.b)
            self.assertEqual(close['power_action'], 'retained_under_original_day_lease')

    def test_archive_failure_does_not_claim_ack_or_shut_day_early(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp); power = Mock()
            with patch('run_e1_window.verify_guard'), self.assertRaises(OSError):
                finalise(run, run / 'ops', 'partial', [], self.b, SimpleNamespace(now=lambda: self.t),
                         scripted=True, archive=Mock(side_effect=OSError('SCRIPTED disk failure')), power=power)
            power.assert_not_called()
            self.assertFalse(read(run / 'window-close.json')['off_instance_acknowledged'])
            self.assertEqual(read(run / 'window-close.json')['experiment_status'], 'partial')

    def test_final_shutdown_still_runs_if_event_disk_full(self):
        with patch.object(day_lease, 'event', side_effect=OSError('SCRIPTED disk full')), \
             patch.object(day_lease, 'write_new', side_effect=OSError('SCRIPTED disk full')), \
             patch('shutdown_guard.shutdown_command', return_value=['SCRIPTED-NOT-A-COMMAND']), \
             patch.object(day_lease.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            result = day_lease.request_shutdown(Path('/SCRIPTED'), 'fixture only')
        run.assert_called_once()
        self.assertEqual(result['request_log_errors'], ['OSError'])
        self.assertEqual(result['provider_billing_stopped'], 'unknown')

    def trial_stop(self, *, replacement=False, orphan=False):
        target = {'pid': 777, 'start_ticks': '100', 'argv': ['SCRIPTED'], 'kernel_boot_id': 'fixture'}
        child = {**target, 'pid': 778, 'start_ticks': '101', 'argv': ['SCRIPTED CHILD']}
        tick = [0.0]
        def sleep(seconds): tick[0] += seconds
        final = {**target, 'start_ticks': '200'} if replacement else target
        if orphan:
            final = FileNotFoundError('SCRIPTED controller exited')
        with patch.object(day_lease, 'verify_live', return_value=self.lease), \
             patch.object(day_lease, 'now', return_value=aware('2026-10-14T01:59:58+00:00')), \
             patch.object(day_lease.time, 'monotonic', side_effect=lambda: tick[0]), \
             patch.object(day_lease.time, 'sleep', side_effect=sleep), \
             patch.object(day_lease, 'identity', side_effect=[target, target, final]), \
             patch.object(day_lease, 'group_members', side_effect=[{777: target, 778: child}, {778: child}]), \
             patch.object(day_lease.os, 'getpgid', return_value=777, create=True), \
             patch.object(day_lease.signal, 'SIGKILL', 9, create=True), \
             patch.object(day_lease.os, 'killpg', create=True) as kill, \
             patch.object(day_lease, 'event'):
            day_lease.trial_guard(Path('/SCRIPTED/day-lease.json'), target, self.b['hard_cutoff'])
        return kill

    def test_original_trial_process_group_stops_at_original_two_hour_limit(self):
        self.trial_stop().assert_called_once()

    def test_reused_process_id_is_never_killed(self):
        self.trial_stop(replacement=True).assert_not_called()

    def test_original_gpu_child_does_not_outlive_failed_controller(self):
        self.trial_stop(orphan=True).assert_called_once_with(777, 9)

    def test_start_requires_actual_trial_guard_armed_handshake(self):
        target = {'pid': 777, 'start_ticks': '100', 'argv': ['SCRIPTED'], 'kernel_boot_id': 'fixture'}
        with tempfile.TemporaryDirectory() as temp:
            ops = Path(temp)
            (ops / 'trial-guard-events.jsonl').write_text(json.dumps({
                'status': 'armed', 'target': target, 'deadline': 'WRONG ORIGINAL DEADLINE'}) + '\n')
            with patch.object(day_lease, 'verify_live', return_value=self.lease), \
                 patch.object(day_lease, 'identity', return_value=target), \
                 patch.object(day_lease.os, 'getpgid', return_value=777, create=True), \
                 patch.object(day_lease.subprocess, 'Popen'):
                with self.assertRaisesRegex(ValueError, 'original target/deadline'):
                    day_lease.start_trial_guard(ops, target, self.b['hard_cutoff'])
            self.assertTrue((ops / 'trial-guard-reservation.json').exists())
            self.assertFalse((ops / 'trial-guard.json').exists())

    @unittest.skipUnless(sys.platform == 'linux', 'real isolated process-group check runs on Linux CI')
    def test_linux_guard_really_terminates_only_its_isolated_child(self):
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'], start_new_session=True)
        try:
            target = day_lease.identity(child.pid)
            self.assertNotEqual(os.getpgid(child.pid), os.getpgrp())
            with tempfile.TemporaryDirectory() as temp, \
                 patch.object(day_lease, 'verify_live', return_value=self.lease), \
                 patch.object(day_lease, 'now', return_value=aware('2026-10-14T01:59:59+00:00')):
                day_lease.trial_guard(Path(temp) / 'day-lease.json', target, self.b['hard_cutoff'])
                self.assertEqual(child.wait(timeout=5), -signal.SIGKILL)
                events = [json.loads(x) for x in (Path(temp) / 'trial-guard-events.jsonl').read_text().splitlines()]
                self.assertEqual([r['status'] for r in events], ['armed', 'original_trial_group_stop_requested'])
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)

    def test_unsupported_gpu_fields_stay_unknown_and_invalid_values_rejected(self):
        row = parse_csv('0, GPU-fixture, SCRIPTED RTX 4090, 70, N/A, 1024, 24564, [Not Supported]\n')[0]
        self.assertIsNone(row['power.draw']); self.assertIsNone(row['utilization.memory'])
        with self.assertRaises(ValueError):
            parse_csv('0, GPU-fixture, SCRIPTED, 101, 20, 1, 2, 5\n')

    def test_missing_observations_are_not_counted_as_idle_or_full_coverage(self):
        rows = []
        for seconds, status, util in [(0, 'observed', 100), (5, 'unknown', None), (30, 'observed', 0)]:
            gpu = parse_csv(f'0, GPU-fixture, SCRIPTED, {util or 0}, 20, 1000, 24000, N/A\n')
            rows.append({'at_utc': (aware(self.lease['booted_at_proxy']) + timedelta(seconds=seconds)).isoformat(),
                         'kind': 'actual_nvidia_smi_observation', 'interval_seconds': 5,
                         'status': status, 'gpus': gpu if status == 'observed' else None, 'probe_wall_seconds': .1})
        end = aware(self.lease['booted_at_proxy']) + timedelta(seconds=35)
        result = analyze(self.lease, rows, observed_end=end)
        device = result['gpus']['GPU-fixture']
        self.assertAlmostEqual(device['coverage_fraction_of_lease_observed'], 10 / 35)
        self.assertEqual(device['weighted_mean_over_observed_samples']['utilization.gpu'], 50)
        self.assertIsNone(device['weighted_mean_over_observed_samples']['power.draw'])
        self.assertIsNone(result['ttft_seconds'])
        self.assertEqual(result['accounting']['activity_wall_seconds']['unclassified'], 35)

    def test_activity_overlap_cannot_double_count_cost(self):
        intervals = [{'activity': 'transfer', 'start_utc': '2026-10-14T00:00:00+00:00', 'end_utc': '2026-10-14T00:05:00+00:00'},
                     {'activity': 'restoration', 'start_utc': '2026-10-14T00:04:00+00:00', 'end_utc': '2026-10-14T00:06:00+00:00'}]
        with self.assertRaises(ValueError):
            activity_accounting(self.lease, intervals, aware('2026-10-14T00:10:00+00:00'))


if __name__ == '__main__':
    unittest.main()
