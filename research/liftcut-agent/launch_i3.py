"""Small Git delta, one I3 dispatch/collector, original overnight power retained."""
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
import uuid

from d2_execution import read,utcnow,aware,event_file
from i3_protocol import ROOT,EXECUTION,PARENT_COMMIT,verify_plan,binding,validate_opening,verify_parent_files
from i3_receipt import validate_index,validate_receipt,transfer_receipt
from launch_i2 import parse_config
from launch_g3_remote import Remote,upload_verified
from launch_g4_overnight import download
from liftcut_agent.interactive import digest
from monitor_coverage_replication import TimeBudget,remote_bytes,json_lines,persist_json
from research_lease import validate
from server_workspace import command,dump_new,sha256

PERSIST=PurePosixPath('/root/autodl-tmp/liftcut')


def remote_lease(value):
    """Remote identifiers stay POSIX strings even when this launcher is on Windows."""
    if not isinstance(value,(str,PurePosixPath)) or '\\' in str(value):
        raise ValueError('remote lease requires a POSIX string, not a local Windows Path')
    p=PurePosixPath(value)
    if str(p)!=str(value) or not p.is_relative_to(PERSIST/'ops') or '..' in p.parts or p.name!='lease.json':
        raise ValueError('canonical original persistent lease path required')
    return str(p)


def stage(output,commit,ref,lease_path):
    verify_plan();lease=read(lease_path);validate(lease)
    if (output.exists() or not re.fullmatch('[0-9a-f]{40}',commit)
            or command(['git','rev-parse',ref],ROOT)!=commit
            or command(['git','diff',commit,'--','.'],ROOT) or command(['git','status','--porcelain','--','.'],ROOT)):
        raise ValueError('new stage for exact clean reviewed research commit required')
    output.mkdir(parents=True)
    command(['git','bundle','create',str((output/'code.bundle').resolve()),ref,'^'+PARENT_COMMIT],ROOT)
    command(['git','bundle','verify',str((output/'code.bundle').resolve())],ROOT)
    shutil.copyfile(ROOT/'d2_bundle.py',output/'d2_bundle.py')
    spec={'version':'i3-stage-v1','commit':commit,'base':PARENT_COMMIT,'execution_plan_sha256':sha256(EXECUTION),
          'power_lease':lease,'asset_upload_bytes':0,
          'files':{p.name:{'bytes':p.stat().st_size,'sha256':sha256(p)} for p in output.iterdir()}}
    dump_new(output/'stage.json',spec);return spec


def verify_stage(directory):
    spec=read(directory/'stage.json');verify_plan();validate(spec['power_lease'])
    if (spec['version']!='i3-stage-v1' or spec['base']!=PARENT_COMMIT
            or spec['execution_plan_sha256']!=sha256(EXECUTION) or spec['asset_upload_bytes']!=0
            or set(spec['files'])!={'code.bundle','d2_bundle.py'}):raise ValueError('I3 stage binding differs')
    for n,v in spec['files'].items():
        p=directory/n
        if p.is_symlink() or p.stat().st_size!=v['bytes'] or sha256(p)!=v['sha256']:raise ValueError('I3 stage bytes differ')
    if sha256(directory/'d2_bundle.py')!=sha256(ROOT/'d2_bundle.py'):raise ValueError('bootstrap differs')
    return spec


def configure(raw,run_id):
    if not re.fullmatch(r'\d{8}-\d{6}',run_id):raise ValueError('new actual UTC run ID required')
    extras={'parent_run_local','parent_receipt_local','parent_index_local','remote_parent_run','remote_data'}
    if not extras<=set(raw):raise ValueError('all actual parent evidence paths required')
    cfg=parse_config({k:v for k,v in raw.items() if k not in extras})
    for n in ('parent_run_local','parent_receipt_local','parent_index_local'):
        cfg[n]=Path(raw[n]).resolve(strict=True)
    for n in ('remote_parent_run','remote_data'):
        p=PurePosixPath(raw[n])
        if not p.is_relative_to(PERSIST) or '..' in p.parts or str(p)!=raw[n] or '\\' in raw[n]:
            raise ValueError('canonical persistent I3 input paths required')
        cfg[n]=str(p)
    cfg['remote_run']=str(PERSIST/'runs'/('i3-run-'+run_id))
    cfg['remote_ops']=str(PERSIST/'runs'/('i3-ops-'+run_id))
    for name in ('operations','downloads','restored'):cfg[name]=ROOT/'outputs/autodl'/('i3-'+run_id+'-'+name)
    return cfg


