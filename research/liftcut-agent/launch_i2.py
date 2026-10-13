"""Offline staging and exactly one I2 dispatch/collector in a NEW authorized lease.

No network without --prepare-instance or --execute and an actual opening timestamp. Credentials
stay in getpass memory. Unknown dispatch outcomes are never automatically retried.
"""
import argparse
from datetime import timedelta, timezone
import getpass
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import threading
import time
import uuid

from d2_execution import event_file, read, utcnow
from i2_protocol import BUDGET, EXECUTION, ROOT, I1_COMMIT, aware, deadlines, validate_opening, verify_adapter, verify_plan
from i2_assets import WEIGHT
from i2_setup import preparation_deadline
from i2_receipt_transfer import transfer_receipt, validate_index, validate_receipt
from launch_g3_remote import Remote, upload_verified
from launch_g4_overnight import download
from liftcut_agent.interactive import digest
from monitor_coverage_replication import TimeBudget, json_lines, persist_json, remote_bytes
from server_workspace import command, dump_new, sha256

PERSIST = PurePosixPath('/root/autodl-tmp/liftcut')
BOOTSTRAP = ('i2_setup.py','shutdown_guard.py','i2_assets.py','d2_bundle.py')


def stage(output, commit, ref, diagnostic, d2, tokenizer, i1_run, *, compact=False):
    plan = verify_plan()
    if (output.exists() or not re.fullmatch(r'[0-9a-f]{40}', commit)
            or command(['git','rev-parse',ref],ROOT) != commit
            or command(['git','diff',commit,'--','.'],ROOT)
            or command(['git','status','--porcelain','--','.'],ROOT)):
        raise ValueError('fresh stage and clean exact research commit required')
    from prepare_state_diagnostics import verify_prepared as check_diagnostic
    from prepare_counterfactual_diagnostics import verify_prepared as check_d2, load_tokenizer
    check_diagnostic(diagnostic); check_d2(d2); load_tokenizer(tokenizer)
    reference = plan['reference']
    if read(i1_run/'reference/manifest.json') != reference['checkpoint']:
        raise ValueError('staged actual I1 checkpoint lineage differs')
    verify_adapter(i1_run/'reference/final',reference['checkpoint'])
    output.mkdir(parents=True)
    base = I1_COMMIT if compact else None
    if base and command(['git','merge-base',base,commit],ROOT) != base:
        raise ValueError('compact deployment requires the verified original I1 Git base')
    command(['git','bundle','create',str((output/'code.bundle').resolve()),ref,*(['^'+base] if base else [])],ROOT)
    command(['git','bundle','verify',str((output/'code.bundle').resolve())],ROOT)
    assets = {}
    for prefix, source in [('diagnostic',diagnostic),('d2',d2),('tokenizer',tokenizer)]:
        for path in sorted(source.rglob('*')):
            if path.is_symlink(): raise ValueError('no symlink assets')
            if path.is_file(): assets[prefix+'/'+path.relative_to(source).as_posix()] = path
    for name in ('adapter_model.safetensors','adapter_config.json'):
        assets['reference/final/'+name] = i1_run/'reference/final'/name
    for name, expected in reference['i1_view_sha256'].items():
        path = i1_run/'evaluation/view'/name
        if sha256(path) != expected: raise ValueError('I1 view trace differs')
        assets['reference/i1-view/'+name] = path
    dump_new(output/'reference.json',reference)
    assets['reference/manifest.json'] = output/'reference.json'
    index = {n:{'bytes':p.stat().st_size,'sha256':sha256(p)} for n,p in sorted(assets.items())}
    if len(index)>150 or sum(v['bytes'] for v in index.values())>512_000_000:
        raise ValueError('asset inventory exceeds reviewed bounds')
    with tarfile.open(output/'assets.tar.gz','w:gz') as tar:
        for name, path in sorted(assets.items()):
            if compact and name == WEIGHT: continue
            tar.add(path,arcname=name,recursive=False)
    dump_new(output/'asset-index.json',index)
    for name in BOOTSTRAP: shutil.copyfile(ROOT/name,output/name)
    spec = {'version':'i2-stage-v2','commit':commit,'bundle_base':base,'cached_weight':compact,
        'execution_plan_sha256':sha256(EXECUTION),'execution_plan_digest':digest(plan),
        'files':{p.name:{'bytes':p.stat().st_size,'sha256':sha256(p)} for p in sorted(output.iterdir())},
        'budget':BUDGET,'gpu_calls':0}
    dump_new(output/'stage.json',spec)
    return spec


