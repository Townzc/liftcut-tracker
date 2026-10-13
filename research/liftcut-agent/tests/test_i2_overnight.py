from copy import deepcopy
from contextlib import contextmanager, redirect_stdout
from datetime import timedelta
import ast
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from i2_protocol import binding,deadlines,validate_opening,BUDGET,aware
from launch_i2_overnight import science_unchanged
from run_i2_window import finalize
from drill_d2_execution import ScriptClock
from test_research_lease import lease
from test_d2_launcher import SFTP
import launch_i2_overnight as launch


class OvernightTests(unittest.TestCase):
    def test_full_transport_uploads_and_verifies_before_one_dispatch(self):
        # Exercise the real transport helper and event writer together. The first
        # real launch stopped because both used a keyword named `name`.
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            root=Path(directory);(root/'outputs/autodl').mkdir(parents=True)
            stage=root/'stage';stage.mkdir()
            for name in ('code.bundle','d2_bundle.py'):
                (stage/name).write_bytes(b'SYNTHETIC-TRANSPORT-ONLY-'+name.encode())
            power=lease();start=aware('2026-10-13T05:20:00+00:00');run_id='20261013-052000'
            commit='a'*40;plan={'reference':{}}
            prepared={'paths':{'ops':'/synthetic-preparation'}}
            prepared_raw=json.dumps(prepared).encode()
            spec={'commit':commit,'power_lease':power,'prepared':prepared,
                  'prepared_sha256':hashlib.sha256(prepared_raw).hexdigest(),
                  'files':{p.name:{} for p in stage.iterdir()}}
            cfg={'known_hosts':root/'synthetic-known-hosts','restore_python':Path(sys.executable),
                 'diagnostic':root/'diagnostic','d2':root/'d2','tokenizer':root/'tokenizer',
                 'ssh_host':'synthetic.invalid','ssh_port':1234,'ssh_user':'synthetic',
                 'bootstrap_python':'/synthetic/python','remote_python':'/synthetic/python',
                 'remote_model':'/synthetic/model','remote_model_manifest':'/synthetic/manifest'}
            config=root/'config.json';config.write_text('{}')
            lease_path='/root/autodl-tmp/liftcut/ops/overnight-20261013-042700/lease.json'
            opening={'binding':binding(plan,commit,power['booted_at_proxy'],start.isoformat(),power_lease=power),
                     'budget':BUDGET,'booted_at_proxy':power['booted_at_proxy'],
                     'trial_started_at_utc':start.isoformat(),'started_at_utc':start.isoformat(),
                     'evidence_kind':'model'}  # Synthetic transport fixture; no model called.
            network=SFTP({'/synthetic-preparation/prepared.json':prepared_raw,
                          lease_path:json.dumps(power).encode()})
            labels=[];client=Mock()
            @contextmanager
            def connection():yield network
            client.open_sftp.side_effect=connection
            class Remote:
                def __init__(self,*args):pass
                def run(self,argv,label,**kwargs):
                    labels.append(label)
                    if '-c' in argv:
                        code=argv[argv.index('-c')+1];compile(code,'<transport-fixture>','exec')
                    if label=='verify-original-power-guard':return json.dumps(power)
                    if label in ('create-new-code-stage','install-code-delta'):return '{}'
                    if label=='hash-upload':
                        call=next(n for n in ast.walk(ast.parse(code)) if isinstance(n,ast.Call)
                                  and isinstance(n.func,ast.Name) and n.func.id=='Path')
                        return network.digest(ast.literal_eval(call.args[0]))
                    if label=='dispatch':
                        network.files['/root/autodl-tmp/liftcut/runs/i2-run-'+run_id+'/opening.json']=json.dumps(opening).encode()
                        return json.dumps({'pid':123,'trial_started_at_utc':start.isoformat()})
                    raise AssertionError(label)
            collector=Mock(return_value={'synthetic_transport_only':True})
            paramiko=SimpleNamespace(SSHClient=lambda:client,RejectPolicy=lambda:object())
            with patch.object(launch,'ROOT',root),patch.object(launch,'verify_stage',return_value=spec), \
                 patch.object(launch,'verify_plan',return_value=plan),patch.object(launch,'parse_config',return_value=cfg), \
                 patch.object(launch,'utcnow',return_value=start),patch.object(launch.subprocess,'run'), \
                 patch.object(launch,'Remote',Remote),patch.object(launch,'collect',collector), \
                 patch.object(launch,'remote_bytes',side_effect=lambda s,p,b:s.files.get(p)), \
                 patch.object(launch.getpass,'getpass',return_value='SYNTHETIC-NOT-A-CREDENTIAL'), \
                 patch.dict(sys.modules,{'paramiko':paramiko}):
                result=launch.execute(stage,config,run_id,lease_path)
                # The persistent reservation prevents a second dispatch, even
                # after the first collector has returned.
                with self.assertRaises(FileExistsError):launch.execute(stage,config,run_id,lease_path)
            self.assertTrue(result['synthetic_transport_only'])
            self.assertEqual(labels.count('dispatch'),1)
            self.assertEqual(labels.count('hash-upload'),2)
            self.assertLess(labels.index('hash-upload'),labels.index('install-code-delta'))
            self.assertLess(labels.index('install-code-delta'),labels.index('dispatch'))
            client.connect.assert_called_once();client.close.assert_called_once();collector.assert_called_once()
            events=[json.loads(line) for line in (cfg['operations']/'events.jsonl').read_text().splitlines()]
            self.assertEqual({e['name'] for e in events if e['event']=='staged_file_verified'},set(spec['files']))
            for p in root.rglob('*'):
                if p.is_file():self.assertNotIn(b'SYNTHETIC-NOT-A-CREDENTIAL',p.read_bytes())

    def test_trial_has_same_60_20_budget_without_resetting_machine_opening(self):
        power={**lease(),'final_collection_buffer_minutes':45}
        start='2026-10-13T05:15:00+00:00';boot=power['booted_at_proxy']
        work,collect,hard=deadlines(boot,start,aware(start),power_lease=power)
        self.assertEqual((work-aware(start)).total_seconds(),3600)
        self.assertEqual((collect-work).total_seconds(),1200)
        self.assertEqual((hard-aware(start)).total_seconds(),5400)
        with self.assertRaises(TimeoutError):deadlines(boot,start,aware(start))
        with self.assertRaises(ValueError):deadlines(start,start,aware(start),power_lease=power)
        with self.assertRaises(TimeoutError):deadlines(boot,'2026-10-13T13:00:00+00:00',aware('2026-10-13T13:00:00+00:00'),power_lease=power)
        b=binding({'reference':{}},'a'*40,boot,start,power_lease=power)
        opening={'binding':b,'budget':BUDGET,'booted_at_proxy':boot,'trial_started_at_utc':start,'started_at_utc':start,'evidence_kind':'model'}
        self.assertEqual(validate_opening(opening,{'reference':{}}),b)
        changed=deepcopy(opening);changed['binding']['power_lease']['shutdown_at_utc']='2026-10-13T16:00:00+00:00'
        with self.assertRaises(ValueError):validate_opening(changed,{'reference':{}})
        changed=deepcopy(opening);del changed['binding']['power_lease']
        with self.assertRaises(TimeoutError):validate_opening(changed,{'reference':{}})

    def test_only_execution_sources_may_differ_from_prepared_plan(self):
        old={'source_sha256':{'a':'old'},'gates':{'threshold':10},'budget':BUDGET,'candidate':'D'}
        science_unchanged(old,{**old,'source_sha256':{'a':'new'}})
        for field,value in [('gates',{'threshold':9}),('candidate','B'),('budget',{})]:
            with self.assertRaises(ValueError):science_unchanged(old,{**old,field:value})

    def test_completion_or_backup_failure_retains_instance_and_never_writes_shutdown(self):
        for failure in (False,True):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as directory:
                out=Path(directory);clock=ScriptClock();clock.value=aware('2026-10-13T06:00:00+00:00');calls=[]
                def sleep(seconds):clock.value+=timedelta(seconds=seconds)
                def archive(_):
                    if failure:raise OSError('scripted full disk')
                    return {'archive':'evidence.tar.gz','sha256':'a'*64,'bytes':1}
                finalize(out,'partial',[],{'hard_cutoff':'2026-10-13T06:30:00+00:00','power_lease':lease()},
                    clock.now()+timedelta(seconds=35),clock,sleep=sleep,archive=archive,shutdown=lambda:calls.append(1))
                self.assertFalse(calls);self.assertFalse((out/'shutdown-request.json').exists())
                close=json.loads((out/'window-close.json').read_text())
                self.assertFalse(close['off_instance_acknowledged'])
                self.assertEqual(close['power_action'],'retain_under_original_overnight_guard')


if __name__=='__main__':unittest.main()
