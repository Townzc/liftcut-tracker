"""Synthetic operating faults; no real model, server connection or ACK."""
from contextlib import contextmanager
from datetime import timedelta
import json
from pathlib import Path, PurePosixPath
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from drill_d2_execution import ScriptClock
from i1_protocol import BUDGET, aware, binding
from i1_receipt_transfer import receipt_fields, transfer_receipt, validate_index, validate_receipt
from run_i1_window import finalize, phases
from test_replication_receipt_transfer import Clock, FakeSFTP, REMOTE, FINAL
import launch_i1_overnight as launcher


def schema(status='complete'):
    bind = {'SYNTHETIC_UNIT_ONLY': True}
    index = {'version': 'i1-backup-v1', 'binding': bind, 'evidence_kind': 'scripted_contract',
        'status': status, 'archives': [{'archive': 'evidence.tar.gz', 'path': 'evidence.tar.gz',
                                      'bytes': 10, 'sha256': 'a' * 64}]}
    receipt = {**receipt_fields(index, bind, kind='scripted_contract'), 'verified_files': 1}
    return bind, index, receipt


class I1OperationsTests(unittest.TestCase):
    def test_partial_scripted_or_wrong_scope_never_claims_real_complete_results(self):
        for status in ('complete', 'partial'):
            bind, index, receipt = schema(status)
            result = validate_receipt(json.dumps(receipt), index, bind, kind='scripted_contract')
            self.assertFalse(result['model_result'])
            self.assertEqual(result['episodes_replayed'], 222 if status == 'complete' else 0)
            with self.assertRaises(ValueError):
                validate_receipt(json.dumps(receipt), index, bind)
            with self.assertRaises(ValueError):
                validate_receipt(json.dumps({**receipt, 'model_result': True}), index, bind, kind='scripted_contract')
            with self.assertRaises(ValueError):
                validate_receipt(json.dumps({**receipt, 'projection_inputs_verified': status != 'complete'}),
                                 index, bind, kind='scripted_contract')
            with self.assertRaises(ValueError):
                validate_index({**index, 'archives': index['archives'] * 2}, bind, kind='scripted_contract')

    def test_receipt_transport_retains_readback_rename_and_unknown_outcome_boundaries(self):
        bind, index, receipt = schema()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'SYNTHETIC-receipt.json'
            path.write_text(json.dumps(receipt), encoding='utf-8')
            for fault, outcome in [(None, 'published'), ('half_write', 'failed'), ('silent_half_write', 'failed'),
                                   ('hash_mismatch', 'failed'), ('rename_after', 'unknown')]:
                clock = Clock()
                sftp = FakeSFTP(clock, fault)
                result = transfer_receipt(sftp, path, REMOTE, index, bind, clock() + timedelta(minutes=5),
                                          now=clock, kind='scripted_contract')
                self.assertEqual(result['status'], outcome)
                self.assertEqual(result['server_acceptance'], 'unknown')
                if fault in (None, 'rename_after'):
                    self.assertEqual(sftp.files[FINAL], path.read_bytes())
                else:
                    self.assertNotIn(FINAL, sftp.files)

    def test_phases_are_inference_only_and_finish_retains_the_original_power_guard(self):
        commands = phases(*(Path('placeholder') for _ in range(6)), 'a' * 40)
        self.assertEqual([n for n, _ in commands], ['evaluate-raw', 'evaluate-view', 'audit'])
        self.assertFalse(any('gpu_train_' in x for _, argv in commands for x in argv))
        clock = ScriptClock()
        clock.value = aware('2026-10-03T11:00:00+00:00')
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            with patch('run_i1_window.evidence_backup', return_value={
                    'archive': 'evidence.tar.gz', 'bytes': 1, 'sha256': 'a' * 64}):
                finalize(out, 'partial', [{'reason': 'unit-timeout'}], {},
                         clock.now() + timedelta(seconds=20), clock)
            status = json.loads((out / 'backup-copy-status.json').read_text())
            self.assertFalse(status['provider_billing_stopped'])
            self.assertFalse(status['off_instance_acknowledged'])
            self.assertEqual(status['power_deadline'], BUDGET['power_deadline'])
            self.assertFalse((out / 'shutdown-request.json').exists())

    def test_single_dispatch_has_posix_paths_and_no_automatic_retry_after_unknown_result(self):
        self.assertIsInstance(launcher.PERSIST, PurePosixPath)
        self.assertIsInstance(launcher.G4_RUN, PurePosixPath)
        for fail_dispatch in (False, True):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                stage = root / 'stage'
                stage.mkdir()
                commit, start = 'a' * 40, '2026-10-03T10:00:00+00:00'
                plan = {'reference': {}, 'lease_configuration_digest': 'x'}
                bind = binding(plan, commit, start)
                cfg = {k: str(root / k) for k in ('diagnostic', 'd2', 'tokenizer', 'restore_python', 'known_hosts')}
                cfg.update(ssh_host='unit.invalid', ssh_port=22, ssh_user='root')
                config = root / 'config.json'
                config.write_text(json.dumps(cfg))
                (stage / 'stage.json').write_text(json.dumps({'commit': commit, 'base': launcher.BASE,
                    'files': {}, 'execution_plan_sha256': 'unit-sha'}))
                opening = {'binding': bind, 'trial_started_at_utc': start, 'started_at_utc': start,
                    'budget': BUDGET, 'booted_at_proxy': BUDGET['instance_boot'], 'evidence_kind': 'model',
                    'lease_configuration_digest': 'x'}
                labels, client, sftp = [], Mock(), Mock()
                @contextmanager
                def channel():
                    yield sftp
                client.open_sftp.side_effect = channel
                outer = self
                class Remote:
                    def __init__(self, *_):
                        pass
                    def run(self, argv, label, **_):
                        labels.append(label)
                        outer.assertEqual(argv[0], '/root/autodl-tmp/liftcut/envs/qwen-pilot-py312/bin/python')
                        if '-c' in argv:
                            compile(argv[argv.index('-c') + 1], '<remote>', 'exec')
                        if label == 'dispatch':
                            outer.assertEqual(argv[1], '/root/autodl-tmp/liftcut/code/' + commit + '/research/liftcut-agent/launch_i1_overnight.py')
                            if fail_dispatch:
                                raise TimeoutError('SYNTHETIC unknown dispatch result')
                            return json.dumps({'pid': 123, 'trial_started_at_utc': start})
                        return 'verified'
                class Budget:
                    def __init__(self, end):
                        self.deadline = end
                    def check(self):
                        pass
                    def remaining(self):
                        return 600
                with patch.object(launcher, 'ROOT', root), patch.object(launcher, 'verify_plan', return_value=plan), \
                     patch.object(launcher, 'sha256', return_value='unit-sha'), patch.object(launcher.subprocess, 'run'), \
                     patch.object(launcher, 'utcnow', return_value=aware(start)), patch.object(launcher, 'TimeBudget', Budget), \
                     patch.object(launcher, 'Remote', Remote), patch.object(launcher, 'remote_bytes', return_value=json.dumps(opening).encode()), \
                     patch.object(launcher, 'collect', return_value={'scripted': True}) as collector, \
                     patch.object(launcher.getpass, 'getpass', return_value='SYNTHETIC-SECRET'), \
                     patch.dict(sys.modules, {'paramiko': SimpleNamespace(SSHClient=lambda: client, RejectPolicy=lambda: object())}):
                    if fail_dispatch:
                        with self.assertRaises(TimeoutError):
                            launcher.execute(stage, config, '20261003-100000')
                        collector.assert_not_called()
                    else:
                        self.assertTrue(launcher.execute(stage, config, '20261003-100000')['scripted'])
                        collector.assert_called_once()
                self.assertEqual(labels, ['install-code', 'dispatch'])
                client.connect.assert_called_once()
                client.close.assert_called_once()
                for path in (root / 'outputs').rglob('*'):
                    if path.is_file():
                        self.assertNotIn(b'SYNTHETIC-SECRET', path.read_bytes())


if __name__ == '__main__':
    unittest.main()