def verify_stage(directory):
    plan, spec = verify_plan(), read(directory/'stage.json')
    if (spec['version']!='i2-stage-v2' or type(spec.get('cached_weight')) is not bool
            or spec['bundle_base'] != (I1_COMMIT if spec['cached_weight'] else None)
            or not re.fullmatch(r'[0-9a-f]{40}',spec['commit']) or spec['budget']!=BUDGET
            or spec['execution_plan_digest']!=digest(plan) or spec['execution_plan_sha256']!=sha256(EXECUTION)
            or set(spec['files'])!=set(BOOTSTRAP)|{'code.bundle','assets.tar.gz','asset-index.json','reference.json'}):
        raise ValueError('stage binding differs')
    for name,item in spec['files'].items():
        path = directory/name
        if path.is_symlink() or sha256(path)!=item['sha256'] or path.stat().st_size!=item['bytes']:
            raise ValueError('staged file changed')
    for name in BOOTSTRAP:
        if sha256(directory/name)!=sha256(ROOT/name): raise ValueError('bootstrap differs from frozen local source')
    return plan, spec


def parse_config(raw):
    keys = {'ssh_host','ssh_port','ssh_user','known_hosts','restore_python','diagnostic','d2','tokenizer',
            'remote_python','bootstrap_python','remote_model','remote_model_manifest'}
    if set(raw) not in (keys, keys|{'remote_cached_weight'}):
        raise ValueError('path-only config keys differ; credentials must not be stored')
    result=dict(raw)
    if (not re.fullmatch(r'[A-Za-z0-9.-]+',raw['ssh_host']) or type(raw['ssh_port']) is not int
            or not 0<raw['ssh_port']<65536 or raw['ssh_user']!='root'
            or raw['bootstrap_python'] not in ('python3','/root/miniconda3/bin/python')):
        raise ValueError('reviewed SSH endpoint and Python bootstrap required')
    for name in ('known_hosts','restore_python','diagnostic','d2','tokenizer'):
        result[name]=Path(raw[name]).expanduser().resolve()
        if not result[name].exists(): raise ValueError('missing local prerequisite: '+name)
    for name in ('remote_python','remote_model','remote_model_manifest',*(['remote_cached_weight'] if 'remote_cached_weight' in raw else [])):
        p=PurePosixPath(raw[name])
        if not p.is_relative_to(PERSIST) or '..' in p.parts or '\\' in raw[name] or str(p)!=raw[name]:
            raise ValueError('remote cached assets must have canonical persistent POSIX paths')
    return result


def preparation_receipt(path, plan, spec):
    value = read(path); run_id = value.get('preparation_id','')
    if (value.get('version')!='i2-preparation-v1' or not re.fullmatch(r'[0-9]{8}-[0-9]{6}',run_id)
            or value.get('commit')!=spec['commit'] or value.get('stage_digest')!=digest(spec)
            or value.get('execution_plan_digest')!=digest(plan) or value.get('model_calls')!=0
            or value.get('model_result') is not False or value.get('status')!='ready_for_gpu_preflight'):
        raise ValueError('preparation receipt differs from exact local stage')
    expected={'stage':str(PERSIST/'staging'/('i2-prep-'+run_id)),
              'data':str(PERSIST/'data'/('i2-prepared-'+run_id)),
              'checkout':str(PERSIST/'code'/spec['commit']),
              'ops':str(PERSIST/'preparations'/('i2-prep-'+run_id))}
    if value.get('paths')!=expected: raise ValueError('preparation paths are not canonical')
    boot=aware(value['booted_at_proxy']);hard=aware(value['hard_cutoff'])
    if hard!=boot+timedelta(minutes=120) or not boot<=aware(value['prepared_at_utc'])<=hard:
        raise ValueError('original CPU preparation time bounds differ')
    checked=value.get('installation',{})
    if (checked.get('version')!='i2-installed-v1' or checked.get('commit')!=spec['commit']
            or checked.get('execution_plan_digest')!=digest(plan) or checked.get('model_calls')!=0
            or checked.get('model_result') is not False or checked.get('gpu_runtime_verified') is not False
            or checked.get('asset_index_sha256')!=spec['files']['asset-index.json']['sha256']
            or checked.get('frozen_sources')!=len(plan['source_sha256'])
            or type(checked.get('verified_asset_files')) is not int or not 0<checked['verified_asset_files']<=150):
        raise ValueError('preparation installation proof incomplete')
    return value


