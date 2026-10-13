"""A unique bounded I3 follow-up; delta evidence, full original ACK deadline."""
import argparse
from datetime import timedelta
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

from d2_execution import Clock,event_file,read,utcnow
from i3_protocol import ROOT,BUDGET,ARMS,verify_plan,binding,validate_opening,prepared_cases,verify_parent_files
from i3_receipt import validate_receipt
from liftcut_agent.interactive import digest
from recovery_dataset import write_rows
from research_lease import verify_live,identity
from run_counterfactual_window import run_phase
from run_controlled_window import evidence_backup
from server_workspace import dump_new,command,sha256

PERSIST=Path('/root/autodl-tmp/liftcut')


def finalise(output,status,failures,bind,clock,*,scripted=False,sleep=time.sleep,archive=evidence_backup):
    """Wait until the registered collection cutoff; never an earlier rolling cap."""
    from d2_execution import aware
    dump_new(output/'window-status.json',{'status':status,'failures':failures,'binding':bind,
        'finished_work_at_utc':clock.now().isoformat(),'archive_is_self_contained':False})
    if any(output.rglob('*.safetensors')):raise ValueError('I3 delta must not duplicate private parent weights')
    item=archive(output)
    index={'version':'i3-delta-index-v1','binding':bind,'status':status,
           'evidence_kind':'scripted_contract' if scripted else 'model','archive_is_self_contained':False,
           'archives':[{'path':item['archive'],**item}]}
    dump_new(output/'backup-index.json',index);event_file(output/'events.jsonl','backup_ready',index=index)
    acknowledged=False;until=aware(bind['collection_cutoff'])-timedelta(seconds=10)
    while clock.now()<until:
        path=output/'off-instance-backup.json'
        if path.exists():
            try:
                validate_receipt(path.read_bytes(),index,bind,scripted=scripted)
                acknowledged=True
                event_file(output/'events.jsonl','server_receipt_consumed',receipt_sha256=sha256(path),status=status)
                break
            except (ValueError,KeyError,TypeError,OSError):pass
        sleep(min(2,max(0,(until-clock.now()).total_seconds())))
    dump_new(output/'backup-copy-status.json',{'off_instance_acknowledged':acknowledged,
        'original_collection_cutoff':bind['collection_cutoff'],'provider_billing_stopped':False})
    close={'at_utc':clock.now().isoformat(),'experiment_status':status,'off_instance_acknowledged':acknowledged,
        'power_action':'retain_under_original_overnight_guard','shutdown_at_utc':bind['power_lease']['shutdown_at_utc']}
    dump_new(output/'window-close.json',close)
    event_file(output/'events.jsonl','experiment_closed_instance_retained',acknowledged=acknowledged)
    return index


def phases(a,commit):
    shared=['--model-dir',str(a.model_dir),'--model-manifest',str(a.model_manifest),
        '--d2-dir',str(a.d2_dir),'--run-dir',str(a.output_dir),'--parent-run',str(a.parent_run),
        '--expected-code-commit',commit,'--allow-gpu']
    steps=[('evaluate-'+arm,[sys.executable,str(ROOT/'gpu_i3.py'),*shared,'--arm',arm]) for arm in ARMS]
    steps.append(('audit',[sys.executable,str(ROOT/'audit_i3.py'),'--run-dir',str(a.output_dir),
        '--d2-dir',str(a.d2_dir),'--tokenizer-dir',str(a.tokenizer_dir),'--parent-run',str(a.parent_run),
        '--output',str(a.output_dir/'comparison.json')]))
    return steps


