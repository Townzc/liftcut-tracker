"""Deployment regressions from the real PATH/slow-transfer startup failure."""
from contextlib import contextmanager
from copy import deepcopy
import errno
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from d2_execution import aware
from i2_assets import WEIGHT, install_assets
from liftcut_agent.interactive import digest
import i2_setup
import launch_i2 as launcher


def fixture(root):
    cache=root/'cache';cache.mkdir();weight=cache/'weight';weight.write_bytes(b'UNCHANGED WEIGHT')
    values={'data/example':b'data',WEIGHT:weight.read_bytes()}
    index={n:{'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in values.items()}
    archive=root/'a.tgz'
    with tarfile.open(archive,'w:gz') as tar:
        item=tarfile.TarInfo('data/example');item.size=4;tar.addfile(item,io.BytesIO(b'data'))
    return cache,weight,index,archive


def receipt(plan,spec):
    run='20261013-100000';prefix=launcher.PERSIST
    return {'version':'i2-preparation-v1','preparation_id':run,'commit':spec['commit'],
        'stage_digest':digest(spec),'execution_plan_digest':digest(plan),'model_calls':0,'model_result':False,
        'status':'ready_for_gpu_preflight','booted_at_proxy':'2026-10-13T10:00:00+00:00',
        'prepared_at_utc':'2026-10-13T10:10:00+00:00','hard_cutoff':'2026-10-13T12:00:00+00:00',
        'paths':{'stage':str(prefix/'staging'/('i2-prep-'+run)),
                 'data':str(prefix/'data'/('i2-prepared-'+run)),
                 'checkout':str(prefix/'code'/spec['commit']),
                 'ops':str(prefix/'preparations'/('i2-prep-'+run))},
        'installation':{'version':'i2-installed-v1','commit':spec['commit'],
            'execution_plan_digest':digest(plan),'model_calls':0,'model_result':False,'gpu_runtime_verified':False,
            'asset_index_sha256':spec['files']['asset-index.json']['sha256'],
            'frozen_sources':len(plan['source_sha256']),'verified_asset_files':31}}


class PreparationTests(unittest.TestCase):
    def test_no_gpu_preparation_never_dispatches_and_closes_after_success_or_failed_verification(self):
        for failed in (False,'installation','cache'):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);config=root/'config.json';config.write_text('{}')
                start='2026-10-13T10:00:00+00:00';commit='c'*40;labels=[]
                plan={'source_sha256':{},'reference':{'checkpoint':{'adapter_sha256':{'adapter_model.safetensors':'a'*64}}}}
                spec={'commit':commit,'cached_weight':True,'bundle_base':launcher.I1_COMMIT,
                      'files':{'asset-index.json':{'sha256':'d'*64}}}
                installation=receipt(plan,spec)['installation']
                cfg={k:root/k for k in ('diagnostic','d2','tokenizer','restore_python','known_hosts')}
                cfg.update(ssh_host='unit.invalid',ssh_port=22,ssh_user='root',bootstrap_python='/root/miniconda3/bin/python',
                    remote_python='/root/autodl-tmp/liftcut/env/python',remote_model='/root/autodl-tmp/liftcut/model',
                    remote_model_manifest='/root/autodl-tmp/liftcut/model.json',
                    remote_cached_weight='/root/autodl-tmp/liftcut/runs/i1/reference/final/adapter_model.safetensors')
                client=Mock();sftp=Mock()
                @contextmanager
                def channel():yield sftp
                client.open_sftp.side_effect=channel
                class Remote:
                    def __init__(self,*_):pass
                    def run(self,argv,label,**_):
                        labels.append(label)
                        if '-c' in argv:compile(argv[argv.index('-c')+1],'<remote>','exec')
                        if label=='cached-base-observed':return launcher.I1_COMMIT
                        if label=='cached-base-clean':return ''
                        if label=='cached-weight-verified' and failed=='cache':raise ValueError('SCRIPTED cache mismatch')
                        if label=='verify-installation':
                            if failed=='installation':raise ValueError('SCRIPTED installation mismatch')
                            return json.dumps(installation)
                        return '{}'
                class Budget:
                    def __init__(self,deadline):self.deadline=deadline
                    def check(self):pass
                    def remaining(self):return 7200
                with patch.object(launcher,'ROOT',root),patch.object(launcher,'parse_config',return_value=cfg), \
                     patch.object(launcher,'verify_stage',return_value=(plan,spec)), \
                     patch.object(launcher,'utcnow',return_value=aware(start)),patch.object(launcher,'Remote',Remote), \
                     patch.object(launcher,'TimeBudget',Budget),patch.object(launcher,'upload_verified'), \
                     patch.object(launcher.getpass,'getpass',return_value='SCRIPTED-SECRET'), \
                     patch.dict(sys.modules,{'paramiko':SimpleNamespace(SSHClient=lambda:client,RejectPolicy=lambda:object())}):
                    if failed:
                        with self.assertRaises(ValueError):launcher.prepare_instance(root/'stage',config,'20261013-100000',start)
                    else:
                        result=launcher.prepare_instance(root/'stage',config,'20261013-100000',start)
                        self.assertFalse(result['model_result']);self.assertEqual(result['model_calls'],0)
                self.assertNotIn('dispatch',labels);self.assertEqual(labels.count('close-preparation'),1)
                self.assertEqual(labels.count('verify-installation'),0 if failed=='cache' else 1)
                if failed=='cache':self.assertNotIn('install-code',labels)
                client.connect.assert_called_once();client.close.assert_called_once()
                for p in root.rglob('*'):
                    if p.is_file():self.assertNotIn(b'SCRIPTED-SECRET',p.read_bytes())

    def test_cached_original_is_copied_verified_and_never_modified(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cache,weight,index,archive=fixture(root)
            result=install_assets(archive,index,root/'installed',cached_weight=weight,cache_root=cache)
            self.assertTrue(result['cached_weight_copied']);self.assertEqual(result['verified_files'],2)
            self.assertEqual(weight.read_bytes(),(root/'installed'/WEIGHT).read_bytes())
            self.assertFalse(weight.samefile(root/'installed'/WEIGHT))
            (root/'installed'/WEIGHT).write_bytes(b'changed copy')
            self.assertEqual(weight.read_bytes(),b'UNCHANGED WEIGHT')

    def test_corrupt_missing_or_outside_cache_fails_before_installation(self):
        for kind in ('corrupt','missing','outside'):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);cache,weight,index,archive=fixture(root)
                if kind=='corrupt':weight.write_bytes(b'changed')
                if kind=='missing':weight=cache/'absent'
                if kind=='outside':weight=root/'outside';weight.write_bytes(b'UNCHANGED WEIGHT')
                with self.assertRaises((ValueError,FileNotFoundError)):
                    install_assets(archive,index,root/'installed',cached_weight=weight,cache_root=cache)
                self.assertFalse((root/'installed').exists())

    def test_gpu_management_probe_rejects_visible_gpu_without_loading_cuda(self):
        with patch.object(i2_setup.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='GPU-actual\n')):
            with self.assertRaisesRegex(ValueError,'GPU visible'):i2_setup.no_visible_gpu()
        with patch.object(i2_setup.subprocess,'run',return_value=SimpleNamespace(returncode=9,stdout='')):
            self.assertEqual(i2_setup.no_visible_gpu()['visible_gpu_uuids'],[])
        with patch.object(i2_setup.subprocess,'run',side_effect=FileNotFoundError):
            self.assertIsNone(i2_setup.no_visible_gpu()['query_returncode'])

    def test_explicit_existing_interpreter_allowed_but_commands_and_escaped_paths_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            cfg={k:str(root) for k in ('diagnostic','d2','tokenizer','restore_python','known_hosts')}
            cfg.update(ssh_host='unit.invalid',ssh_port=22,ssh_user='root',bootstrap_python='/root/miniconda3/bin/python',
                remote_python='/root/autodl-tmp/liftcut/env/python',remote_model='/root/autodl-tmp/liftcut/model',
                remote_model_manifest='/root/autodl-tmp/liftcut/model.json',
                remote_cached_weight='/root/autodl-tmp/liftcut/runs/i1/reference/final/adapter_model.safetensors')
            self.assertEqual(launcher.parse_config(cfg)['bootstrap_python'],cfg['bootstrap_python'])
            for key,value in [('bootstrap_python','python3;whoami'),('remote_cached_weight','/etc/passwd'),
                              ('remote_cached_weight','/root/autodl-tmp/liftcut/../outside')]:
                with self.assertRaises(ValueError):launcher.parse_config({**cfg,key:value})

    def test_autodl_empty_cli_is_supported_only_without_gpu_devices(self):
        with tempfile.TemporaryDirectory() as directory:
            executable=Path(directory)/'nvidia-smi';executable.write_bytes(b'')
            for kind in ('empty','nonempty','gpu_device','permission'):
                executable.write_bytes(b'ELF' if kind=='nonempty' else b'')
                error=OSError(errno.EACCES if kind=='permission' else errno.ENOEXEC,'SCRIPTED OS error')
                devices=[Path('/dev/nvidia0')] if kind=='gpu_device' else []
                with patch.object(i2_setup.subprocess,'run',side_effect=error), \
                     patch.object(i2_setup.shutil,'which',return_value=str(executable)), \
                     patch.object(i2_setup.Path,'glob',return_value=devices):
                    if kind=='empty':
                        value=i2_setup.no_visible_gpu()
                        self.assertEqual(value['unavailable_reason'],'autodl_zero_byte_nvidia_smi')
                        self.assertEqual(value['gpu_device_nodes'],[])
                    else:
                        with self.assertRaises(OSError):i2_setup.no_visible_gpu()

    def test_cpu_continuation_preserves_original_deadline_and_remaining_margin(self):
        boot='2026-10-13T01:22:28+00:00'
        hard=i2_setup.preparation_deadline(boot,aware('2026-10-13T02:22:28+00:00'))
        self.assertEqual(hard,aware('2026-10-13T03:22:28+00:00'))
        for now in ('2026-10-13T01:22:27+00:00','2026-10-13T02:52:29+00:00'):
            with self.assertRaises(ValueError):i2_setup.preparation_deadline(boot,aware(now))

    def test_preparation_is_bound_to_exact_code_assets_paths_and_original_cpu_clock(self):
        plan={'source_sha256':{'example':'a'*64}};spec={'commit':'c'*40,'files':{'asset-index.json':{'sha256':'d'*64}}}
        valid=receipt(plan,spec)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'prepared.json';path.write_text(json.dumps(valid))
            self.assertEqual(launcher.preparation_receipt(path,plan,spec),valid)
            variants=[]
            for key,value in [('model_result',True),('status','complete_model'),('hard_cutoff','2026-10-13T12:01:00+00:00')]:
                item=deepcopy(valid);item[key]=value;variants.append(item)
            item=deepcopy(valid);item['paths']['data']+='/../other';variants.append(item)
            item=deepcopy(valid);item['installation']['asset_index_sha256']='e'*64;variants.append(item)
            for item in variants:
                path.write_text(json.dumps(item))
                with self.assertRaises(ValueError):launcher.preparation_receipt(path,plan,spec)

    def test_prepared_gpu_start_uploads_nothing_and_never_retries_unknown_dispatch(self):
        for mismatched in (False,True):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);config=root/'config.json';config.write_text('{}')
                start='2026-10-14T10:00:00+00:00';commit='c'*40;labels=[]
                plan={'source_sha256':{}}
                spec={'commit':commit,'cached_weight':True,'files':{n:{'sha256':'d'*64} for n in ('i2_setup.py','shutdown_guard.py','asset-index.json')}}
                prepared=receipt(plan,spec);file=root/'prepared.json';file.write_text(json.dumps(prepared))
                cfg={k:root/k for k in ('diagnostic','d2','tokenizer','restore_python','known_hosts')}
                cfg.update(ssh_host='unit.invalid',ssh_port=22,ssh_user='root',bootstrap_python='/root/miniconda3/bin/python',
                    remote_python='/root/autodl-tmp/liftcut/env/python',remote_model='/root/autodl-tmp/liftcut/model',
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
                        if label=='hash':return 'd'*64
                        if label=='reverify-preparation':return json.dumps({} if mismatched else prepared['installation'])
                        if label=='dispatch':raise TimeoutError('SCRIPTED unknown outcome')
                        return '{}'
                class Budget:
                    def __init__(self,deadline):self.deadline=deadline
                    def check(self):pass
                    def remaining(self):return 600
                with patch.object(launcher,'ROOT',root),patch.object(launcher,'parse_config',return_value=cfg), \
                     patch.object(launcher,'verify_stage',return_value=(plan,spec)), \
                     patch.object(launcher,'utcnow',return_value=aware(start)),patch.object(launcher,'Remote',Remote), \
                     patch.object(launcher,'TimeBudget',Budget),patch.object(launcher.subprocess,'run'), \
                     patch.object(launcher,'remote_bytes',return_value=json.dumps(prepared).encode()), \
                     patch.object(launcher,'upload_verified') as upload,patch.object(launcher,'collect') as collect, \
                     patch.object(launcher.getpass,'getpass',return_value='SCRIPTED-SECRET'), \
                     patch.dict(sys.modules,{'paramiko':SimpleNamespace(SSHClient=lambda:client,RejectPolicy=lambda:object())}):
                    with self.assertRaisesRegex(ValueError,'GPU opening must follow'):
                        launcher.execute(root/'stage',config,'20261014-100000',prepared['booted_at_proxy'],file)
                    with self.assertRaises(ValueError if mismatched else TimeoutError):
                        launcher.execute(root/'stage',config,'20261014-100000',start,file)
                    upload.assert_not_called();collect.assert_not_called()
                self.assertNotIn('install-code',labels);self.assertNotIn('install-assets',labels)
                self.assertEqual(labels.count('dispatch'),0 if mismatched else 1)
                self.assertEqual(labels.count('setup-abort-shutdown'),1 if mismatched else 0)
                client.connect.assert_called_once();client.close.assert_called_once()
                opening=json.loads(next((root/'outputs/autodl').glob('i2-opening-*.json')).read_text())
                self.assertEqual(opening['booted_at_proxy'],start)
                for p in root.rglob('*'):
                    if p.is_file():self.assertNotIn(b'SCRIPTED-SECRET',p.read_bytes())


if __name__=='__main__':unittest.main()