def installation_argv(cfg, checkout, data, directory, commit):
    return [cfg['remote_python'],str(checkout/'research/liftcut-agent/i2_setup.py'),
            '--verify-installation','--data',str(data),'--asset-index',str(directory/'asset-index.json'),
            '--model',cfg['remote_model'],'--model-manifest',cfg['remote_model_manifest'],'--commit',commit]


def prepare_instance(stage_dir, config_file, run_id, booted):
    """No model dispatch. A separate no-GPU lease prepares persistent data once."""
    if not re.fullmatch(r'[0-9]{8}-[0-9]{6}',run_id): raise ValueError('actual UTC preparation ID required')
    cfg=parse_config(read(config_file));plan,spec=verify_stage(stage_dir)
    if spec['cached_weight'] and 'remote_cached_weight' not in cfg:
        raise ValueError('compact preparation requires the original cached fixed weight path')
    now=utcnow();boot=aware(booted)
    hard=preparation_deadline(booted,now);budget=TimeBudget(hard)
    key=digest(boot.astimezone(timezone.utc).isoformat())[:20]
    local=ROOT/'outputs/autodl'/('i2-prep-'+run_id+'-operations')
    local.mkdir(parents=True,exist_ok=False)
    dump_new(ROOT/'outputs/autodl'/('i2-prep-opening-'+key+'.json'),
             {'preparation_id':run_id,'booted_at_proxy':booted,'local_pid':os.getpid()})
    emit=lambda event,**kw:(event_file(local/'events.jsonl',event,**kw),print(json.dumps({'event':event,**kw}),flush=True))
    emit('preparation_reserved',pid=os.getpid(),opening=booted,hard_cutoff=hard.isoformat(),hourly_cny=0.1,reserve_cny=0.2)
    import paramiko
    client=paramiko.SSHClient();client.load_host_keys(str(cfg['known_hosts']))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    timer=threading.Timer(max(1,(hard-utcnow()).total_seconds()),client.close);timer.daemon=True;timer.start()
    password=getpass.getpass('I2 no-GPU preparation password (not stored): ')
    armed=False
    directory=PERSIST/'staging'/('i2-prep-'+run_id);data=PERSIST/'data'/('i2-prepared-'+run_id)
    checkout=PERSIST/'code'/spec['commit'];ops=PERSIST/'preparations'/('i2-prep-'+run_id)
    py=cfg['bootstrap_python']
    try:
        budget.check()
        client.connect(cfg['ssh_host'],port=cfg['ssh_port'],username=cfg['ssh_user'],password=password,
                       look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15,banner_timeout=15)
        password=None;emit('ssh_connected')
        remote=Remote(client,local,budget,emit)
        with client.open_sftp() as sftp:
            remote.run([py,'-c','from pathlib import Path;p=Path('+repr(str(directory))+');p.parent.mkdir(parents=True,exist_ok=True);p.mkdir(exist_ok=False)'],'create-preparation')
            def remote_hash(path):
                code='import hashlib;from pathlib import Path;h=hashlib.sha256();f=Path('+repr(path)+').open("rb")\nfor b in iter(lambda:f.read(1048576),b""):h.update(b)\nprint(h.hexdigest())'
                return remote.run([py,'-c',code],'hash').strip()
            for name in ('i2_setup.py','shutdown_guard.py'):
                upload_verified(stage_dir/name,str(directory/name),sftp,remote_hash,budget,emit)
            guard=json.loads(remote.run([py,str(directory/'i2_setup.py'),'--arm-preparation','--ops',str(ops),'--booted-at',booted],'arm-preparation',timeout=30))
            armed=True;dump_new(local/'guard.json',guard);emit('preparation_guard_verified',value=guard)
            if spec['bundle_base']:
                base=PERSIST/'code'/spec['bundle_base']
                if (remote.run(['git','-C',str(base),'rev-parse','HEAD'],'cached-base-observed').strip()!=spec['bundle_base']
                        or remote.run(['git','-C',str(base),'status','--porcelain'],'cached-base-clean').strip()):
                    raise ValueError('original cached Git base differs; preserve it and stop')
                probe=('from pathlib import Path;import hashlib;p=Path('+repr(cfg['remote_cached_weight'])+').resolve(strict=True);'
                       'assert p.is_relative_to(Path('+repr(str(PERSIST))+')) and p.is_file();'
                       'h=hashlib.sha256();f=p.open("rb")\nfor b in iter(lambda:f.read(1048576),b""):h.update(b)\nassert h.hexdigest()=='
                       +repr(plan['reference']['checkpoint']['adapter_sha256']['adapter_model.safetensors']))
                remote.run([py,'-c',probe],'cached-weight-verified',timeout=60)
            for name in spec['files']:
                if name not in ('i2_setup.py','shutdown_guard.py'):
                    upload_verified(stage_dir/name,str(directory/name),sftp,remote_hash,budget,emit)
            args=[str(directory/'code.bundle'),str(checkout),spec['commit']]
            if spec['bundle_base']: args += [str(PERSIST/'code'/spec['bundle_base']),spec['bundle_base']]
            install='import sys;sys.path.insert(0,'+repr(str(directory))+');from d2_bundle import install_bundle;print(install_bundle('+','.join(repr(x) for x in args)+'))'
            remote.run([py,'-c',install],'install-code',timeout=180)
            argv=[py,str(directory/'i2_assets.py'),'--archive',str(directory/'assets.tar.gz'),
                  '--index',str(directory/'asset-index.json'),'--destination',str(data)]
            if spec['cached_weight']: argv += ['--cached-weight',cfg['remote_cached_weight']]
            remote.run(argv,'install-assets',timeout=180)
            checked=json.loads(remote.run(installation_argv(cfg,checkout,data,directory,spec['commit']),'verify-installation',timeout=600))
            value={'version':'i2-preparation-v1','preparation_id':run_id,'commit':spec['commit'],
                   'stage_digest':digest(spec),'execution_plan_digest':digest(plan),'model_calls':0,'model_result':False,
                   'status':'ready_for_gpu_preflight','prepared_at_utc':utcnow().isoformat(),
                   'paths':{'stage':str(directory),'data':str(data),'checkout':str(checkout),'ops':str(ops)},
                   'installation':checked,'booted_at_proxy':booted,'hard_cutoff':hard.isoformat()}
            receipt=local/'prepared.json';dump_new(receipt,value);preparation_receipt(receipt,plan,spec)
            upload_verified(receipt,str(ops/'prepared.json'),sftp,remote_hash,budget,emit)
            emit('preparation_verified',receipt=str(receipt),value=value)
            return value
    except BaseException as error:
        emit('preparation_stopped',error_type=type(error).__name__,guard_verified=armed,no_automatic_retry=True)
        raise
    finally:
        password=None
        if armed and client.get_transport() and client.get_transport().is_active():
            try:
                emit('preparation_shutdown_requested')
                returned=remote.run([py,str(directory/'i2_setup.py'),'--close-preparation','--ops',str(ops),'--booted-at',booted],'close-preparation',timeout=30)
                emit('preparation_shutdown_return',value=json.loads(returned),provider_power_state='unknown')
            except BaseException as error:
                emit('preparation_shutdown_return_unobserved',error_type=type(error).__name__,original_guard_retained=True)
        client.close();timer.cancel()