def collect(sftp,cfg,plan,opening,budget,emit):
    b=validate_opening(opening,plan);sent=None;last=None;consumed=None
    while budget.remaining()>0:
        raw=remote_bytes(sftp,cfg['remote_run']+'/events.jsonl',budget,tail=True)
        (cfg['operations']/'server-events-latest.jsonl').write_bytes(raw or b'')
        rows=json_lines(raw)
        if rows and rows[-1]!=last:last=rows[-1];emit('server_event',record=last)
        if sent is None:
            raw=remote_bytes(sftp,cfg['remote_run']+'/backup-index.json',budget)
            if raw:
                index=json.loads(raw);validate_index(index,b)
                persist_json(cfg['downloads']/'backup-index.json',index)
                for item in index['archives']:download(sftp,item['path'],item,cfg,budget,emit)
                output=cfg['restored']/uuid.uuid4().hex
                argv=[str(cfg['restore_python']),str(ROOT/'restore_i3.py'),'--archive-dir',str(cfg['downloads']),
                      '--output-dir',str(output),'--allow-partial']
                for key,flag in (('d2','d2-dir'),('tokenizer','tokenizer-dir'),('parent_run_local','parent-run'),
                                 ('parent_receipt_local','parent-receipt'),('parent_index_local','parent-index')):
                    argv+=['--'+flag,str(cfg[key])]
                emit('restore_started',output=str(output))
                with (cfg['operations']/'restore.log').open('x',encoding='utf-8') as log:
                    subprocess.run(argv,check=True,timeout=max(1,budget.remaining()-30),stdout=log,stderr=subprocess.STDOUT)
                path=output/'off-instance-backup.json';receipt=validate_receipt(path.read_bytes(),index,b)
                emit('off_instance_verified',receipt=receipt)
                sent=transfer_receipt(sftp,path,cfg['remote_run'],index,b,budget.deadline,now=budget.now,emit=emit)
                if sent['status'] not in ('published','already_present'):return sent
        raw=remote_bytes(sftp,cfg['remote_run']+'/backup-copy-status.json',budget)
        if raw and consumed is None:
            value=json.loads(raw);persist_json(cfg['operations']/'backup-copy-status.json',value)
            consumed=value['off_instance_acknowledged'];emit('server_receipt_observed',value=value)
        raw=remote_bytes(sftp,cfg['remote_run']+'/window-close.json',budget)
        if raw:
            value=json.loads(raw);persist_json(cfg['operations']/'window-close.json',value)
            if (value['power_action']!='retain_under_original_overnight_guard'
                    or value['shutdown_at_utc']!=b['power_lease']['shutdown_at_utc']):raise ValueError('power policy changed')
            # Capture the real consumption event after publishing, even when close
            # appears in this iteration rather than at the next polling cycle.
            latest=remote_bytes(sftp,cfg['remote_run']+'/events.jsonl',budget,tail=True)
            (cfg['operations']/'server-events-latest.jsonl').write_bytes(latest or b'')
            return {'receipt_transfer':sent,'server_consumed':consumed,'window_close':value,
                    'provider_power_state':'intentionally_retained','provider_billing_stopped':False}
        time.sleep(min(3,max(0,budget.remaining())))
    return {'status':'original_collection_deadline_reached','receipt_transfer':sent,'server_consumed':consumed,
            'provider_power_state':'unknown','provider_billing_stopped':'unknown'}


