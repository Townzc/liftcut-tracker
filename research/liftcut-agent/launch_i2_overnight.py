"""One I2 trial inside an explicitly authorized, already guarded overnight lease.

Only a small Git delta is uploaded. The genuine no-GPU preparation and its data
remain immutable. Unknown outcomes never trigger a second dispatch or shutdown.
"""
import argparse
from datetime import timedelta
import getpass
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import threading
import time

from d2_execution import read,utcnow,event_file
from i2_protocol import ROOT,EXECUTION,binding,deadlines,validate_opening,verify_plan
from i2_setup import active_workers,verify_installation,safe_ops
from launch_i2 import parse_config,preparation_receipt,collect
from launch_g3_remote import Remote,upload_verified
from monitor_coverage_replication import TimeBudget,remote_bytes
from research_lease import validate,verify_live
from server_workspace import command,dump_new,sha256
from liftcut_agent.interactive import digest

BASE='32fbbac18d48493a8f37221a3e4b090e3b431cf2'
PERSIST=PurePosixPath('/root/autodl-tmp/liftcut')


def event_writer(path):
    # Upload events carry a `name` payload (the filename). Do not name the first
    # positional argument `name`, or transport stops before writing any bytes.
    def emit(event,**fields):
        event_file(path,event,**fields)
        print(json.dumps({'event':event,**fields}),flush=True)
    return emit


def science_unchanged(previous,current):
    if ({k:v for k,v in previous.items() if k!='source_sha256'}
            != {k:v for k,v in current.items() if k!='source_sha256'}):
        raise ValueError('overnight adaptation must not change I2 science or trial budget')


def stage(output,commit,ref,prepared_path,old_stage,lease_path):
    plan=verify_plan();lease=read(lease_path);validate(lease)
    previous=json.loads(command(['git','show',BASE+':research/liftcut-agent/reports/i2-execution-v1.json'],ROOT))
    science_unchanged(previous,plan)
    spec=read(old_stage/'stage.json')
    prepared=preparation_receipt(prepared_path,previous,spec)
    if (spec['commit']!=BASE or output.exists() or command(['git','rev-parse',ref],ROOT)!=commit
            or command(['git','diff',commit,'--','.'],ROOT) or command(['git','status','--porcelain','--','.'],ROOT)):
        raise ValueError('fresh stage and clean reviewed execution commit required')
    output.mkdir(parents=True)
    command(['git','bundle','create',str((output/'code.bundle').resolve()),ref,'^'+BASE],ROOT)
    command(['git','bundle','verify',str((output/'code.bundle').resolve())],ROOT)
    shutil.copyfile(ROOT/'d2_bundle.py',output/'d2_bundle.py')
    value={'version':'i2-overnight-stage-v1','commit':commit,'base':BASE,
        'execution_plan_sha256':sha256(EXECUTION),'power_lease':lease,
        'prepared':prepared,'prepared_sha256':sha256(prepared_path),
        'files':{p.name:{'bytes':p.stat().st_size,'sha256':sha256(p)} for p in output.iterdir()},
        'asset_upload_bytes':0,'science_unchanged':True}
    dump_new(output/'stage.json',value);return value


def verify_stage(directory):
    spec=read(directory/'stage.json');verify_plan();validate(spec['power_lease'])
    if (spec['version']!='i2-overnight-stage-v1' or spec['base']!=BASE
            or spec['execution_plan_sha256']!=sha256(EXECUTION)
            or set(spec['files'])!={'code.bundle','d2_bundle.py'} or spec['asset_upload_bytes']!=0):
        raise ValueError('overnight staged evidence differs')
    for name,item in spec['files'].items():
        p=directory/name
        if p.is_symlink() or p.stat().st_size!=item['bytes'] or sha256(p)!=item['sha256']:
            raise ValueError('staged Git delta changed')
    if sha256(directory/'d2_bundle.py')!=sha256(ROOT/'d2_bundle.py'):raise ValueError('bootstrap differs')
    return spec


