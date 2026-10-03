"""CPU faults for G2 budgets, archive handoffs, restore gating and receipt transport."""
from copy import deepcopy
from datetime import timedelta
from functools import partial
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
import g2_execution as g2
import monitor_g2 as monitor
from g2_prelaunch_guard import opening_matches, watch
from g2_receipt_transfer import receipt_fields, transfer_receipt, validate_index, validate_receipt
from run_g2_window import execute_phases, finalize, run_phase
from server_workspace import dump_new
from test_d2_execution import Clock
from test_replication_receipt_transfer import FakeSFTP, Clock as SFTPClock, REMOTE


def schema(complete=True):
    bind={'SYNTHETIC-UNIT-FIXTURE':True}
    index={'version':'g2-backup-v1','binding':bind,'evidence_kind':'scripted_contract',
           'status':'complete' if complete else 'partial','archives':[]}
    for p in (('repair_only','coverage_mix','evidence') if complete else ('repair_only','evidence')):
        index['archives'].append({'part':p,'path':('' if p=='evidence' else 'training/')+p+'.tar.gz',
                                  'archive':p+'.tar.gz','bytes':10,'sha256':'a'*64})
    receipt={**receipt_fields(index,bind,kind='scripted_contract'),'verified_files':3}
    return bind,index,receipt


class BoundaryTests(unittest.TestCase):
    def test_remote_launch_requires_g2_sources_both_guards_and_unique_flags(self):
        raw=g2.read(ROOT/'configs/g2-monitor.template.json')
        raw.update(booted_at='2026-10-02T12:00:00+00:00',execution_commit='a'*40)
        cfg=monitor.parse_config(raw);plan=g2.read(g2.EXECUTION)
        bind=g2.binding(plan,'a'*40,raw['booted_at'])
        opening={'binding':bind,'booted_at_proxy':raw['booted_at'],'budget':g2.BUDGET,
                 'evidence_kind':'model','started_at_utc':'2026-10-02T12:01:00+00:00'}
        argv=['python',f"/root/autodl-tmp/liftcut/code/{'a'*40}/research/liftcut-agent/run_g2_window.py"]
        for k,v in {'model-dir':'model','model-manifest':'manifest','prepared-dir':'prepared','diagnostic-dir':'diag',
            'd2-dir':'d2','tokenizer-dir':'tokenizer','output-dir':cfg['remote_run'],'expected-code-commit':'a'*40,
            'hourly-cny':'2.18','booted-at':raw['booted_at'],'setup-guard':cfg['remote_ops']+'/setup-guard.jsonl'}.items():
            argv.extend(['--'+k,v])
        argv.extend(['--execute','--shutdown-when-done'])
        launch={'argv':argv,'at_utc':opening['started_at_utc'],'booted_at_proxy':raw['booted_at']}
        guards=[{'status':'armed','deadline':bind['hard_cutoff']}]
        self.assertEqual(monitor.validate_remote(cfg,plan,opening,launch,guards,guards),bind)
        for mode in ('duplicate','old_guard','late'):
            bad=deepcopy(launch);other=deepcopy(guards)
            if mode=='duplicate':bad['argv'].extend(['--d2-dir','override'])
            elif mode=='old_guard':other[0]['deadline']='2026-10-02T14:00:00+00:00'
            else:bad['at_utc']='2026-10-02T12:11:00+00:00'
            with self.subTest(mode=mode),self.assertRaises((ValueError,TimeoutError)):
                monitor.validate_remote(cfg,plan,opening,bad,guards,other)

    def test_launch_limit_and_original_150_180_window(self):
        boot=g2.aware('2026-10-02T12:00:00+00:00')
        work,hard=g2.deadlines(boot.isoformat(),boot+timedelta(minutes=9))
        self.assertEqual(work,boot+timedelta(minutes=150))
        self.assertEqual(hard,boot+timedelta(minutes=180))
        with self.assertRaises(TimeoutError): g2.deadlines(boot.isoformat(),boot+timedelta(minutes=11))
        with self.assertRaises(ValueError): g2.deadlines(boot.isoformat(),boot-timedelta(seconds=1))

    def test_prelaunch_guard_rejects_old_d2_window(self):
        boot=g2.aware('2026-10-02T12:00:00+00:00')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'opening.json'
            row={'started_at_utc':boot.isoformat(),'evidence_kind':'model',
                 'binding':{'code_commit':'a'*40,'booted_at_proxy':boot.isoformat(),
                 'work_cutoff':(boot+timedelta(minutes=150)).isoformat(),'hard_cutoff':(boot+timedelta(minutes=180)).isoformat()}}
            dump_new(path,row)
            self.assertTrue(opening_matches(path,boot,'a'*40))
            row['binding']['hard_cutoff']=(boot+timedelta(minutes=120)).isoformat()
            path.write_text(json.dumps(row))
            self.assertFalse(opening_matches(path,boot,'a'*40))

    def test_g2_monitor_rejects_credentials_and_overlapping_paths(self):
        raw=g2.read(ROOT/'configs/g2-monitor.template.json')
        for key,val in (('password','SYNTHETIC'),('downloads',raw['diagnostic']),('hourly_cny',3)):
            with self.subTest(key=key),self.assertRaises(ValueError):monitor.parse_config({**raw,key:val})


