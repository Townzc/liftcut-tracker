"""One G4 trial under the existing overnight power guard; never resets boot or guard."""
import argparse
from datetime import timedelta
import json
from pathlib import Path
import platform
import shutil
import sys
import time

from d2_execution import event_file, read, utcnow
from g4_execution import ARMS,BUDGET,ROOT,Clock,aware,binding,deadlines,verify_plan,verify_live_lease
from g4_receipt_transfer import validate_receipt
from gpu_counterfactual_diagnostics import verify_model
from prepare_counterfactual_diagnostics import verify_prepared as verify_d2
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from run_controlled_window import evidence_backup
from run_counterfactual_window import run_phase
from run_recovery_window import archive_run
from server_workspace import command,dump_new


def phases(model,manifest,prepared,diagnostic,d2,tokenizer,output,commit):
    shared=['--model-dir',str(model),'--model-manifest',str(manifest),'--prepared-dir',str(prepared),
            '--run-dir',str(output),'--expected-code-commit',commit]
    commands=[]
    for arm in ARMS:
        commands.append(('train-'+arm,[sys.executable,str(ROOT/'gpu_train_g4.py'),*shared,'--arm',arm,
                                     '--output-dir',str(output/'training'/arm),'--allow-gpu']))
        commands.append(('evaluate-'+arm,[sys.executable,str(ROOT/'gpu_g4.py'),*shared,'--arm',arm,
                        '--diagnostic-dir',str(diagnostic),'--d2-dir',str(d2),'--allow-gpu']))
    commands.append(('audit',[sys.executable,str(ROOT/'audit_g4.py'),'--run-dir',str(output),
                    '--prepared-dir',str(prepared),'--diagnostic-dir',str(diagnostic),'--d2-dir',str(d2),
                    '--tokenizer-dir',str(tokenizer),'--output',str(output/'comparison.json')]))
    return commands


def execute_phases(commands,output,bind,work,clock,*,phase_runner=run_phase):
    for name,argv in commands:
        phase_runner(name,argv,output,work,clock)
        if name.startswith('train-'):
            arm=name.removeprefix('train-')
            if arm not in ARMS:raise ValueError('unknown G4 arm')
            backup=archive_run(output/'training'/arm)
            event_file(output/'early-index.jsonl','arm_archive',arm=arm,binding=bind,
                       path='training/'+backup['archive'],**backup)


def finalize(output,status,failures,bind,collect,clock,*,kind='model',sleep=time.sleep,grace_seconds=1800):
    dump_new(output/'window-status.json',{'status':status,'failures':failures,'binding':bind,
             'finished_work_at_utc':clock.now().isoformat(),'provider_billing_stopped':False})
    archives=[]
    for arm in ARMS:
        directory=output/'training'/arm
        if directory.exists():
            backup=read(directory/'backup-ready.json') if (directory/'backup-ready.json').exists() else archive_run(directory)
            archives.append({'part':arm,'path':'training/'+backup['archive'],**backup})
    backup=evidence_backup(output)
    archives.append({'part':'evidence','path':backup['archive'],**backup})
    index={'version':'g4-backup-v1','binding':bind,'evidence_kind':kind,'status':status,'archives':archives}
    dump_new(output/'backup-index.json',index)
    event_file(output/'events.jsonl','backup_ready',index=index)
    until=min(collect-timedelta(seconds=30),clock.now()+timedelta(seconds=grace_seconds))
    acknowledged=False
    while clock.now()<until:
        receipt=output/'off-instance-backup.json'
        if receipt.exists():
            try:
                validate_receipt(receipt.read_bytes(),index,bind,kind=kind)
                acknowledged=True
                event_file(output/'events.jsonl','server_receipt_consumed',status=status)
                break
            except (ValueError,KeyError,TypeError,OSError):pass
        sleep(min(2,max(0,(until-clock.now()).total_seconds())))
    dump_new(output/'backup-copy-status.json',{'off_instance_acknowledged':acknowledged,
             'power_deadline':BUDGET['power_deadline'],'provider_billing_stopped':False})
    event_file(output/'events.jsonl','g4_controller_finished',status=status,acknowledged=acknowledged,
               independent_overnight_guard_retained=True,power_deadline=BUDGET['power_deadline'])
    return index


def main():
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for name in ('model-dir','model-manifest','prepared-dir','diagnostic-dir','d2-dir','tokenizer-dir','output-dir'):
        p.add_argument('--'+name,required=True,type=Path)
    p.add_argument('--expected-code-commit',required=True)
    p.add_argument('--trial-started-at')
    p.add_argument('--execute',action='store_true')
    a=p.parse_args()
    plan=verify_plan(a.prepared_dir);verify_diagnostic(a.diagnostic_dir);verify_d2(a.d2_dir)
    commands=phases(a.model_dir,a.model_manifest,a.prepared_dir,a.diagnostic_dir,a.d2_dir,
                    a.tokenizer_dir,a.output_dir,a.expected_code_commit)
    if not a.execute:
        print(json.dumps({'dry_run':True,'gpu_calls':0,'budget':BUDGET,'phases':commands}));return 0
    if platform.system()!='Linux' or not a.trial_started_at:raise ValueError('authorized Linux trial required')
    work,collect=deadlines(a.trial_started_at,utcnow())
    verify_live_lease(plan)
    if (a.output_dir.exists() or a.output_dir.resolve().parent!=Path('/root/autodl-tmp/liftcut/runs')
            or not a.output_dir.name.startswith('g4-run-') or command(['git','status','--porcelain'],ROOT)
            or command(['git','rev-parse','HEAD'],ROOT)!=a.expected_code_commit):
        raise ValueError('new persistent run and clean exact checkout required')
    a.output_dir.mkdir(parents=True,exist_ok=False)
    output,clock,status,failures=a.output_dir,Clock(),'partial',[]
    bind=binding(plan,a.expected_code_commit,a.trial_started_at)
    dump_new(output/'opening.json',{'binding':bind,'booted_at_proxy':BUDGET['instance_boot'],
             'trial_started_at_utc':a.trial_started_at,'budget':BUDGET,'evidence_kind':'model',
             'started_at_utc':utcnow().isoformat(),'lease_configuration_digest':plan['lease_configuration_digest']})
    try:
        if shutil.disk_usage(output).free<3_000_000_000:raise ValueError('3GB free disk required; no expansion')
        verify_model(a.model_dir,a.model_manifest)
        execute_phases(commands,output,bind,work,clock)
        status='complete'
    except Exception as error:
        failures.append({'type':type(error).__name__,'message':str(error)})
    finally:
        finalize(output,status,failures,bind,collect,clock)
    return 0 if status=='complete' else 2


if __name__=='__main__':raise SystemExit(main())