def dispatch(commit,run_id,prepared_path,lease_path,model,model_manifest):
    from research_lease import aware
    if os.name!='posix' or not re.fullmatch(r'\d{8}-\d{6}',run_id):raise ValueError('unique Linux dispatch required')
    lease=verify_live(lease_path);plan=verify_plan();prepared=read(prepared_path)
    if (prepared['commit']!=BASE or prepared['status']!='ready_for_gpu_preflight'
            or prepared['model_calls']!=0 or prepared['model_result'] is not False):
        raise ValueError('genuine CPU preparation required')
    base=Path(PERSIST/'code'/BASE)
    previous=json.loads(command(['git','show',BASE+':research/liftcut-agent/reports/i2-execution-v1.json'],base))
    science_unchanged(previous,plan)
    if active_workers() or command(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],ROOT):
        raise ValueError('existing controller or GPU process: inspect, no duplicate')
    data=Path(prepared['paths']['data']);index=Path(prepared['paths']['stage'])/'asset-index.json'
    checked=verify_installation(data,model,model_manifest,commit,index)
    if checked['asset_index_sha256']!=prepared['installation']['asset_index_sha256']:
        raise ValueError('prepared input bytes changed')
    start=utcnow().isoformat();boot=lease['booted_at_proxy']
    _,_,hard=deadlines(boot,start,utcnow(),power_lease=lease)
    ops=Path(PERSIST/'runs'/('i2-ops-'+run_id));run=ops.with_name('i2-run-'+run_id);safe_ops(ops)
    if ops.exists() or run.exists():raise ValueError('run outcome may exist; inspect')
    # Exactly one I2 dispatch per power lease, before any process can start.
    dump_new(lease_path.with_name('i2-dispatch-reservation.json'),
        {'commit':commit,'run':str(run),'started_at_utc':start,'booted_at_proxy':boot})
    ops.mkdir();dump_new(ops/'installation.json',checked)
    dump_new(ops/'guard.json',{'version':'i2-overnight-guard-v1','hard_cutoff':hard.isoformat(),
        'power_lease':lease,'lease_path':str(lease_path)})
    argv=[str(os.sys.executable),str(ROOT/'run_i2_window.py'),'--model-dir',str(model),
        '--model-manifest',str(model_manifest),'--diagnostic-dir',str(data/'diagnostic'),
        '--d2-dir',str(data/'d2'),'--tokenizer-dir',str(data/'tokenizer'),'--reference-dir',str(data/'reference'),
        '--output-dir',str(run),'--expected-code-commit',commit,'--booted-at',boot,
        '--trial-started-at',start,'--guard-path',str(ops/'guard.json'),'--power-lease',str(lease_path),'--execute']
    with (ops/'controller.log').open('x') as log:
        child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    result={'pid':child.pid,'argv':argv,'trial_started_at_utc':start,'booted_at_proxy':boot}
    dump_new(ops/'controller-launch.json',result);return result