class ArchiveTests(unittest.TestCase):
    def test_archive_is_registered_before_evaluation_and_failure_stops_next_arm(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);clock=Clock();seen=[]
            def runner(argv,**kwargs):
                name=argv[0];seen.append(name)
                if name=='train-repair_only': dump_new(root/'training/repair_only/SYNTHETIC.json',{'gpu_calls':0})
                else:
                    rows=[json.loads(x) for x in (root/'early-index.jsonl').read_text().splitlines()]
                    self.assertEqual([r['path'] for r in rows],['training/repair_only.tar.gz'])
                    raise subprocess.CalledProcessError(2,argv)
            with self.assertRaises(subprocess.CalledProcessError):
                execute_phases([(n,[n]) for n in ('train-repair_only','evaluate-repair_only','train-coverage_mix')],root,{},
                               clock.now()+timedelta(minutes=5),clock,phase_runner=partial(run_phase,runner=runner))
            self.assertEqual(seen,['train-repair_only','evaluate-repair_only'])
            self.assertFalse((root/'training/coverage_mix').exists())

    def test_backup_failure_still_attempts_shutdown(self):
        with tempfile.TemporaryDirectory() as tmp:
            clock,shutdowns=Clock(),[]
            with patch('run_g2_window.evidence_backup',side_effect=OSError('synthetic disk failure')):
                finalize(Path(tmp),'partial',[],{},clock.now()+timedelta(minutes=1),clock,
                         shutdown=lambda:shutdowns.append(True) or 0)
            self.assertEqual(shutdowns,[True])

    def test_restorer_failure_never_constructs_or_uploads_receipt(self):
        cfg=monitor.parse_config(g2.read(ROOT/'configs/g2-monitor.template.json'))
        with tempfile.TemporaryDirectory() as tmp:
            cfg.update(operations=Path(tmp),downloads=Path(tmp),restored=Path(tmp)/'new')
            budget=SimpleNamespace(remaining=lambda:600)
            with patch.object(monitor,'transfer_receipt') as transfer:
                with self.assertRaises(RuntimeError):
                    monitor.restore_and_publish(None,{'status':'complete'},cfg,{},budget,lambda *_a,**_k:None,
                        runner=lambda *_a,**_k:(_ for _ in ()).throw(RuntimeError('SYNTHETIC failure')))
                transfer.assert_not_called()
            self.assertFalse(list(Path(tmp).rglob('off-instance-backup.json')))


class ReceiptTests(unittest.TestCase):
    def test_scripted_receipts_cannot_be_accepted_as_real_model_evidence(self):
        bind,index,receipt=schema()
        with self.assertRaises(ValueError):validate_index(index,bind)
        checked=validate_receipt(json.dumps(receipt).encode(),index,bind,kind='scripted_contract')
        self.assertFalse(checked['model_result'])
        self.assertEqual(checked['episodes_replayed'],222)

    def test_partial_cannot_upgrade_claims_and_complete_needs_both_arms(self):
        bind,index,receipt=schema(False)
        self.assertEqual(receipt['episodes_replayed'],0)
        receipt['adapter_files_verified']=True
        with self.assertRaises(ValueError):validate_receipt(json.dumps(receipt).encode(),index,bind,kind='scripted_contract')
        bind,index,_=schema()
        index['archives'].pop(0)
        with self.assertRaises(ValueError):validate_index(index,bind,kind='scripted_contract')

    def test_receipt_readback_then_atomic_publish_and_ambiguous_rename(self):
        for fault in (None,'rename_after','close_failure'):
            clock=SFTPClock();sftp=FakeSFTP(clock,fault)
            bind,index,receipt=schema()
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'SYNTHETIC-RECEIPT.json';dump_new(path,receipt)
                result=transfer_receipt(sftp,path,REMOTE,index,bind,clock()+timedelta(minutes=5),
                                       now=clock,kind='scripted_contract')
                self.assertEqual(result['status'],{None:'published','rename_after':'unknown','close_failure':'failed'}[fault])
                self.assertEqual(result['server_acceptance'],'unknown')
                if fault is None:
                    self.assertEqual(sftp.files[REMOTE+'/off-instance-backup.json'],path.read_bytes())


if __name__=='__main__':unittest.main()
