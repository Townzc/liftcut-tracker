import hashlib
import io
import json
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from unittest.mock import Mock
from contextlib import contextmanager
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from g4_execution import deadlines,aware,BUDGET,binding,validate_opening
from g4_receipt_transfer import validate_index,validate_receipt,receipt_fields
from launch_g4_overnight import download,install_assets,active_workers
from monitor_coverage_replication import TimeBudget
from run_g4_window import finalize
from drill_d2_execution import ScriptClock
import launch_g4_overnight as launcher


class Stream(io.BytesIO):
    def __init__(self,data,truncated=False):super().__init__(data);self.blocks=[];self.truncated=truncated
    def readv(self,chunks):
        self.blocks.append(chunks)
        for offset,size in chunks:
            self.seek(offset);yield self.read(size-1 if self.truncated else size)


class SFTP:
    def __init__(self,stream):self.stream=stream
    def lstat(self,_):return type('Info',(),{'st_mode':stat.S_IFREG,'st_size':len(self.stream.getvalue())})()
    def open(self,*_):return self.stream


class G4Tests(unittest.TestCase):
    def test_remote_paths_are_posix_on_windows_and_linux(self):
        from pathlib import PurePosixPath
        self.assertIsInstance(launcher.PERSIST,PurePosixPath)
        self.assertEqual(launcher.PYTHON,'/root/autodl-tmp/liftcut/envs/qwen-pilot-py312/bin/python')
        self.assertEqual(str(launcher.PERSIST/'staging/g4-example'),'/root/autodl-tmp/liftcut/staging/g4-example')

    def test_deadlines_keep_boot_and_hard_boundary(self):
        start='2026-10-03T08:10:00+00:00'
        work,collect=deadlines(start,aware(start))
        self.assertEqual(work.isoformat(),'2026-10-03T10:10:00+00:00')
        self.assertEqual(collect.isoformat(),'2026-10-03T10:55:00+00:00')
        bind=binding({},'a'*40,start)
        self.assertEqual(bind['booted_at_proxy'],BUDGET['instance_boot'])
        self.assertEqual(bind['hard_cutoff'],BUDGET['power_deadline'])
        for now in ('2026-10-03T10:11:00+00:00','2026-10-03T13:00:00+00:00'):
            with self.assertRaises(TimeoutError):deadlines(now,aware(now))
        with self.assertRaises(TimeoutError):deadlines(start,aware('2026-10-03T08:11:01+00:00'))

    def test_opening_rejects_boot_reset_and_scripted_model_mix(self):
        start='2026-10-03T08:00:00+00:00';plan={'lease_configuration_digest':'x'}
        opening={'binding':binding(plan,'a'*40,start),'trial_started_at_utc':start,'started_at_utc':start,
                 'budget':BUDGET,'booted_at_proxy':BUDGET['instance_boot'],'evidence_kind':'model','lease_configuration_digest':'x'}
        validate_opening(opening,plan)
        with self.assertRaises(ValueError):validate_opening({**opening,'booted_at_proxy':start},plan)
        with self.assertRaises(ValueError):validate_opening({**opening,'evidence_kind':'scripted_contract'},plan)

    def test_pipeline_download_bounds_and_partial_preservation(self):
        data=b'abcdefgh'*100000;item={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        for truncated,checksum_failure in ((False,False),(True,False),(False,True)):
            with tempfile.TemporaryDirectory() as directory:
                stream=Stream(data,truncated);sftp=SFTP(stream);cfg={'downloads':Path(directory),'remote_run':'/root/run'}
                use={**item,'sha256':'0'*64} if checksum_failure else item
                with patch('launch_g4_overnight.io_budget'):
                    if truncated or checksum_failure:
                        with self.assertRaises(ValueError):download(sftp,'training/control.tar.gz',use,cfg,TimeBudget(aware('2099-01-01T00:00:00Z')),lambda *_a,**_k:None)
                        self.assertFalse((Path(directory)/'control.tar.gz').exists())
                        self.assertEqual(len(list(Path(directory).glob('*.partial'))),1)
                    else:
                        output=download(sftp,'training/control.tar.gz',use,cfg,TimeBudget(aware('2099-01-01T00:00:00Z')),lambda *_a,**_k:None)
                        self.assertEqual(output.read_bytes(),data)
                self.assertTrue(all(len(x)<=8 and all(n<=65536 for _,n in x) for x in stream.blocks))

    def test_assets_reject_traversal_and_links(self):
        for name,kind in (('../escape',tarfile.REGTYPE),('link',tarfile.SYMTYPE)):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);archive=root/'assets.tar.gz';data=b'a'
                with tarfile.open(archive,'w:gz') as tar:
                    member=tarfile.TarInfo(name);member.size=1;member.type=kind
                    tar.addfile(member,io.BytesIO(data))
                with self.assertRaises(ValueError):install_assets(archive,{name:{'bytes':1,'sha256':hashlib.sha256(data).hexdigest()}},root/'out')
                self.assertFalse((root/'escape').exists())

    def test_partial_never_claims_full_replay(self):
        index={'version':'g4-backup-v1','binding':{},'evidence_kind':'model','status':'partial','archives':[
            {'part':'evidence','archive':'evidence.tar.gz','path':'evidence.tar.gz','bytes':5,'sha256':'a'*64}]}
        r={**receipt_fields(index,{}),'verified_files':1}
        self.assertFalse(validate_receipt(json.dumps(r),index,{})['complete_study_replayed'])
        with self.assertRaises(ValueError):validate_receipt(json.dumps({**r,'episodes_replayed':222}),index,{})
        with self.assertRaises(ValueError):validate_index({**index,'status':'complete'}, {})

    def test_finished_trial_retains_power_guard(self):
        clock=ScriptClock();clock.value=aware('2026-10-03T10:00:00Z')
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory)
            with patch('run_g4_window.evidence_backup',return_value={'archive':'evidence.tar.gz','bytes':1,'sha256':'a'*64}):
                finalize(out,'partial',[{'reason':'timeout'}],{},aware('2026-10-03T10:01:00Z'),clock,grace_seconds=0)
            status=json.loads((out/'backup-copy-status.json').read_text())
            self.assertFalse(status['provider_billing_stopped'])
            self.assertEqual(status['power_deadline'],BUDGET['power_deadline'])
            self.assertFalse((out/'shutdown-request.json').exists())

    def test_dispatch_bootstrap_compiles_and_connects_only_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);stage=root/'stage';stage.mkdir()
            commit='a'*40;start='2026-10-03T08:00:00+00:00'
            plan={'lease_configuration_digest':'x'};bind=binding(plan,commit,start)
            cfg={k:str(root/k) for k in ('prepared','diagnostic','d2','tokenizer','restore_python','known_hosts')}
            cfg.update(ssh_host='test.invalid',ssh_port=22,ssh_user='root')
            config=root/'config.json';config.write_text(json.dumps(cfg))
            (stage/'stage.json').write_text(json.dumps({'commit':commit,'files':{},'execution_plan_sha256':launcher.sha256(launcher.EXECUTION)}))
            opening={'binding':bind,'trial_started_at_utc':start,'started_at_utc':start,'budget':BUDGET,
                     'booted_at_proxy':BUDGET['instance_boot'],'evidence_kind':'model','lease_configuration_digest':'x'}
            labels=[];compiled=[];client=Mock();sftp=Mock()
            @contextmanager
            def channel():yield sftp
            client.open_sftp.side_effect=channel
            class Remote:
                def __init__(self,*_):pass
                def run(self,argv,label,**_):
                    labels.append(label)
                    self_outer.assertEqual(argv[0],'/root/autodl-tmp/liftcut/envs/qwen-pilot-py312/bin/python')
                    if label=='dispatch':
                        self_outer.assertEqual(argv[1],'/root/autodl-tmp/liftcut/code/'+commit+'/research/liftcut-agent/launch_g4_overnight.py')
                    if '-c' in argv:compiled.append(compile(argv[argv.index('-c')+1],'<remote>','exec'))
                    if label=='dispatch':return json.dumps({'pid':123,'trial_started_at_utc':start})
                    return 'verified'
            class Budget:
                def __init__(self,end):self.deadline=end
                def check(self):pass
                def remaining(self):return 600
            self_outer=self
            with patch.object(launcher,'ROOT',root),patch.object(launcher,'verify_plan',return_value=plan),\
                 patch.object(launcher.subprocess,'run'),patch.object(launcher,'utcnow',return_value=aware(start)),\
                 patch.object(launcher,'TimeBudget',Budget),patch.object(launcher,'Remote',Remote),\
                 patch.object(launcher,'remote_bytes',return_value=json.dumps(opening).encode()),\
                 patch.object(launcher,'collect',return_value={'scripted_contract':True}) as collector,\
                 patch.object(launcher.getpass,'getpass',return_value='SYNTHETIC-SECRET'),\
                 patch.dict(sys.modules,{'paramiko':SimpleNamespace(SSHClient=lambda:client,RejectPolicy=lambda:object())}):
                result=launcher.execute(stage,config,'20261003-080000')
            self.assertTrue(result['scripted_contract']);self.assertEqual(len(compiled),2)
            self.assertEqual(labels,['install-code','install-data','dispatch'])
            client.connect.assert_called_once();client.close.assert_called_once();collector.assert_called_once()
            for path in (root/'outputs').rglob('*'):
                if path.is_file():self.assertNotIn(b'SYNTHETIC-SECRET',path.read_bytes())


if __name__=='__main__':unittest.main()
