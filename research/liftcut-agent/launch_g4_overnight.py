"""Single G4 dispatch/collector within the already-armed continuous power lease.

Offline staging is separate. Unknown launch/transfer outcomes are inspected, never
retried automatically. Credentials live only in getpass memory. No new power guard.
"""
import argparse
from contextlib import closing
from datetime import timedelta
import getpass
import json
import os
from pathlib import Path,PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import threading
import time
import uuid

from g4_execution import ROOT,EXECUTION,LEASE_DIR,BUDGET,aware,utcnow,verify_plan,verify_live_lease,deadlines,validate_opening
from d2_execution import event_file,read
from g4_receipt_transfer import validate_index,validate_receipt,transfer_receipt
from launch_g3_remote import Remote,upload_verified
from monitor_coverage_replication import TimeBudget,io_budget,remote_bytes,json_lines,persist_json
from server_workspace import command,dump_new,sha256

PERSIST=PurePosixPath('/root/autodl-tmp/liftcut')
BASE='eaa132538fefdf28973d808dd56a159e19b86d67'
PYTHON=str(PERSIST/'envs/qwen-pilot-py312/bin/python')
SHARED=Path(PERSIST/'data/g3-eaa1325')  # Used only inside the Linux dispatch function.


def stage(output,prepared,commit,ref):
    plan=verify_plan(prepared)
    if (output.exists() or not re.fullmatch(r'[0-9a-f]{40}',commit)
            or command(['git','rev-parse',ref],ROOT)!=commit
            or command(['git','diff',commit,'--','.'],ROOT)
            or command(['git','status','--porcelain','--','.'],ROOT)
            or command(['git','merge-base',BASE,commit],ROOT)!=BASE):
        raise ValueError('fresh output and exact clean research commit required')
    output.mkdir(parents=True)
    command(['git','bundle','create',str((output/'code.bundle').resolve()),ref,'^'+BASE],ROOT)
    command(['git','bundle','verify',str((output/'code.bundle').resolve())],ROOT)
    inventory={}
    with tarfile.open(output/'prepared.tar.gz','w:gz') as tar:
        for p in sorted(prepared.rglob('*')):
            if p.is_symlink():raise ValueError('no symlink assets')
            if p.is_file():
                name=p.relative_to(prepared).as_posix()
                inventory[name]={'bytes':p.stat().st_size,'sha256':sha256(p)}
                tar.add(p,arcname=name,recursive=False)
    dump_new(output/'asset-index.json',inventory)
    shutil.copyfile(ROOT/'d2_bundle.py',output/'d2_bundle.py')
    spec={'commit':commit,'base':BASE,'execution_plan_sha256':sha256(EXECUTION),
          'files':{p.name:{'bytes':p.stat().st_size,'sha256':sha256(p)} for p in output.iterdir()},
          'lease_configuration_digest':plan['lease_configuration_digest']}
    dump_new(output/'stage.json',spec)
    return spec


def install_assets(archive,index,destination):
    """Extract only announced regular files; bounded and fresh, no links/traversal."""
    if destination.exists() or not index or len(index)>80 or sum(x['bytes'] for x in index.values())>256_000_000:
        raise ValueError('fresh bounded G4 asset destination required')
    destination.mkdir(parents=True)
    with tarfile.open(archive,'r:gz') as tar:
        members=tar.getmembers()
        if len(members)!=len(index) or {m.name for m in members}!=set(index):raise ValueError('asset inventory differs')
        for m in members:
            path=destination/m.name
            if (not m.isfile() or not path.resolve().is_relative_to(destination.resolve())
                    or m.size!=index[m.name]['bytes']):raise ValueError('unsafe asset member')
            path.parent.mkdir(parents=True,exist_ok=True)
            with tar.extractfile(m) as source,path.open('xb') as sink:shutil.copyfileobj(source,sink)
            if sha256(path)!=index[m.name]['sha256']:raise ValueError('asset SHA differs')


def active_workers():
    found=[]
    for p in Path('/proc').glob('[0-9]*'):
        if int(p.name)==os.getpid():continue
        try:argv=(p/'cmdline').read_bytes().split(b'\0')
        except (FileNotFoundError,ProcessLookupError):continue
        names={Path(x.decode(errors='replace')).name for x in argv[:3]}
        if any(n.startswith(('gpu_train_','gpu_g','run_g')) and n.endswith('.py') for n in names):found.append(int(p.name))
    return found


