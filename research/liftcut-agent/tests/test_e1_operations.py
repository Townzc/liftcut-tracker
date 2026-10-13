"""Real upload function exercised with in-memory SSH/SFTP; never a cloud launch or ACK."""
import ast
from contextlib import contextmanager, redirect_stdout
from datetime import timedelta
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from d2_execution import aware, read
from e1_execution import binding
from e1_receipt import fields, transfer_receipt
from liftcut_agent.interactive import digest
from monitor_coverage_replication import TimeBudget
from prepare_e1_execution import scripted_authorization
from server_workspace import dump_new
from test_d2_launcher import SFTP
from test_replication_receipt_transfer import Clock, FakeSFTP, REMOTE, FINAL
import launch_e1 as launch
import e1_power


class E1OperationTests(unittest.TestCase):
    def test_request_log_failure_does_not_skip_authorized_power_action(self):
        with patch.object(e1_power, 'write_new', side_effect=OSError('SCRIPTED disk full')), \
             patch('shutdown_guard.shutdown_command', return_value=['SCRIPTED-DO-NOT-EXECUTE']), \
             patch.object(e1_power.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            value = e1_power.shutdown(Path('/SCRIPTED'), 'unit test only')
        run.assert_called_once()
        self.assertEqual(value['returncode'], 0)
        self.assertEqual(value['provider_billing_stopped'], 'unknown')
        self.assertEqual(value['request_log_errors'], ['OSError'])

    def test_receipt_transport_faults_do_not_invent_consumption(self):
        b = {'candidate_digest': 'b' * 64, 'SCRIPTED_UNIT_ONLY': True}
        index = {'version': 'e1-delta-index-v1', 'binding': b, 'status': 'complete',
                 'evidence_kind': 'scripted_contract', 'archive_is_self_contained': False,
                 'archives': [{'path': 'evidence.tar.gz', 'archive': 'evidence.tar.gz', 'bytes': 1, 'sha256': 'c' * 64}]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'SYNTHETIC-RECEIPT.json'
            dump_new(path, {**fields(index, b, scripted=True), 'verified_files': 1})
            for fault, status in [(None, 'published'), ('half_write', 'failed'), ('silent_half_write', 'failed'),
                                  ('hash_mismatch', 'failed'), ('rename_after', 'unknown')]:
                with self.subTest(fault=fault):
                    clock = Clock(); network = FakeSFTP(clock, fault)
                    result = transfer_receipt(network, path, REMOTE, index, b,
                                              clock() + timedelta(minutes=1), now=clock, scripted=True)
                    self.assertEqual(result['status'], status)
                    self.assertEqual(result['server_acceptance'], 'unknown')
                    if status in ('published', 'unknown'):
                        self.assertEqual(network.files[FINAL], path.read_bytes())
                    else:
                        self.assertNotIn(FINAL, network.files)

    def test_disconnection_after_publication_does_not_claim_power_or_consumption(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory); dump_new(out / 'receipt-transfer.json', {'status': 'published'})
            sftp = Mock(); sftp.get_channel.return_value.get_transport.return_value.is_active.return_value = False
            with patch.object(launch, '_collect', side_effect=EOFError('SCRIPTED disconnect')):
                result = launch.collect(sftp, {'operations': out}, {}, {}, None, lambda *_a, **_k: None)
            self.assertIsNone(result['server_consumed'])
            self.assertEqual(result['provider_billing_stopped'], 'unknown')
            self.assertFalse(result['shutdown_request_observed'])

    def test_active_connection_error_is_not_mislabelled_shutdown(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory); dump_new(out / 'receipt-transfer.json', {'status': 'published'})
            sftp = Mock(); sftp.get_channel.return_value.get_transport.return_value.is_active.return_value = True
            with patch.object(launch, '_collect', side_effect=ValueError('corrupt evidence')):
                with self.assertRaises(ValueError):
                    launch.collect(sftp, {'operations': out}, {}, {}, None, lambda *_a, **_k: None)

    def transport(self, unknown=False, failed_upload=False):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            root = Path(directory); stage = root / 'stage'; stage.mkdir()
            for name in ('code.bundle', *launch.BOOTSTRAP):
                (stage / name).write_bytes(b'SCRIPTED-TRANSPORT-' + name.encode())
            start = aware('2026-10-14T00:01:00+00:00'); commit = 'a' * 40
            science = {'candidate_digest': 'b' * 64, 'dataset': {'test_file_sha256_from_existing_manifest': 'c' * 64}}
            plan = {'protocol': science, 'candidate_digest': 'b' * 64}
            spec = {'commit': commit, 'base': 'd' * 40, 'files': {p.name: {} for p in stage.iterdir()}}
            cfg = {n: root / n for n in ('known_hosts', 'restore_python', 'parent_run_local', 'parent_receipt_local',
                                       'parent_index_local', 'operations', 'downloads', 'restored', 'tokenizer')}
            cfg.update(ssh_host='synthetic.invalid', ssh_port=1234, ssh_user='root', bootstrap_python='python3',
                       remote_python='/root/autodl-tmp/liftcut/python', remote_model='/root/autodl-tmp/liftcut/model',
                       remote_model_manifest='/root/autodl-tmp/liftcut/model.json', remote_data='/root/autodl-tmp/liftcut/data/old',
                       remote_parent_run='/root/autodl-tmp/liftcut/runs/parent',
                       remote_run='/root/autodl-tmp/liftcut/runs/e1-run-20261014-000100',
                       remote_ops='/root/autodl-tmp/liftcut/runs/e1-ops-20261014-000100')
            config = root / 'config.json'; auth = root / 'SYNTHETIC-AUTH-ONLY.json'
            dump_new(config, {}); dump_new(auth, scripted_authorization())
            b = binding(plan, commit, scripted_authorization(), '20261014-000100', start.isoformat())
            opening = {'binding': b, 'at_utc': start.isoformat(), 'evidence_kind': 'model'}
            labels = []; network = SFTP(); client = Mock()
            @contextmanager
            def connection(): yield network
            client.open_sftp.side_effect = connection
            class Remote:
                def __init__(self, *_): pass
                def run(self, argv, label, **_kw):
                    labels.append(label)
                    if '-c' in argv:
                        code = argv[argv.index('-c') + 1]; compile(code, '<SCRIPTED remote>', 'exec')
                    if label == 'hash':
                        call = next(x for x in ast.walk(ast.parse(code)) if isinstance(x, ast.Call)
                                    and isinstance(x.func, ast.Name) and x.func.id == 'Path')
                        path = ast.literal_eval(call.args[0])
                        if '\\' in path: raise AssertionError('Windows path leaked into remote')
                        if failed_upload and path.endswith('code.bundle'): raise OSError('SCRIPTED upload failure')
                        return network.digest(path)
                    if label in ('arm-original-power', 'dispatch', 'abort-known-setup'):
                        supplied = json.loads(argv[argv.index('--binding-json') + 1])
                        if supplied != b: raise AssertionError('original binding changed')
                    if label == 'dispatch':
                        if unknown: raise TimeoutError('SCRIPTED unknown dispatch')
                        return json.dumps({'opening': opening, 'controller_pid': 123})
                    return '{}'
            collector = Mock(return_value={'scripted_transport_only': True})
            def budget(deadline): return TimeBudget(deadline, now=lambda: start, monotonic=lambda: 0)
            with patch.object(launch, 'ROOT', root), patch.object(launch, 'configure', return_value=cfg), \
                 patch.object(launch, 'verify_stage', return_value=spec), patch.object(launch, 'verify_plan', return_value=plan), \
                 patch.object(launch, 'verify_parent'), patch.object(launch, 'utcnow', return_value=start), \
                 patch.object(launch, 'Remote', Remote), patch.object(launch, 'TimeBudget', side_effect=budget), \
                 patch.object(launch, 'collect', collector), patch.object(launch.getpass, 'getpass', return_value='SYNTHETIC-SECRET'), \
                 patch.dict(sys.modules, {'paramiko': SimpleNamespace(SSHClient=lambda: client, RejectPolicy=lambda: object())}):
                if unknown or failed_upload:
                    with self.assertRaises((TimeoutError, OSError)):
                        launch.execute(stage, config, '20261014-000100', auth)
                else:
                    self.assertTrue(launch.execute(stage, config, '20261014-000100', auth)['scripted_transport_only'])
                with self.assertRaises(FileExistsError):
                    launch.execute(stage, config, '20261014-000101', auth)
            self.assertEqual(labels.count('arm-original-power'), 1)
            self.assertEqual(labels.count('dispatch'), 0 if failed_upload else 1)
            self.assertEqual(labels.count('abort-known-setup'), 1 if failed_upload else 0)
            self.assertLess(labels.index('arm-original-power'), labels.index('install-new-checkout') if not failed_upload else len(labels))
            client.connect.assert_called_once(); client.close.assert_called_once()
            self.assertEqual(collector.call_count, 0 if unknown or failed_upload else 1)
            for path in root.rglob('*'):
                if path.is_file(): self.assertNotIn(b'SYNTHETIC-SECRET', path.read_bytes())

    def test_full_upload_dispatch_has_one_reservation(self): self.transport()
    def test_unknown_dispatch_is_never_repeated_or_aborted(self): self.transport(unknown=True)
    def test_known_upload_failure_requests_shutdown_in_same_session(self): self.transport(failed_upload=True)


if __name__ == '__main__':
    unittest.main()