def collect(sftp,cfg,plan,opening,budget,emit):
    bind=validate_opening(opening,plan); sent=None; seen={}; last=None; consumed=None
    while budget.remaining()>0:
        raw=remote_bytes(sftp,cfg['remote_run']+'/events.jsonl',budget,tail=True)
        (cfg['operations']/'server-events-latest.jsonl').write_bytes(raw or b'')
        rows=json_lines(raw)
        if rows and rows[-1]!=last: last=rows[-1]; emit('server_event',record=last)
        if sent is None:
            for row in json_lines(remote_bytes(sftp,cfg['remote_run']+'/early-index.jsonl',budget)):
                arm=row['arm']
                if (arm not in ('A','B','C','D') or row['binding']!=bind
                        or row['path']!='evaluation/'+arm+'.tar.gz'):
                    raise ValueError('early I2 archive binding differs')
                if arm in seen and row!=seen[arm]: raise ValueError('early archive changed')
                download(sftp,row['path'],row,cfg,budget,emit); seen[arm]=row
            raw=remote_bytes(sftp,cfg['remote_run']+'/backup-index.json',budget)
            if raw:
                index=json.loads(raw); validate_index(index,bind)
                persist_json(cfg['downloads']/'backup-index.json',index)
                for item in index['archives']: download(sftp,item['path'],item,cfg,budget,emit)
                output=cfg['restored']/uuid.uuid4().hex
                argv=[str(cfg['restore_python']),str(ROOT/'restore_i2.py'),'--archive-dir',str(cfg['downloads']),
                      '--output-dir',str(output),'--allow-partial']
                for key,flag in [('diagnostic','diagnostic-dir'),('d2','d2-dir'),('tokenizer','tokenizer-dir')]:
                    argv+=['--'+flag,str(cfg[key])]
                emit('restore_started',output=str(output))
                with (cfg['operations']/'restore.log').open('x',encoding='utf-8') as log:
                    subprocess.run(argv,check=True,timeout=max(1,budget.remaining()-60),stdout=log,stderr=subprocess.STDOUT)
                receipt=output/'off-instance-backup.json'
                actual=validate_receipt(receipt.read_bytes(),index,bind)
                emit('off_instance_verified',receipt=actual)
                sent=transfer_receipt(sftp,receipt,cfg['remote_run'],index,bind,budget.deadline,now=budget.now,emit=emit)
                if sent['status'] not in ('published','already_present'): return sent
        raw=remote_bytes(sftp,cfg['remote_run']+'/backup-copy-status.json',budget)
        if raw and consumed is None:
            status=json.loads(raw);persist_json(cfg['operations']/'backup-copy-status.json',status)
            consumed=status['off_instance_acknowledged'];emit('server_receipt_observed',value=status)
        if 'power_lease' in bind:
            raw=remote_bytes(sftp,cfg['remote_run']+'/window-close.json',budget)
            if raw:
                value=json.loads(raw);persist_json(cfg['operations']/'window-close.json',value)
                if (value['power_action']!='retain_under_original_overnight_guard'
                        or value['shutdown_at_utc']!=bind['power_lease']['shutdown_at_utc']):
                    raise ValueError('overnight retention policy changed')
                emit('experiment_closed_instance_retained',value=value)
                return {'receipt_transfer':sent,'server_consumed':consumed,'window_close':value,
                        'provider_power_state':'intentionally_retained','provider_billing_stopped':False}
        raw=remote_bytes(sftp,cfg['remote_run']+'/shutdown-request.json',budget)
        if raw:
            value=json.loads(raw);persist_json(cfg['operations']/'shutdown-request.json',value)
            emit('shutdown_return_observed',value=value)
            return {'receipt_transfer':sent,'server_consumed':consumed,'shutdown_return':value,
                    'provider_power_state':'unknown','provider_billing_stopped':'unknown'}
        time.sleep(min(1 if sent else 15,budget.remaining()))
    return {'status':'original_collection_deadline_reached','receipt_transfer':sent,'server_consumed':consumed,
            'provider_power_state':'unknown','provider_billing_stopped':'unknown'}