def execute(a):
    from d2_execution import aware
    plan=verify_plan();opening=read(a.ops_dir/'opening.json');b=validate_opening(opening,plan)
    verify_live(a.lease,b['power_lease'])
    if (command(['git','rev-parse','HEAD'],ROOT)!=b['code_commit'] or command(['git','status','--porcelain'],ROOT)
            or a.output_dir.exists() or utcnow()>=aware(b['work_cutoff'])
            or a.output_dir.parent!=PERSIST/'runs' or not re.fullmatch(r'i3-run-\d{8}-\d{6}',a.output_dir.name)):
        raise ValueError('fresh bound I3 run and exact clean checkout required')
    verify_parent_files(a.parent_run,plan['reference'])
    a.output_dir.mkdir(exist_ok=False)
    dump_new(a.output_dir/'opening.json',opening);dump_new(a.output_dir/'reference.json',plan['reference'])
    write_rows(a.output_dir/'cases.jsonl',prepared_cases(a.d2_dir,plan))
    status,failures='partial',[];clock=Clock()
    try:
        target=identity(os.getpid());log=a.output_dir/'trial-watchdog-events.jsonl'
        with (a.output_dir/'trial-watchdog.log').open('x') as stream:
            child=subprocess.Popen([sys.executable,str(ROOT/'research_lease.py'),'--trial-guard',
                '--target-json',json.dumps(target),'--deadline',b['hard_cutoff'],'--log',str(log)],
                stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
        for _ in range(100):
            if log.exists() and log.stat().st_size:break
            if child.poll() is not None:raise ValueError('I3 trial guard failed, no inference')
            time.sleep(.1)
        else:raise ValueError('I3 trial guard unobserved, no inference')
        dump_new(a.output_dir/'trial-watchdog.json',{'identity':identity(child.pid),'target':target,'deadline':b['hard_cutoff']})
        if shutil.disk_usage(a.output_dir).free<500_000_000:raise ValueError('500MB result space required; no expansion')
        for name,argv in phases(a,b['code_commit']):run_phase(name,argv,a.output_dir,aware(b['work_cutoff']),clock)
        status='complete'
    except Exception as error:
        failures.append({'type':type(error).__name__,'message':str(error)})
    finally:
        finalise(a.output_dir,status,failures,b,clock)
    return 0 if status=='complete' else 2


def reserve_followup(directory,family,record,maximum):
    """Persistent family + numbered slots; unknown partial reservation stops retry."""
    directory.mkdir(parents=True,exist_ok=True)
    dump_new(directory/(family+'.json'),record)
    for number in range(maximum):
        try:
            dump_new(directory/('slot-'+str(number)+'.json'),record)
            return number
        except FileExistsError:continue
    raise ValueError('original maximum follow-up count exhausted')


def dispatch(a):
    from i2_setup import active_workers
    if sys.platform!='linux':raise ValueError('authorized Linux dispatch only')
    plan=verify_plan();lease=verify_live(a.lease)
    if (not re.fullmatch('[0-9a-f]{40}',a.expected_code_commit)
            or command(['git','rev-parse','HEAD'],ROOT)!=a.expected_code_commit
            or command(['git','status','--porcelain'],ROOT)):
        raise ValueError('exact reviewed clean I3 commit required')
    for path,prefix in ((a.output_dir,'i3-run-'),(a.ops_dir,'i3-ops-')):
        if path.parent!=PERSIST/'runs' or path.resolve()!=path or not re.fullmatch(prefix+r'\d{8}-\d{6}',path.name) or path.exists():
            raise ValueError('new canonical I3 operation/run paths required')
    if a.output_dir.name.removeprefix('i3-run-')!=a.ops_dir.name.removeprefix('i3-ops-'):
        raise ValueError('run IDs differ')
    verify_parent_files(a.parent_run,plan['reference']);prepared_cases(a.d2_dir,plan)
    if active_workers():raise ValueError('existing experiment worker, no repeated dispatch')
    gpu=command(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],ROOT)
    if gpu.strip():raise ValueError('GPU process already running')
    started=utcnow().isoformat();b=binding(plan,a.expected_code_commit,lease,started)
    record={'family':'I3','at_utc':started,'binding':b,'run_dir':str(a.output_dir),'ops_dir':str(a.ops_dir)}
    slot=reserve_followup(PERSIST/'ops'/('followups-'+digest(lease)[:20]),'i3',record,lease['maximum_followup_trials'])
    a.ops_dir.mkdir(exist_ok=False)
    opening={'binding':b,'at_utc':utcnow().isoformat(),'evidence_kind':'model','budget':BUDGET,'followup_slot':slot}
    dump_new(a.ops_dir/'opening.json',opening)
    args=[sys.executable,str(ROOT/'run_i3_window.py'),'--execute']
    for name in ('model_dir','model_manifest','d2_dir','tokenizer_dir','parent_run','output_dir','ops_dir','lease'):
        args+=['--'+name.replace('_','-'),str(getattr(a,name))]
    with (a.ops_dir/'controller.log').open('x') as stream:
        child=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
    result={'opening':opening,'controller_identity':identity(child.pid),'controller_pid':child.pid,
            'model_calls_repeated':0,'parent_weight_reused':True,'new_training':False}
    dump_new(a.ops_dir/'launch.json',result)
    print(json.dumps(result),flush=True)
    return 0


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--dispatch',action='store_true');mode.add_argument('--execute',action='store_true')
    for n in ('model-dir','model-manifest','d2-dir','tokenizer-dir','parent-run','output-dir','ops-dir','lease'):
        p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--expected-code-commit');a=p.parse_args()
    raise SystemExit(dispatch(a) if a.dispatch else execute(a))
