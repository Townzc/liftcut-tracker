"""Four fixed-weight arms, bounded new lease, restore ACK then immediate shutdown."""
import argparse
from datetime import timedelta
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

from d2_execution import Clock, event_file, read, utcnow
from i2_protocol import ARMS, BUDGET, ROOT, aware, binding, deadlines, verify_adapter, verify_plan
from i2_receipt_transfer import validate_receipt
from run_controlled_window import evidence_backup
from run_counterfactual_window import run_phase
from run_recovery_window import archive_run
from server_workspace import command, dump_new, sha256
from shutdown_guard import shutdown_command


def copy_reference(source, run, reference):
    if read(source/'manifest.json') != reference: raise ValueError('staged reference differs')
    verify_adapter(source/'final',reference['checkpoint'])
    for name,value in reference['i1_view_sha256'].items():
        if sha256(source/'i1-view'/name) != value: raise ValueError('I1 history changed')
    shutil.copytree(source,run/'reference')


def phases(model, manifest, diagnostic, d2, tokenizer, output, commit):
    shared=['--model-dir',str(model),'--model-manifest',str(manifest),'--diagnostic-dir',str(diagnostic),
            '--d2-dir',str(d2),'--run-dir',str(output),'--expected-code-commit',commit]
    commands=[('evaluate-'+a,[sys.executable,str(ROOT/'gpu_i2.py'),*shared,'--arm',a,'--allow-gpu']) for a in ARMS]
    commands.append(('audit',[sys.executable,str(ROOT/'audit_i2.py'),'--run-dir',str(output),
        '--diagnostic-dir',str(diagnostic),'--d2-dir',str(d2),'--tokenizer-dir',str(tokenizer),
        '--output',str(output/'comparison.json')]))
    return commands


def execute_phases(commands, output, work, clock, *, phase_runner=run_phase):
    for name, argv in commands:
        phase_runner(name,argv,output,work,clock)
        if name.startswith('evaluate-'):
            arm=name.removeprefix('evaluate-')
            archive=archive_run(output/'evaluation'/arm)
            event_file(output/'early-index.jsonl','arm_archive',arm=arm,
                       binding=read(output/'opening.json')['binding'],path='evaluation/'+archive['archive'],**archive)


def finalize(output, status, failures, bind, collect, clock, *, kind='model', sleep=time.sleep,
             shutdown=None, archive=evidence_backup):
    shutdown=shutdown or (lambda:subprocess.run(shutdown_command(Path('/usr/bin/shutdown')),capture_output=True,timeout=30).returncode)
    acknowledged,index=False,None
    try:
        dump_new(output/'window-status.json',{'status':status,'failures':failures,'binding':bind,
            'finished_work_at_utc':clock.now().isoformat(),'provider_billing_stopped':'unknown'})
        backup=archive(output)
        index={'version':'i2-backup-v1','binding':bind,'evidence_kind':kind,'status':status,
               'archives':[{'path':backup['archive'],**backup}]}
        dump_new(output/'backup-index.json',index)
        event_file(output/'events.jsonl','backup_ready',index=index)
        until=min(collect-timedelta(seconds=30),clock.now()+timedelta(minutes=20))
        while clock.now()<until:
            receipt=output/'off-instance-backup.json'
            if receipt.exists():
                try:
                    validate_receipt(receipt.read_bytes(),index,bind,kind=kind)
                    acknowledged=True
                    event_file(output/'events.jsonl','server_receipt_consumed',status=status,receipt_sha256=sha256(receipt))
                    break
                except (ValueError,KeyError,TypeError,OSError): pass
            sleep(min(2,max(0,(until-clock.now()).total_seconds())))
        dump_new(output/'backup-copy-status.json',{'off_instance_acknowledged':acknowledged,
            'hard_cutoff':bind['hard_cutoff'],'provider_billing_stopped':'unknown'})
    except Exception as error:
        event_file(output/'events.jsonl','backup_failure',error_type=type(error).__name__,persistent_bytes_retained=True)
    finally:
        if 'power_lease' in bind:
            dump_new(output/'window-close.json',{'at_utc':clock.now().isoformat(),
                'off_instance_acknowledged':acknowledged,'experiment_status':status,
                'power_action':'retain_under_original_overnight_guard',
                'shutdown_at_utc':bind['power_lease']['shutdown_at_utc'],
                'provider_billing_stopped':False})
            event_file(output/'events.jsonl','experiment_closed_instance_retained',acknowledged=acknowledged)
            return index
        try:
            event_file(output/'events.jsonl','shutdown_requested',acknowledged=acknowledged)
        except Exception: pass
        # Allow the existing collector to capture the real request before power loss.
        # This is bounded by the ORIGINAL deadline, not an extension.
        try:
            sleep(min(3,max(0,(aware(bind['hard_cutoff'])-clock.now()).total_seconds())))
            code=shutdown()
            dump_new(output/'shutdown-request.json',{'returncode':code,'at_utc':clock.now().isoformat(),
                'provider_power_state_verified':False,'provider_billing_stopped':'unknown'})
        except Exception as error:
            print(json.dumps({'shutdown_error':type(error).__name__,'independent_guard_retained':True}),flush=True)
    return index