def dispatch(prepared,commit,run_id):
    if sys.platform!='linux' or not re.fullmatch(r'[0-9]{8}-[0-9]{6}',run_id):raise ValueError('Linux unique run ID required')
    plan=verify_plan(prepared);verify_live_lease(plan)
    if command(['git','rev-parse','HEAD'],ROOT)!=commit or command(['git','status','--porcelain'],ROOT):
        raise ValueError('clean exact G4 checkout required')
    if active_workers():raise ValueError('another controller/worker is active')
    if command(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],ROOT):
        raise ValueError('GPU is not idle')
    import importlib.metadata
    import platform
    from d2_execution import expected_runtime
    expected=expected_runtime()
    if (platform.python_version()!=expected['python'] or any(importlib.metadata.version(k)!=v
            for k,v in expected['packages'].items())):raise ValueError('pinned runtime changed')
    from gpu_counterfactual_diagnostics import verify_model
    from prepare_state_diagnostics import verify_prepared as diagnostic
    from prepare_counterfactual_diagnostics import verify_prepared as d2,load_tokenizer
    historical=read(Path(PERSIST/'runs/g3-ops-20261003-053547/controller-launch.json'))['argv']
    get=lambda flag:Path(historical[historical.index(flag)+1])
    model,manifest=get('--model-dir'),get('--model-manifest')
    verify_model(model,manifest);diagnostic(SHARED/'diagnostic');d2(SHARED/'d2');load_tokenizer(SHARED/'tokenizer')
    now=utcnow();deadlines(now.isoformat(),now)
    run=Path(PERSIST/'runs'/('g4-run-'+run_id));ops=Path(PERSIST/'runs'/('g4-ops-'+run_id))
    if run.exists() or ops.exists():raise ValueError('run already exists; inspect, never relaunch')
    # One durable dispatch reservation for this entire lease, including unknown outcome.
    dump_new(LEASE_DIR/'g4-dispatch-reservation.json',{'commit':commit,'run':str(run),'at_utc':now.isoformat()})
    ops.mkdir()
    argv=[sys.executable,str(ROOT/'run_g4_window.py'),'--model-dir',str(model),'--model-manifest',str(manifest),
          '--prepared-dir',str(prepared),'--diagnostic-dir',str(SHARED/'diagnostic'),'--d2-dir',str(SHARED/'d2'),
          '--tokenizer-dir',str(SHARED/'tokenizer'),'--output-dir',str(run),'--expected-code-commit',commit,
          '--trial-started-at',now.isoformat(),'--execute']
    with (ops/'controller.log').open('x') as log:
        process=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    record={'pid':process.pid,'argv':argv,'trial_started_at_utc':now.isoformat(),'instance_boot':BUDGET['instance_boot']}
    dump_new(ops/'controller-launch.json',record)
    return record


def download(sftp,path,item,cfg,budget,emit):
    if (type(item['bytes']) is not int or not 0<item['bytes']<=512_000_000
            or not re.fullmatch(r'[0-9a-f]{64}',item['sha256'])):raise ValueError('invalid archive bounds')
    target=cfg['downloads']/Path(path).name
    if target.exists():
        if target.stat().st_size!=item['bytes'] or sha256(target)!=item['sha256']:raise ValueError('existing archive differs')
        return target
    remote=cfg['remote_run']+'/'+path;io_budget(sftp,budget);info=sftp.lstat(remote)
    if not stat.S_ISREG(info.st_mode) or info.st_size!=item['bytes']:raise ValueError('remote archive size/type differs')
    partial=target.with_name(target.name+'.'+uuid.uuid4().hex+'.partial');offset=0
    with closing(sftp.open(remote,'rb')) as source,partial.open('xb') as sink:
        while offset<item['bytes']:
            chunks=[(p,min(65536,item['bytes']-p)) for p in range(offset,min(offset+8*65536,item['bytes']),65536)]
            io_budget(sftp,budget)
            received=list(source.readv(chunks))
            if len(received)!=len(chunks) or any(len(b)!=n for b,(_,n) in zip(received,chunks)):
                raise ValueError('bounded readv truncated')
            for data in received:sink.write(data);offset+=len(data)
        source.seek(item['bytes']);io_budget(sftp,budget)
        if source.read(1):raise ValueError('archive grew')
    if sha256(partial)!=item['sha256'] or target.exists():raise ValueError('archive integrity/race failure')
    partial.rename(target);emit('archive_bytes_verified',archive=target.name,bytes=item['bytes'],sha256=item['sha256'])
    return target


