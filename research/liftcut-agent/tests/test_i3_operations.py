"""Offline transport, deadline and evidence faults; no real model or remote ACK."""
from contextlib import contextmanager,redirect_stdout
from copy import deepcopy
from datetime import timedelta
import ast
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from d2_execution import aware,read
from i3_protocol import binding,BUDGET,validate_opening,verify_parent_files
from i3_receipt import fields,validate_receipt,transfer_receipt
from run_i3_window import finalise,reserve_followup
from monitor_coverage_replication import TimeBudget
from server_workspace import dump_new,sha256
from liftcut_agent.interactive import digest
from test_d2_launcher import SFTP
from test_replication_receipt_transfer import Clock,FakeSFTP,REMOTE,FINAL
from test_research_lease import lease
import launch_i3 as launch


def schema(status='complete'):
    b={'reference_digest':'a'*64,'SCRIPTED_UNIT_ONLY':True}
    index={'version':'i3-delta-index-v1','binding':b,'status':status,'evidence_kind':'scripted_contract',
        'archive_is_self_contained':False,'archives':[{'path':'evidence.tar.gz','archive':'evidence.tar.gz','bytes':1,'sha256':'b'*64}]}
    return b,index,{**fields(index,b,scripted=True),'verified_files':1}


class I3OperationsTests(unittest.TestCase):
    def test_original_power_and_trial_clocks_cannot_be_extended(self):
        p={'reference':{}};start='2026-10-13T08:00:00+00:00'
        b=binding(p,'a'*40,lease(),start)
        self.assertEqual(b['booted_at_proxy'],lease()['booted_at_proxy'])
        self.assertEqual(b['work_cutoff'],'2026-10-13T08:20:00+00:00')
        self.assertEqual(b['collection_cutoff'],'2026-10-13T08:40:00+00:00')
        o={'binding':b,'budget':BUDGET,'at_utc':start,'evidence_kind':'scripted_contract'}
        self.assertEqual(validate_opening(o,p,scripted=True),b)
        changed=deepcopy(o);changed['binding']['collection_cutoff']='2026-10-13T09:00:00+00:00'
        with self.assertRaises(ValueError):validate_opening(changed,p,scripted=True)
        with self.assertRaises(TimeoutError):binding(p,'a'*40,lease(),'2026-10-13T13:31:00+00:00')

    def test_ack_after_rolling_twenty_minutes_is_consumed_before_original_cutoff(self):
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory);clock=Clock();clock.value=aware('2026-10-13T08:05:00+00:00')
            b=binding({'reference':{}},'0'*40,lease(),'2026-10-13T08:00:00+00:00')
            emitted=False
            def sleep(seconds):
                nonlocal emitted
                clock.value+=timedelta(seconds=seconds)
                if not emitted and clock.value>=aware('2026-10-13T08:32:00+00:00'):
                    index=read(out/'backup-index.json')
                    dump_new(out/'off-instance-backup.json',{**fields(index,b,scripted=True),'verified_files':1})
                    emitted=True
            finalise(out,'partial',[],b,SimpleNamespace(now=clock),scripted=True,sleep=sleep,
                archive=lambda _: {'archive':'evidence.tar.gz','bytes':1,'sha256':'a'*64})
            self.assertTrue(read(out/'backup-copy-status.json')['off_instance_acknowledged'])
            self.assertEqual(read(out/'window-close.json')['shutdown_at_utc'],lease()['shutdown_at_utc'])
            self.assertFalse((out/'shutdown-request.json').exists())

    def test_missing_receipt_expires_at_original_cutoff_without_power_change(self):
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory);clock=Clock();clock.value=aware('2026-10-13T08:00:00+00:00')
            b=binding({'reference':{}},'0'*40,lease(),clock().isoformat())
            def sleep(s):clock.value+=timedelta(seconds=s)
            finalise(out,'partial',[],b,SimpleNamespace(now=clock),scripted=True,sleep=sleep,
                archive=lambda _: {'archive':'evidence.tar.gz','bytes':1,'sha256':'a'*64})
            self.assertEqual(clock(),aware(b['collection_cutoff'])-timedelta(seconds=10))
            self.assertFalse(read(out/'backup-copy-status.json')['off_instance_acknowledged'])
            self.assertEqual(read(out/'window-close.json')['power_action'],'retain_under_original_overnight_guard')

    def test_scripted_partial_cannot_become_real_complete_receipt(self):
        for status in ('partial','complete'):
            b,index,r=schema(status)
            self.assertFalse(validate_receipt(json.dumps(r),index,b,scripted=True)['model_result'])
            with self.assertRaises(ValueError):validate_receipt(json.dumps(r),index,b)
            for key in ('model_result','actual_external_weight_verified','complete_study_replayed','archive_is_self_contained'):
                with self.assertRaises(ValueError):validate_receipt(json.dumps({**r,key:not r[key]}),index,b,scripted=True)
            with self.assertRaises(ValueError):validate_receipt(json.dumps({**r,'episodes_replayed':True}),index,b,scripted=True)

    def test_atomic_transfer_records_unknown_rename_without_retry(self):
        b,index,r=schema()
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'SCRIPTED.json';path.write_text(json.dumps(r))
            for fault,status in [(None,'published'),('half_write','failed'),('silent_half_write','failed'),
                                 ('hash_mismatch','failed'),('rename_after','unknown')]:
                clock=Clock();network=FakeSFTP(clock,fault)
                result=transfer_receipt(network,path,REMOTE,index,b,clock()+timedelta(minutes=1),now=clock,scripted=True)
                self.assertEqual(result['status'],status);self.assertEqual(result['server_acceptance'],'unknown')
                if status in ('published','unknown'):self.assertEqual(network.files[FINAL],path.read_bytes())
                else:self.assertNotIn(FINAL,network.files)

    def test_missing_parent_weight_never_passes_on_matching_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name in ('comparison.json','off-instance-backup.json','backup-index.json'):dump_new(root/name,{'SCRIPTED':True})
            ref={'parent_receipt_sha256':sha256(root/'off-instance-backup.json'),
                 'parent_index_digest':digest(read(root/'backup-index.json')),
                 'parent_comparison_digest':digest(read(root/'comparison.json')),
                 'checkpoint':read(ROOT/'reports/i2-reference-v1.json')['checkpoint']}
            with self.assertRaises((ValueError,FileNotFoundError)):verify_parent_files(root,ref)

    def test_persistent_family_and_two_slots_reject_unknown_relaunch(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.assertEqual(reserve_followup(root,'i3',{'SCRIPTED':1},2),0)
            with self.assertRaises(FileExistsError):reserve_followup(root,'i3',{'SCRIPTED':2},2)
            self.assertEqual(reserve_followup(root,'i4',{'SCRIPTED':3},2),1)
            with self.assertRaises(ValueError):reserve_followup(root,'extra',{'SCRIPTED':4},2)
            self.assertEqual(read(root/'i3.json'),{'SCRIPTED':1})

    def test_actual_config_parser_accepts_only_complete_path_extensions(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            raw={k:str(root) for k in ('known_hosts','restore_python','diagnostic','d2','tokenizer',
                  'parent_run_local','parent_receipt_local','parent_index_local')}
            raw.update(ssh_host='synthetic.invalid',ssh_port=1234,ssh_user='root',bootstrap_python='python3')
            raw.update({k:'/root/autodl-tmp/liftcut/'+k for k in ('remote_python','remote_model','remote_model_manifest','remote_parent_run','remote_data')})
            cfg=launch.configure(raw,'20261013-080000')
            self.assertEqual(cfg['remote_parent_run'],raw['remote_parent_run'])
            self.assertEqual(cfg['parent_receipt_local'],root.resolve())
            for key,value in [('password','secret'),('remote_data','/tmp/escape')]:
                with self.assertRaises(ValueError):launch.configure({**raw,key:value},'20261013-080000')

    def transport(self,unknown=False):
        with tempfile.TemporaryDirectory() as directory,redirect_stdout(io.StringIO()):
            root=Path(directory);stage=root/'stage';stage.mkdir()
            for n in ('code.bundle','d2_bundle.py'):(stage/n).write_bytes(b'SCRIPTED-TRANSPORT-'+n.encode())
            start=aware('2026-10-13T08:00:00+00:00');p={'reference':{}};commit='a'*40
            spec={'commit':commit,'power_lease':lease(),'files':{p.name:{} for p in stage.iterdir()}}
            cfg={n:root/n for n in ('known_hosts','restore_python','parent_run_local','parent_receipt_local','parent_index_local',
                                  'operations','downloads','restored','d2','tokenizer')}
            cfg.update(ssh_host='synthetic.invalid',ssh_port=1234,ssh_user='root',bootstrap_python='python3',
                remote_python='/root/autodl-tmp/liftcut/python',remote_model='/root/autodl-tmp/liftcut/model',
                remote_model_manifest='/root/autodl-tmp/liftcut/model.json',remote_data='/root/autodl-tmp/liftcut/data/old',
                remote_parent_run='/root/autodl-tmp/liftcut/runs/parent',remote_run='/root/autodl-tmp/liftcut/runs/i3-run-20261013-080000',
                remote_ops='/root/autodl-tmp/liftcut/runs/i3-ops-20261013-080000')
            config=root/'config.json';dump_new(config,{})
            opening={'binding':binding(p,commit,lease(),start.isoformat()),'at_utc':start.isoformat(),'budget':BUDGET,'evidence_kind':'model'}
            labels=[];network=SFTP();client=Mock()
            @contextmanager
            def connection():yield network
            client.open_sftp.side_effect=connection
            class Remote:
                def __init__(self,*a):pass
                def run(self,argv,label,**kw):
                    labels.append(label)
                    if '-c' in argv:
                        code=argv[argv.index('-c')+1];compile(code,'<SCRIPTED transport>','exec')
                    if label=='hash':
                        call=next(x for x in ast.walk(ast.parse(code)) if isinstance(x,ast.Call) and isinstance(x.func,ast.Name) and x.func.id=='Path')
                        return network.digest(ast.literal_eval(call.args[0]))
                    if label=='dispatch':
                        if unknown:raise TimeoutError('SCRIPTED unknown outcome')
                        return json.dumps({'opening':opening,'controller_pid':123})
                    return '{}'
            collector=Mock(return_value={'scripted_transport_only':True})
            def budget(deadline):return TimeBudget(deadline,now=lambda:start,monotonic=lambda:0)
            with patch.object(launch,'ROOT',root),patch.object(launch,'configure',return_value=cfg), \
                 patch.object(launch,'verify_stage',return_value=spec),patch.object(launch,'verify_plan',return_value=p), \
                 patch.object(launch,'verify_parent_files'),patch.object(launch,'utcnow',return_value=start), \
                 patch.object(launch,'Remote',Remote),patch.object(launch,'TimeBudget',side_effect=budget), \
                 patch.object(launch,'collect',collector),patch.object(launch.getpass,'getpass',return_value='SCRIPTED-NOT-SECRET'), \
                 patch.dict(sys.modules,{'paramiko':SimpleNamespace(SSHClient=lambda:client,RejectPolicy=lambda:object())}):
                if unknown:
                    with self.assertRaises(TimeoutError):launch.execute(stage,config,'20261013-080000',Path('/original/lease.json'))
                else:self.assertTrue(launch.execute(stage,config,'20261013-080000',Path('/original/lease.json'))['scripted_transport_only'])
                with self.assertRaises(FileExistsError):launch.execute(stage,config,'20261013-080000',Path('/original/lease.json'))
            self.assertEqual(labels.count('dispatch'),1);self.assertEqual(labels.count('hash'),2)
            self.assertLess(labels.index('hash'),labels.index('install-new-checkout'))
            client.connect.assert_called_once();client.close.assert_called_once()
            self.assertEqual(collector.call_count,0 if unknown else 1)
            events=[json.loads(x) for x in (cfg['operations']/'events.jsonl').read_text().splitlines()]
            self.assertEqual({e['name'] for e in events if e['event']=='staged_file_verified'},set(spec['files']))
            for path in root.rglob('*'):
                if path.is_file():self.assertNotIn(b'SCRIPTED-NOT-SECRET',path.read_bytes())

    def test_real_upload_and_dispatch_sequence(self):self.transport()
    def test_unknown_dispatch_is_not_repeated(self):self.transport(unknown=True)


if __name__=='__main__':unittest.main()