def main():
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('model-dir','model-manifest','diagnostic-dir','d2-dir','tokenizer-dir','reference-dir','output-dir','guard-path'):
        p.add_argument('--'+n,type=Path,required=n!='guard-path')
    for n in ('expected-code-commit','booted-at','trial-started-at'):p.add_argument('--'+n)
    p.add_argument('--execute',action='store_true');p.add_argument('--shutdown-when-done',action='store_true')
    p.add_argument('--power-lease',type=Path)
    a=p.parse_args(); plan=verify_plan()
    commands=phases(a.model_dir,a.model_manifest,a.diagnostic_dir,a.d2_dir,a.tokenizer_dir,a.output_dir,a.expected_code_commit)
    if not a.execute:
        print(json.dumps({'dry_run':True,'gpu_calls':0,'budget':BUDGET,'phases':commands}));return 0
    if platform.system()!='Linux' or (bool(a.shutdown_when_done)==bool(a.power_lease)) or a.guard_path is None:
        raise ValueError('authorized Linux execution with automatic shutdown required')
    from i2_setup import verify_guard
    power_lease=None
    if a.power_lease:
        from research_lease import verify_live
        power_lease=verify_live(a.power_lease)
    work,collect,hard=deadlines(a.booted_at,a.trial_started_at,utcnow(),power_lease=power_lease)
    guard=verify_guard(a.guard_path,hard.isoformat())
    if power_lease and guard.get('power_lease')!=power_lease:
        raise ValueError('controller and power lease differ')
    if (a.output_dir.exists() or a.output_dir.resolve().parent!=Path('/root/autodl-tmp/liftcut/runs')
            or not a.output_dir.name.startswith('i2-run-') or command(['git','status','--porcelain'],ROOT)
            or command(['git','rev-parse','HEAD'],ROOT)!=a.expected_code_commit):
        raise ValueError('fresh persistent run and exact clean checkout required')
    output,clock,status,failures=a.output_dir,Clock(),'partial',[]
    output.mkdir(parents=True,exist_ok=False)
    bind=binding(plan,a.expected_code_commit,a.booted_at,a.trial_started_at,power_lease=power_lease)
    dump_new(output/'opening.json',{'binding':bind,'booted_at_proxy':a.booted_at,'trial_started_at_utc':a.trial_started_at,
        'started_at_utc':utcnow().isoformat(),'budget':BUDGET,'evidence_kind':'model','guard_path':str(a.guard_path)})
    try:
        if power_lease:
            from research_lease import identity
            target=identity(os.getpid())
            log=output/'trial-watchdog-events.jsonl'
            with (output/'trial-watchdog.log').open('x') as stream:
                child=subprocess.Popen([sys.executable,str(ROOT/'research_lease.py'),'--trial-guard',
                    '--target-json',json.dumps(target),'--deadline',hard.isoformat(),'--log',str(log)],
                    stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
            for _ in range(100):
                if log.exists() and log.stat().st_size:break
                if child.poll() is not None:raise ValueError('trial watchdog failed; no inference')
                time.sleep(.1)
            else:raise ValueError('trial watchdog not observed; no inference')
            dump_new(output/'trial-watchdog.json',{'identity':identity(child.pid),'target':target,'deadline':hard.isoformat()})
        if shutil.disk_usage(output).free<3_000_000_000:raise ValueError('3GB free disk required; no expansion')
        copy_reference(a.reference_dir,output,plan['reference'])
        execute_phases(commands,output,work,clock)
        status='complete'
    except Exception as error: failures.append({'type':type(error).__name__,'message':str(error)})
    finally: finalize(output,status,failures,bind,collect,clock)
    return 0 if status=='complete' else 2


if __name__=='__main__':raise SystemExit(main())