def collect(sftp,cfg,plan,opening,budget,emit):
    bind=validate_opening(opening,plan);sent=None;seen={};last=None
    while budget.remaining()>0:
        raw=remote_bytes(sftp,cfg['remote_run']+'/events.jsonl',budget,tail=True)
        (cfg['operations']/'server-events-latest.jsonl').write_bytes(raw or b'')
        rows=json_lines(raw)
        if rows and rows[-1]!=last:last=rows[-1];emit('server_event',record=last)
        if sent is None:
            for row in json_lines(remote_bytes(sftp,cfg['remote_run']+'/early-index.jsonl',budget)):
                arm=row['arm']
                if arm not in ('control','permuted') or row['binding']!=bind or row['path']!='training/'+arm+'.tar.gz':
                    raise ValueError('early archive binding differs')
                if arm in seen and seen[arm]!=row:raise ValueError('early archive changed')
                download(sftp,row['path'],row,cfg,budget,emit);seen[arm]=row
            raw=remote_bytes(sftp,cfg['remote_run']+'/backup-index.json',budget)
            if raw:
                index=json.loads(raw);validate_index(index,bind)
                persist_json(cfg['downloads']/'backup-index.json',index)
                for item in index['archives']:
                    if item['part'] in seen and any(item[k]!=seen[item['part']][k] for k in ('path','bytes','sha256')):
                        raise ValueError('final archive changed')
                    download(sftp,item['path'],item,cfg,budget,emit)
                output=cfg['restored']/uuid.uuid4().hex
                argv=[str(cfg['restore_python']),str(ROOT/'restore_g4.py'),'--archive-dir',str(cfg['downloads']),
                      '--output-dir',str(output),'--allow-partial']
                for key,flag in [('prepared','prepared-dir'),('diagnostic','diagnostic-dir'),('d2','d2-dir'),('tokenizer','tokenizer-dir')]:
                    argv+=['--'+flag,str(cfg[key])]
                emit('restore_started',output=str(output))
                with (cfg['operations']/'restore.log').open('x',encoding='utf-8') as log:
                    subprocess.run(argv,check=True,timeout=max(1,budget.remaining()-60),stdout=log,stderr=subprocess.STDOUT)
                receipt=output/'off-instance-backup.json';actual=validate_receipt(receipt.read_bytes(),index,bind)
                emit('off_instance_verified',receipt=actual)
                sent=transfer_receipt(sftp,receipt,cfg['remote_run'],index,bind,budget.deadline,now=budget.now,emit=emit)
                if sent['status'] not in ('published','already_present'):return sent
        raw=remote_bytes(sftp,cfg['remote_run']+'/backup-copy-status.json',budget)
        if raw:
            status=json.loads(raw);persist_json(cfg['operations']/'backup-copy-status.json',status)
            emit('server_receipt_observed',value=status)
            return {'receipt_transfer':sent,'server_consumed':status['off_instance_acknowledged'],
                    'server_intentionally_on':True,'provider_billing_stopped':False}
        time.sleep(min(5 if sent else 20,budget.remaining()))
    return {'status':'original_collection_deadline_reached','receipt_transfer':sent}