def execute(stage_dir,config_file,run_id,booted,prepared_file=None):
    if not re.fullmatch(r'[0-9]{8}-[0-9]{6}',run_id): raise ValueError('unique actual UTC run ID required')
    cfg=parse_config(read(config_file));plan,spec=verify_stage(stage_dir);commit=spec['commit']
    prepared=preparation_receipt(prepared_file,plan,spec) if prepared_file else None
    if prepared and aware(booted) <= aware(prepared['prepared_at_utc']):
        raise ValueError('GPU opening must follow completed no-GPU preparation')
    if spec.get('cached_weight') and prepared is None:
        raise ValueError('compact deployment must finish in no-GPU mode before GPU opening')
    deadlines(booted,utcnow().isoformat(),utcnow())
    subprocess.run([str(cfg['restore_python']),str(ROOT/'i2_protocol.py'),'--verify',
        '--diagnostic-dir',str(cfg['diagnostic']),'--d2-dir',str(cfg['d2']),'--tokenizer-dir',str(cfg['tokenizer'])],
        check=True,timeout=90)
    hard=aware(booted)+timedelta(minutes=BUDGET['hard_minutes'])
    setup=TimeBudget(aware(booted)+timedelta(minutes=BUDGET['setup_minutes']))
    setup.check()
    cfg['remote_run']=str(PERSIST/'runs'/('i2-run-'+run_id))
    # A second run ID cannot silently relaunch the same actual opening.
    opening_key=digest(aware(booted).astimezone(timezone.utc).isoformat())[:20]
    dump_new(ROOT/'outputs/autodl'/('i2-opening-'+opening_key+'.json'),
        {'run_id':run_id,'booted_at_proxy':booted,'commit':commit,'local_pid':os.getpid()})
    for key in ('operations','downloads','restored'):
        cfg[key]=ROOT/'outputs/autodl'/('i2-'+run_id+'-'+key);cfg[key].mkdir(parents=True,exist_ok=False)
    dump_new(cfg['operations']/'config.json',{k:str(v) if isinstance(v,Path) else v for k,v in cfg.items()})
    emit=lambda event,**kw:(event_file(cfg['operations']/'events.jsonl',event,**kw),
                           print(json.dumps({'event':event,**kw}),flush=True))
    emit('exclusive_local_dispatch_reserved',pid=os.getpid(),opening=booted,hard_cutoff=hard.isoformat())
    import paramiko
    client=paramiko.SSHClient();client.load_host_keys(str(cfg['known_hosts']))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    timer=threading.Timer(max(1,(hard-utcnow()).total_seconds()),client.close);timer.daemon=True;timer.start()
    password=getpass.getpass('I2 AutoDL password (not stored): ')
    armed=False; dispatch_issued=False
    try:
        setup.check();limit=min(15,setup.remaining())
        client.connect(cfg['ssh_host'],port=cfg['ssh_port'],username=cfg['ssh_user'],password=password,
            look_for_keys=False,allow_agent=False,timeout=limit,auth_timeout=limit,banner_timeout=limit)
        password=None;emit('ssh_connected')
        remote=Remote(client,cfg['operations'],setup,emit)
        directory=PERSIST/'staging'/('i2-'+run_id); checkout=PERSIST/'code'/commit
        ops=PERSIST/'runs'/('i2-ops-'+run_id);data=PERSIST/'data'/('i2-'+run_id)
        if prepared:
            directory=PurePosixPath(prepared['paths']['stage']);data=PurePosixPath(prepared['paths']['data'])
        py=cfg['bootstrap_python'];runtime=cfg['remote_python']
        with client.open_sftp() as sftp:
            def remote_hash(path):
                code=('import hashlib;from pathlib import Path;p=Path('+repr(path)+');h=hashlib.sha256();'
                      '\nf=p.open("rb")\nfor b in iter(lambda:f.read(1048576),b""):h.update(b)\nprint(h.hexdigest())')
                return remote.run([py,'-c',code],'hash').strip()
            if prepared:
                actual=remote_bytes(sftp,prepared['paths']['ops']+'/prepared.json',setup)
                if actual is None or json.loads(actual)!=prepared:
                    raise ValueError('remote preparation receipt differs; no GPU re-deployment')
                for name in ('i2_setup.py','shutdown_guard.py'):
                    if remote_hash(str(directory/name))!=spec['files'][name]['sha256']:
                        raise ValueError('prepared bootstrap bytes changed')
                emit('preparation_reused',preparation_id=prepared['preparation_id'],uploaded_asset_bytes=0)
            else:
                create='from pathlib import Path;p=Path('+repr(str(directory))+');p.parent.mkdir(parents=True,exist_ok=True);p.mkdir(exist_ok=False)'
                remote.run([py,'-c',create],'create-stage')
                for name in ('i2_setup.py','shutdown_guard.py'):
                    upload_verified(stage_dir/name,str(directory/name),sftp,remote_hash,setup,emit)
            value=json.loads(remote.run([py,str(directory/'i2_setup.py'),'--arm-bootstrap','--ops',str(ops),
                                         '--booted-at',booted],'arm-original-guard',timeout=30))
            armed=True;dump_new(cfg['operations']/'guard.json',value);emit('independent_guard_verified',value=value)
            if prepared:
                checked=json.loads(remote.run(installation_argv(cfg,checkout,data,directory,commit),'reverify-preparation',timeout=180))
                if checked!=prepared['installation']:raise ValueError('deployed data/runtime changed since CPU preparation')
                emit('prepared_data_reverified',value=checked)
            else:
                for name in spec['files']:
                    if name not in ('i2_setup.py','shutdown_guard.py'):
                        upload_verified(stage_dir/name,str(directory/name),sftp,remote_hash,setup,emit)
                install=('import sys;sys.path.insert(0,'+repr(str(directory))+');from d2_bundle import install_bundle;'
                         'print(install_bundle('+repr(str(directory/'code.bundle'))+','+repr(str(checkout))+','+repr(commit)+'))')
                remote.run([py,'-c',install],'install-code',timeout=120)
                remote.run([py,str(directory/'i2_assets.py'),'--archive',str(directory/'assets.tar.gz'),
                            '--index',str(directory/'asset-index.json'),'--destination',str(data)],'install-assets',timeout=120)
            dispatch_issued=True
            emit('controller_dispatch_issued',automatic_retry=False)
            result=json.loads(remote.run([runtime,str(checkout/'research/liftcut-agent/i2_setup.py'),'--dispatch',
                '--ops',str(ops),'--data',str(data),'--model',cfg['remote_model'],'--model-manifest',cfg['remote_model_manifest'],
                '--commit',commit,'--booted-at',booted],'dispatch',timeout=120))
            dump_new(cfg['operations']/'launch.json',result);emit('controller_dispatched',**result)
            for _ in range(30):
                raw=remote_bytes(sftp,cfg['remote_run']+'/opening.json',setup)
                if raw: break
                time.sleep(1)
            else: raise ValueError('opening absent; inspect existing process, never retry')
            opening=json.loads(raw);bind=validate_opening(opening,plan)
            if bind['code_commit']!=commit or bind['trial_started_at_utc']!=result['trial_started_at_utc'] or bind['booted_at_proxy']!=booted:
                raise ValueError('I2 launch binding differs')
            dump_new(cfg['operations']/'opening.json',opening)
            outcome=collect(sftp,cfg,plan,opening,TimeBudget(aware(bind['collection_cutoff'])),emit)
            emit('collector_finished',result=outcome);return outcome
    except BaseException as error:
        emit('collector_stopped',error_type=type(error).__name__,message=str(error),
             independent_guard_verified=armed,dispatch_may_have_started=dispatch_issued,
             no_automatic_reconnect=True,provider_power_state='unknown',provider_billing_stopped='unknown')
        # Known pre-dispatch failure: promptly stop authorized rental, but never
        # turn an unknown dispatch result into a second launch or changed conditions.
        if armed and not dispatch_issued and client.get_transport() and client.get_transport().is_active():
            try:
                cleanup=Remote(client,cfg['operations'],TimeBudget(hard),emit)
                emit('setup_abort_shutdown_requested')
                cleanup.run([cfg['bootstrap_python'],str(directory/'i2_setup.py'),'--abort-setup',
                             '--ops',str(ops),'--booted-at',booted],'setup-abort-shutdown',timeout=30)
            except Exception as closing_error: emit('setup_abort_return_unobserved',error_type=type(closing_error).__name__)
        raise
    finally:
        password=None;client.close();timer.cancel()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('stage','verify-stage','execute','prepare-instance','compact'):p.add_argument('--'+n,action='store_true')
    for n in ('stage-dir','config','diagnostic-dir','d2-dir','tokenizer-dir','i1-run-dir','prepared'):p.add_argument('--'+n,type=Path)
    for n in ('commit','ref','run-id','booted-at'):p.add_argument('--'+n)
    a=p.parse_args()
    if sum((a.stage,a.verify_stage,a.execute,a.prepare_instance))!=1:p.error('one explicit action required')
    if a.compact and not a.stage:p.error('--compact only describes offline packaging')
    if a.prepared and not a.execute:p.error('--prepared is for the later GPU opening')
    if a.stage: result=stage(a.stage_dir,a.commit,a.ref,a.diagnostic_dir,a.d2_dir,a.tokenizer_dir,a.i1_run_dir,compact=a.compact)
    elif a.verify_stage:
        _,s=verify_stage(a.stage_dir);result={'offline_only':True,'gpu_calls':0,'commit':s['commit']}
    elif a.prepare_instance: result=prepare_instance(a.stage_dir,a.config,a.run_id,a.booted_at)
    else: result=execute(a.stage_dir,a.config,a.run_id,a.booted_at,a.prepared)
    print(json.dumps(result))