def execute(stage_dir,config_file,run_id,lease_path):
    lease_path=remote_lease(lease_path)
    cfg=configure(read(config_file),run_id);spec=verify_stage(stage_dir);plan=verify_plan();lease=spec['power_lease']
    binding(plan,spec['commit'],lease,utcnow().isoformat())
    verify_parent_files(cfg['parent_run_local'],plan['reference'],cfg['parent_receipt_local'],cfg['parent_index_local'])
    key=digest(lease)[:20]
    reservation=ROOT/'outputs/autodl'/('i3-followup-reservation-'+key+'.json')
    # Reserve before connecting. An unknown outcome must be inspected, never retried.
    dump_new(reservation,{'run_id':run_id,'at_utc':utcnow().isoformat(),'local_pid':os.getpid(),
                          'commit':spec['commit'],'original_power_lease':lease})
    for n in ('operations','downloads','restored'):cfg[n].mkdir(parents=True,exist_ok=False)
    dump_new(cfg['operations']/'config.json',{k:str(v) if isinstance(v,Path) else v for k,v in cfg.items()})
    def emit(event,**fields):
        event_file(cfg['operations']/'events.jsonl',event,**fields)
        print(json.dumps({'event':event,**fields}),flush=True)
    emit('exclusive_local_dispatch_reserved',pid=os.getpid(),commit=spec['commit'],original_power_lease=lease)
    import paramiko
    client=paramiko.SSHClient();client.load_host_keys(str(cfg['known_hosts']));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    password=getpass.getpass('I3 authorized existing instance password (not stored): ')
    setup=TimeBudget(utcnow()+timedelta(minutes=10));timer=threading.Timer(setup.remaining(),client.close);timer.daemon=True;timer.start()
    dispatched=False
    try:
        client.connect(cfg['ssh_host'],port=cfg['ssh_port'],username=cfg['ssh_user'],password=password,
                       look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15,banner_timeout=15)
        password=None;emit('ssh_connected')
        remote=Remote(client,cfg['operations'],setup,emit)
        directory=PERSIST/'staging'/('i3-'+run_id);checkout=PERSIST/'code'/spec['commit'];base=PERSIST/'code'/PARENT_COMMIT
        py=cfg['bootstrap_python']
        live_code='import sys,json;sys.path[:0]='+repr([str(base/'research/liftcut-agent'),str(base/'research/liftcut-agent/src')])+';from research_lease import verify_live;assert verify_live('+repr(str(lease_path))+')=='+repr(lease)+';print(json.dumps({"original_guard_verified":True}))'
        remote.run([py,'-B','-c',live_code],'verify-original-power-guard')
        with client.open_sftp() as sftp:
            remote.run([py,'-c','from pathlib import Path;Path('+repr(str(directory))+').mkdir(exist_ok=False)'],'new-staging-directory')
            def remote_hash(path):
                code='from pathlib import Path;import hashlib;h=hashlib.sha256();f=Path('+repr(path)+').open("rb")\nfor b in iter(lambda:f.read(1048576),b""):h.update(b)\nprint(h.hexdigest())'
                return remote.run([py,'-c',code],'hash').strip()
            for name in spec['files']:upload_verified(stage_dir/name,str(directory/name),sftp,remote_hash,setup,emit)
            code='import sys;sys.path.insert(0,'+repr(str(directory))+');from d2_bundle import install_bundle;print(install_bundle('+','.join(repr(str(x)) for x in (directory/'code.bundle',checkout,spec['commit'],base,PARENT_COMMIT))+'))'
            remote.run([py,'-c',code],'install-new-checkout',timeout=180)
            args=[cfg['remote_python'],str(checkout/'research/liftcut-agent/run_i3_window.py'),'--dispatch',
                  '--expected-code-commit',spec['commit'],'--model-dir',cfg['remote_model'],'--model-manifest',cfg['remote_model_manifest'],
                  '--d2-dir',str(PurePosixPath(cfg['remote_data'])/'d2'),'--tokenizer-dir',str(PurePosixPath(cfg['remote_data'])/'tokenizer'),
                  '--parent-run',cfg['remote_parent_run'],'--output-dir',cfg['remote_run'],'--ops-dir',cfg['remote_ops'],'--lease',str(lease_path)]
            dispatched=True
            launched=json.loads(remote.run(args,'dispatch',timeout=120));opening=launched['opening']
            b=validate_opening(opening,plan)
            if b['code_commit']!=spec['commit'] or b['power_lease']!=lease:raise ValueError('actual dispatched binding changed')
            dump_new(cfg['operations']/'launch.json',launched);dump_new(cfg['operations']/'opening.json',opening)
            emit('controller_dispatched',value=launched)
            timer.cancel();budget=TimeBudget(aware(b['collection_cutoff']))
            timer=threading.Timer(budget.remaining(),client.close);timer.daemon=True;timer.start()
            result=collect(sftp,cfg,plan,opening,budget,emit);emit('collector_finished',result=result);return result
    except BaseException as error:
        emit('collector_stopped',error_type=type(error).__name__,dispatch_may_have_started=dispatched,
             no_automatic_reconnect=True,original_power_guard_retained=True)
        raise
    finally:
        password=None;client.close();timer.cancel()


def parser():
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--stage',action='store_true');mode.add_argument('--execute',action='store_true')
    for n in ('output-dir','stage-dir','config'):p.add_argument('--'+n,type=Path)
    # In --stage this denotes a local file; in --execute it denotes a remote path.
    # Do not run the remote string through WindowsPath during argument parsing.
    p.add_argument('--lease')
    for n in ('commit','ref','run-id'):p.add_argument('--'+n)
    return p


if __name__=='__main__':
    a=parser().parse_args()
    print(stage(a.output_dir,a.commit,a.ref,Path(a.lease)) if a.stage else execute(a.stage_dir,a.config,a.run_id,a.lease))