def execute(directory,config_file,run_id,lease_path):
    spec=verify_stage(directory);plan=verify_plan();cfg=parse_config(read(config_file));lease=spec['power_lease']
    validate(lease,utcnow());commit=spec['commit']
    if not re.fullmatch(r'\d{8}-\d{6}',run_id):raise ValueError('actual unique UTC run ID required')
    remote_lease=PurePosixPath(lease_path)
    if (remote_lease.parent.parent!=PERSIST/'ops' or remote_lease.name!='lease.json'
            or not re.fullmatch(r'overnight-\d{8}-\d{6}',remote_lease.parent.name)):
        raise ValueError('canonical original lease path required')
    deadlines(lease['booted_at_proxy'],utcnow().isoformat(),utcnow(),power_lease=lease)
    setup=TimeBudget(utcnow()+timedelta(minutes=10))
    subprocess.run([str(cfg['restore_python']),str(ROOT/'i2_protocol.py'),'--verify',
        '--diagnostic-dir',str(cfg['diagnostic']),'--d2-dir',str(cfg['d2']),'--tokenizer-dir',str(cfg['tokenizer'])],check=True,timeout=90)
    dump_new(ROOT/'outputs/autodl'/('i2-night-reservation-'+digest(lease)[:20]+'.json'),
        {'run_id':run_id,'commit':commit,'local_pid':os.getpid(),'power_lease':lease})
    for key in ('operations','downloads','restored'):
        cfg[key]=ROOT/'outputs/autodl'/('i2-'+run_id+'-'+key);cfg[key].mkdir(parents=True,exist_ok=False)
    cfg['remote_run']=str(PERSIST/'runs'/('i2-run-'+run_id))
    dump_new(cfg['operations']/'config.json',{k:str(v) if isinstance(v,Path) else v for k,v in cfg.items()})
    dump_new(cfg['operations']/'stage.json',spec)
    emit=event_writer(cfg['operations']/'events.jsonl')
    emit('exclusive_local_dispatch_reserved',pid=os.getpid(),booted_at_proxy=lease['booted_at_proxy'])
    import paramiko
    client=paramiko.SSHClient();client.load_host_keys(str(cfg['known_hosts']));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    timer=threading.Timer(100*60,client.close);timer.daemon=True;timer.start()
    password=getpass.getpass('I2 overnight password (not stored): ');issued=False
    try:
        client.connect(cfg['ssh_host'],port=cfg['ssh_port'],username=cfg['ssh_user'],password=password,
            look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15,banner_timeout=15)
        password=None;emit('ssh_connected');remote=Remote(client,cfg['operations'],setup,emit)
        py=cfg['bootstrap_python'];checkout=PERSIST/'code'/commit;remote_stage=PERSIST/'staging'/('i2-night-'+run_id)
        prepared=spec['prepared'];prepared_path=prepared['paths']['ops']+'/prepared.json'
        with client.open_sftp() as sftp:
            import hashlib
            raw=remote_bytes(sftp,prepared_path,setup)
            if raw is None or hashlib.sha256(raw).hexdigest()!=spec['prepared_sha256'] or json.loads(raw)!=prepared:
                raise ValueError('genuine preparation receipt changed')
            raw=remote_bytes(sftp,str(remote_lease),setup)
            if raw is None or json.loads(raw)!=lease:raise ValueError('original authorized power lease differs')
            code='import sys,json;sys.path.insert(0,'+repr(str(remote_lease.parent))+');from research_lease import verify_live;print(json.dumps(verify_live('+repr(str(remote_lease))+')))'
            if json.loads(remote.run([py,'-c',code],'verify-original-power-guard'))!=lease:raise ValueError('power lease differs')
            code='from pathlib import Path;Path('+repr(str(remote_stage))+').mkdir(parents=True,exist_ok=False)'
            remote.run([py,'-c',code],'create-new-code-stage')
            def remote_hash(path):
                code='import hashlib;from pathlib import Path;print(hashlib.sha256(Path('+repr(path)+').read_bytes()).hexdigest())'
                return remote.run([py,'-c',code],'hash-upload').strip()
            for name in spec['files']:upload_verified(directory/name,str(remote_stage/name),sftp,remote_hash,setup,emit)
            code=('import sys,json;sys.path.insert(0,'+repr(str(remote_stage))+');from d2_bundle import install_bundle;print(json.dumps(install_bundle('
                +repr(str(remote_stage/'code.bundle'))+','+repr(str(checkout))+','+repr(commit)+','+repr(str(PERSIST/'code'/BASE))+','+repr(BASE)+')))')
            remote.run([py,'-c',code],'install-code-delta',timeout=120)
            issued=True;emit('controller_dispatch_issued',automatic_retry=False,asset_upload_bytes=0)
            result=json.loads(remote.run([cfg['remote_python'],str(checkout/'research/liftcut-agent/launch_i2_overnight.py'),
                '--dispatch','--commit',commit,'--run-id',run_id,'--prepared',prepared_path,'--lease',str(remote_lease),
                '--model',cfg['remote_model'],'--model-manifest',cfg['remote_model_manifest']],'dispatch',timeout=180))
            dump_new(cfg['operations']/'launch.json',result);emit('controller_dispatched',**result)
            for _ in range(30):
                raw=remote_bytes(sftp,cfg['remote_run']+'/opening.json',setup)
                if raw:break
                time.sleep(1)
            else:raise ValueError('opening absent; inspect actual process, no retry')
            opening=json.loads(raw);bind=validate_opening(opening,plan)
            if (bind['code_commit']!=commit or bind.get('power_lease')!=lease
                    or bind['trial_started_at_utc']!=result['trial_started_at_utc']):raise ValueError('actual launch binding differs')
            dump_new(cfg['operations']/'opening.json',opening)
            from research_lease import aware
            outcome=collect(sftp,cfg,plan,opening,TimeBudget(aware(bind['collection_cutoff'])),emit)
            emit('collector_finished',result=outcome);return outcome
    except BaseException as error:
        emit('collector_stopped',error_type=type(error).__name__,message=str(error),dispatch_may_have_started=issued,
             no_automatic_retry=True,original_power_guard_retained=True)
        raise
    finally:password=None;client.close();timer.cancel()


if __name__=='__main__':
    p=argparse.ArgumentParser(allow_abbrev=False)
    g=p.add_mutually_exclusive_group(required=True)
    for name in ('stage','execute','dispatch'):g.add_argument('--'+name,action='store_true')
    for name in ('stage-dir','config','prepared','old-stage','model','model-manifest'):p.add_argument('--'+name,type=Path)
    for name in ('lease','commit','ref','run-id'):p.add_argument('--'+name)
    a=p.parse_args()
    if a.stage:result=stage(a.stage_dir,a.commit,a.ref,a.prepared,a.old_stage,Path(a.lease))
    elif a.execute:result=execute(a.stage_dir,a.config,a.run_id,a.lease)
    else:result=dispatch(a.commit,a.run_id,a.prepared,Path(a.lease),a.model,a.model_manifest)
    print(json.dumps(result))
