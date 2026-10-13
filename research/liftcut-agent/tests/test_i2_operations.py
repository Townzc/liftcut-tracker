"""Real failure boundaries: original lease, partial restore, unsafe assets and unknown dispatch."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import timedelta
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from d2_execution import aware
from drill_d2_execution import ScriptClock
from i2_assets import install_assets
from i2_protocol import BUDGET, binding, deadlines, validate_opening
from i2_receipt_transfer import receipt_fields, transfer_receipt, validate_receipt
from run_i2_window import finalize, phases
from test_replication_receipt_transfer import Clock, FakeSFTP, REMOTE, FINAL
import i2_setup
import launch_i2 as launcher


def schema(status='complete'):
    bind={'SCRIPTED_UNIT_ONLY':True}
    index={'version':'i2-backup-v1','binding':bind,'evidence_kind':'scripted_contract','status':status,
           'archives':[{'archive':'evidence.tar.gz','path':'evidence.tar.gz','bytes':10,'sha256':'a'*64}]}
    return bind,index,{**receipt_fields(index,bind,kind='scripted_contract'),'verified_files':1}


class OperationsTests(unittest.TestCase):
    def test_actual_opening_controls_every_deadline(self):
        boot,start='2026-10-12T10:00:00+00:00','2026-10-12T10:07:00+00:00'
        work,collect,hard=deadlines(boot,start,aware(start))
        self.assertEqual((work-aware(start)).total_seconds(),3600)
        self.assertEqual((collect-work).total_seconds(),1200)
        self.assertEqual((hard-aware(boot)).total_seconds(),5400)
        for bad_start,now in [('2026-10-12T10:11:00+00:00','2026-10-12T10:11:00+00:00'),
                              (start,'2026-10-12T10:09:00+00:00')]:
            with self.assertRaises(TimeoutError):deadlines(boot,bad_start,aware(now))
        with self.assertRaises(ValueError):deadlines(start,boot,aware(start))
        with self.assertRaises(ValueError):deadlines(boot,start,aware(start).replace(tzinfo=None))
        plan={'reference':{}}
        b=binding(plan,'a'*40,boot,start)
        opening={'binding':b,'budget':BUDGET,'booted_at_proxy':boot,'trial_started_at_utc':start,
                 'started_at_utc':start,'evidence_kind':'model'}
        self.assertEqual(validate_opening(opening,plan),b)
        changed=deepcopy(opening);changed['binding']['hard_cutoff']='2026-10-12T12:00:00+00:00'
        with self.assertRaises(ValueError):validate_opening(changed,plan)

    def test_partial_and_scripted_receipts_cannot_become_real_complete_evidence(self):
        for status in ('complete','partial'):
            b,index,r=schema(status)
            checked=validate_receipt(json.dumps(r),index,b,kind='scripted_contract')
            self.assertEqual(checked['episodes_replayed'],444 if status=='complete' else 0)
            self.assertFalse(checked['model_result'])
            for field in ('model_result','complete_study_replayed','adapter_files_verified','inverse_evidence_mapping_verified'):
                with self.assertRaises(ValueError):validate_receipt(json.dumps({**r,field:not r[field]}),index,b,kind='scripted_contract')
            with self.assertRaises(ValueError):validate_receipt(json.dumps(r),index,b)

    def test_atomic_receipt_faults_preserve_unknown_outcome(self):
        b,index,r=schema()
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'SCRIPTED.json';p.write_text(json.dumps(r))
            for fault,outcome in [(None,'published'),('half_write','failed'),('silent_half_write','failed'),
                                  ('hash_mismatch','failed'),('rename_after','unknown')]:
                clock=Clock();sftp=FakeSFTP(clock,fault)
                result=transfer_receipt(sftp,p,REMOTE,index,b,clock()+timedelta(minutes=5),now=clock,kind='scripted_contract')
                self.assertEqual(result['status'],outcome);self.assertEqual(result['server_acceptance'],'unknown')
                if fault in (None,'rename_after'):self.assertEqual(sftp.files[FINAL],p.read_bytes())
                else:self.assertNotIn(FINAL,sftp.files)

    def test_backup_failure_and_missing_receipt_still_request_shutdown_once(self):
        commands=phases(*(Path('unused') for _ in range(6)),'a'*40)
        self.assertEqual([n for n,_ in commands],['evaluate-A','evaluate-B','evaluate-C','evaluate-D','audit'])
        for broken in (False,True):
            with tempfile.TemporaryDirectory() as directory:
                clock=ScriptClock();clock.value=aware('2026-10-12T10:00:00+00:00')
                calls=[]
                def sleep(s):clock.value+=timedelta(seconds=s)
                def shutdown():calls.append(1);return 0
                def archive(_):
                    if broken:raise OSError('SCRIPTED disk failure')
                    return {'archive':'evidence.tar.gz','bytes':1,'sha256':'a'*64}
                finalize(Path(directory),'partial',[],{'hard_cutoff':(clock.now()+timedelta(minutes=1)).isoformat()},
                         clock.now()+timedelta(seconds=35),clock,sleep=sleep,shutdown=shutdown,archive=archive)
                self.assertEqual(calls,[1])
                returned=json.loads((Path(directory)/'shutdown-request.json').read_text())
                self.assertEqual(returned['provider_billing_stopped'],'unknown')
                self.assertFalse(returned['provider_power_state_verified'])

    def test_asset_manifest_rejects_traversal_links_duplicates_and_changed_bytes(self):
        for variant in ('ok','parent','absolute','windows','symlink','duplicate','hash'):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);name={'parent':'../escape','absolute':'/escape','windows':'a\\b'}.get(variant,'data/example')
                blob=b'fixed';item=tarfile.TarInfo(name);item.size=len(blob)
                if variant=='symlink':item.type=tarfile.SYMTYPE;item.linkname='/escape';item.size=0
                with tarfile.open(root/'a.tgz','w:gz') as tar:
                    tar.addfile(item,io.BytesIO(blob))
                    if variant=='duplicate':tar.addfile(item,io.BytesIO(blob))
                index={name:{'bytes':item.size,'sha256':hashlib.sha256(blob).hexdigest() if variant!='hash' else 'f'*64}}
                if variant=='ok':self.assertEqual(install_assets(root/'a.tgz',index,root/'out')['verified_files'],1)
                else:
                    with self.assertRaises(ValueError):install_assets(root/'a.tgz',index,root/'out')

    def test_guard_requires_original_pid_start_time_arguments_and_deadline(self):
        hard='2026-10-12T11:30:00+00:00';identity={'pid':123,'argv':['python','shutdown_guard.py'],'start_ticks':'100'}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'guard.json'
            path.write_text(json.dumps({'version':'i2-setup-guard-v1','hard_cutoff':hard,'identity':identity,'argv':identity['argv']}))
            path.with_name('setup-guard.jsonl').write_text(json.dumps({'status':'armed','deadline':hard})+'\n')
            with patch.object(i2_setup,'identity',return_value=identity):self.assertEqual(i2_setup.verify_guard(path,hard)['identity'],identity)
            with patch.object(i2_setup,'identity',return_value={**identity,'start_ticks':'101'}):
                with self.assertRaises(ValueError):i2_setup.verify_guard(path,hard)
            with self.assertRaises(ValueError):i2_setup.verify_guard(path,'2026-10-12T12:00:00+00:00')

    def test_unknown_dispatch_never_retries_or_spawns_another_collector(self):
        self.assertIsInstance(launcher.PERSIST,PurePosixPath)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);stage=root/'stage';stage.mkdir();config=root/'config.json';config.write_text('{}')
            start='2026-10-12T10:00:00+00:00';commit='a'*40;labels=[]
            cfg={k:root/k for k in ('diagnostic','d2','tokenizer','restore_python','known_hosts')}
            cfg.update(ssh_host='unit.invalid',ssh_port=22,ssh_user='root',bootstrap_python='python3',
                remote_python='/root/autodl-tmp/liftcut/envs/python',remote_model='/root/autodl-tmp/liftcut/model',
                remote_model_manifest='/root/autodl-tmp/liftcut/model.json')
            client=Mock();sftp=Mock()
            @contextmanager
            def channel():yield sftp
            client.open_sftp.side_effect=channel
            class Remote:
                def __init__(self,*_):pass
                def run(self,argv,label,**_):
                    labels.append(label)
                    if '-c' in argv:compile(argv[argv.index('-c')+1],'<remote>','exec')
                    if label=='dispatch':raise TimeoutError('SCRIPTED unknown outcome')
                    return '{}'
            class Budget:
                def __init__(self,deadline):self.deadline=deadline
                def check(self):pass
                def remaining(self):return 600
            with patch.object(launcher,'ROOT',root),patch.object(launcher,'parse_config',return_value=cfg), \
                 patch.object(launcher,'verify_stage',return_value=({}, {'commit':commit,'files':{}})), \
                 patch.object(launcher,'utcnow',return_value=aware(start)),patch.object(launcher,'Remote',Remote), \
                 patch.object(launcher,'TimeBudget',Budget), \
                 patch.object(launcher.subprocess,'run'),patch.object(launcher,'upload_verified'), \
                 patch.object(launcher,'collect') as collect,patch.object(launcher.getpass,'getpass',return_value='SCRIPTED-SECRET'), \
                 patch.dict(sys.modules,{'paramiko':SimpleNamespace(SSHClient=lambda:client,RejectPolicy=lambda:object())}):
                with self.assertRaises(TimeoutError):launcher.execute(stage,config,'20261012-100000',start)
                collect.assert_not_called()
            self.assertEqual(labels.count('dispatch'),1)
            self.assertNotIn('setup-abort-shutdown',labels)
            client.connect.assert_called_once();client.close.assert_called_once()
            for path in root.rglob('*'):
                if path.is_file():self.assertNotIn(b'SCRIPTED-SECRET',path.read_bytes())


if __name__=='__main__':unittest.main()