def execute(stage_dir,config_file,run_id):
    cfg=read(config_file);spec=read(stage_dir/'stage.json');commit=spec['commit']
    if not re.fullmatch(r'[0-9]{8}-[0-9]{6}',run_id):raise ValueError('unique run ID required')
    for key in ('prepared','diagnostic','d2','tokenizer','restore_python','known_hosts'):
        cfg[key]=Path(cfg[key]).expanduser().resolve()
    # Offline/tokenizer validation runs in its pinned interpreter, not transport Python.
    subprocess.run([str(cfg['restore_python']),str(ROOT/'g4_execution.py'),'--prepared-dir',str(cfg['prepared'])],check=True,timeout=90)
    plan=verify_plan(cfg['prepared'])
    if spec['execution_plan_sha256']!=sha256(EXECUTION):raise ValueError('stage plan changed')
    for name,item in spec['files'].items():
        if Path(name).name!=name or sha256(stage_dir/name)!=item['sha256'] or (stage_dir/name).stat().st_size!=item['bytes']:
            raise ValueError('staged file changed')
    cfg['remote_run']=str(PERSIST/'runs'/('g4-run-'+run_id))
    for key in ('operations','downloads','restored'):
        cfg[key]=ROOT/'outputs/autodl'/('g4-'+run_id+'-'+key);cfg[key].mkdir(parents=True,exist_ok=False)
    (cfg['operations']/'monitor.lock').write_text(str(os.getpid()),encoding='utf-8')
    dump_new(cfg['operations']/'config.json',{k:str(v) if isinstance(v,Path) else v for k,v in cfg.items()})
    emit=lambda event,**kw:(event_file(cfg['operations']/'events.jsonl',event,**kw),print(json.dumps({'event':event,**kw}),flush=True))
    import paramiko
    client=paramiko.SSHClient();client.load_host_keys(str(cfg['known_hosts']));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    setup=TimeBudget(min(utcnow()+timedelta(minutes=12),aware(BUDGET['work_latest'])-timedelta(minutes=95)))
    setup.check();timer=threading.Timer(max(1,(aware(BUDGET['collection_latest'])-utcnow()).total_seconds()),client.close)
    timer.daemon=True;timer.start()
    password=getpass.getpass('G4 AutoDL password (not stored): ')
    try:
        client.connect(cfg['ssh_host'],port=cfg['ssh_port'],username=cfg['ssh_user'],password=password,
                       look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15,banner_timeout=15)
        password=None;emit('ssh_connected')
        remote=Remote(client,cfg['operations'],setup,emit);directory=PERSIST/'staging'/('g4-'+run_id)
        checkout=PERSIST/'code'/commit;data=PERSIST/'data'/('g4-'+commit[:12])
        with client.open_sftp() as sftp:
            sftp.mkdir(str(directory))
            def rh(path):
                return remote.run([PYTHON,'-c',"import hashlib;from pathlib import Path;p=Path("+repr(path)+");print(hashlib.file_digest(p.open('rb'),'sha256').hexdigest())"],'hash').strip()
            for name in spec['files']:upload_verified(stage_dir/name,str(directory/name),sftp,rh,setup,emit)
            install="import sys;sys.path.insert(0,"+repr(str(directory))+ ");from d2_bundle import install_bundle;print(install_bundle("+repr(str(directory/'code.bundle'))+','+repr(str(checkout))+','+repr(commit)+','+repr(str(PERSIST/'code'/BASE))+','+repr(BASE)+'))'
            remote.run([PYTHON,'-c',install],'install-code',timeout=180)
            bootstrap="import sys,json;from pathlib import Path;sys.path.insert(0,"+repr(str(checkout/'research/liftcut-agent'))+");from launch_g4_overnight import install_assets;install_assets(Path("+repr(str(directory/'prepared.tar.gz'))+"),json.loads(Path("+repr(str(directory/'asset-index.json'))+").read_text()),Path("+repr(str(data))+"));print('assets_verified')"
            remote.run([PYTHON,'-c',bootstrap],'install-data',timeout=180)
            result=json.loads(remote.run([PYTHON,str(checkout/'research/liftcut-agent/launch_g4_overnight.py'),
                              '--dispatch','--prepared-dir',str(data),'--commit',commit,'--run-id',run_id],'dispatch',timeout=120))
            dump_new(cfg['operations']/'launch.json',result);emit('controller_dispatched',**result)
            for _ in range(30):
                raw=remote_bytes(sftp,cfg['remote_run']+'/opening.json',setup)
                if raw:break
                time.sleep(1)
            else:raise ValueError('opening absent; inspect existing dispatch, no retry')
            opening=json.loads(raw);bind=validate_opening(opening,plan)
            if bind['code_commit']!=commit or bind['trial_started_at_utc']!=result['trial_started_at_utc']:
                raise ValueError('remote launch binding differs')
            dump_new(cfg['operations']/'opening.json',opening)
            outcome=collect(sftp,cfg,plan,opening,TimeBudget(aware(bind['collection_cutoff'])),emit)
            emit('collector_finished',result=outcome);return outcome
    except Exception as error:
        emit('collector_stopped',error_type=type(error).__name__,message=str(error),no_automatic_reconnect=True)
        raise
    finally:
        password=None;client.close();timer.cancel()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--dispatch',action='store_true');p.add_argument('--stage',action='store_true');p.add_argument('--execute',action='store_true')
    for name in ('prepared-dir','stage-dir','config'):p.add_argument('--'+name,type=Path)
    for name in ('commit','ref','run-id'):p.add_argument('--'+name)
    a=p.parse_args()
    if sum((a.dispatch,a.stage,a.execute))!=1:p.error('select exactly one action')
    result=dispatch(a.prepared_dir,a.commit,a.run_id) if a.dispatch else stage(a.stage_dir,a.prepared_dir,a.commit,a.ref) if a.stage else execute(a.stage_dir,a.config,a.run_id)
    print(json.dumps(result))
