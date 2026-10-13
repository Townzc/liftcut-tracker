"""Small bootstrap plus single-dispatch I2 setup; safe to upload before checkout."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import time

PERSIST = Path('/root/autodl-tmp/liftcut')


def identity(pid):
    p = Path('/proc')/str(pid)
    raw = (p/'stat').read_text().split(') ', 1)[1].split()
    if raw[0] == 'Z': raise ValueError('dead guard process')
    return {'pid': pid, 'argv': [x.decode() for x in (p/'cmdline').read_bytes().split(b'\0') if x],
            'start_ticks': raw[19]}


def active_workers():
    found = []
    for p in Path('/proc').glob('[0-9]*'):
        if int(p.name) == os.getpid(): continue
        try: args = (p/'cmdline').read_bytes().split(b'\0')
        except (FileNotFoundError, ProcessLookupError): continue
        names = {Path(a.decode(errors='replace')).name for a in args[:3]}
        if any(n.startswith(('gpu_train_', 'gpu_g', 'run_g', 'gpu_i', 'run_i')) and n.endswith('.py') for n in names):
            found.append(int(p.name))
    return found


def safe_ops(ops):
    if ops.parent != PERSIST/'runs' or not re.fullmatch(r'i2-ops-[0-9]{8}-[0-9]{6}', ops.name):
        raise ValueError('new I2 operations directory required')
    if ops.is_symlink() or ops.resolve() != ops:
        raise ValueError('operations must be on the intended persistent volume')


def arm(ops, booted):
    safe_ops(ops)
    boot = datetime.fromisoformat(booted); now = datetime.now(timezone.utc)
    if sys.platform != 'linux' or boot.utcoffset() is None or not 0 <= (now-boot).total_seconds() < 600:
        raise ValueError('fresh authorized Linux opening required')
    if active_workers() or subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip():
        raise ValueError('another worker/GPU process exists; no new lease')
    ops.mkdir(parents=True, exist_ok=False)
    key = hashlib.sha256(boot.astimezone(timezone.utc).isoformat().encode()).hexdigest()[:20]
    # Durable reservation precedes the guard process. Unknown outcomes require inspection.
    with (PERSIST/'runs'/('i2-opening-'+key+'.json')).open('x') as f:
        json.dump({'ops':str(ops),'booted_at_proxy':booted},f)
    hard = (boot+timedelta(minutes=90)).isoformat()
    argv = [sys.executable,str(Path(__file__).with_name('shutdown_guard.py')),'--arm','--deadline',hard,
            '--receipt',str(ops/'setup-guard.jsonl')]
    with (ops/'guard.log').open('x') as log:
        child = subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    for _ in range(100):
        if (ops/'setup-guard.jsonl').exists() and (ops/'setup-guard.jsonl').stat().st_size: break
        if child.poll() is not None: raise ValueError('independent shutdown guard failed')
        time.sleep(.1)
    else: raise ValueError('guard arming not observed; inspect, never repeat')
    value = {'version':'i2-setup-guard-v1','identity':identity(child.pid),'argv':argv,
             'booted_at_proxy':booted,'hard_cutoff':hard,'armed_at_utc':datetime.now(timezone.utc).isoformat()}
    with (ops/'guard.json').open('x') as f: json.dump(value,f,indent=2)
    verify_guard(ops/'guard.json',hard)
    return value


def verify_guard(path, hard):
    data = json.loads(path.read_text())
    if data['version'] != 'i2-setup-guard-v1' or data['hard_cutoff'] != hard:
        raise ValueError('original I2 guard deadline differs')
    observed = identity(data['identity']['pid'])
    rows = [json.loads(x) for x in path.with_name('setup-guard.jsonl').read_text().splitlines()]
    if (observed != data['identity'] or observed['argv'] != data['argv'] or not rows
            or rows[0]['status'] != 'armed' or rows[0]['deadline'] != hard):
        raise ValueError('original guard identity/arming no longer matches')
    return data


def dispatch(ops, data, model, model_manifest, commit, booted):
    from d2_execution import expected_runtime, utcnow
    from i2_protocol import ROOT, deadlines, verify_plan
    from gpu_counterfactual_diagnostics import verify_model
    from prepare_state_diagnostics import verify_prepared as diagnostic
    from prepare_counterfactual_diagnostics import verify_prepared as d2, load_tokenizer
    from server_workspace import command, dump_new
    import importlib.metadata
    import platform
    safe_ops(ops)
    plan = verify_plan()
    _, _, hard = deadlines(booted,utcnow().isoformat(),utcnow())
    guard = verify_guard(ops/'guard.json',hard.isoformat())
    if guard['booted_at_proxy'] != booted or command(['git','rev-parse','HEAD'],ROOT) != commit or command(['git','status','--porcelain'],ROOT):
        raise ValueError('opening or clean execution commit differs')
    if active_workers() or command(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],ROOT):
        raise ValueError('worker/GPU already in use')
    runtime = expected_runtime()
    if platform.python_version() != runtime['python'] or any(importlib.metadata.version(k) != v for k,v in runtime['packages'].items()):
        raise ValueError('pinned runtime unavailable; do not install while clock is running')
    diagnostic(data/'diagnostic'); d2(data/'d2'); load_tokenizer(data/'tokenizer')
    verify_model(model,model_manifest)
    from i2_protocol import verify_adapter
    verify_adapter(data/'reference/final',plan['reference']['checkpoint'])
    start = utcnow().isoformat()
    deadlines(booted,start,utcnow())
    run = PERSIST/'runs'/ops.name.replace('i2-ops-','i2-run-',1)
    if run.exists(): raise ValueError('existing I2 run; inspect unknown outcomes')
    dump_new(ops/'reservation.json',{'commit':commit,'run':str(run),'booted_at_proxy':booted,'trial_started_at_utc':start})
    argv = [sys.executable,str(ROOT/'run_i2_window.py'),'--model-dir',str(model),'--model-manifest',str(model_manifest),
            '--diagnostic-dir',str(data/'diagnostic'),'--d2-dir',str(data/'d2'),'--tokenizer-dir',str(data/'tokenizer'),
            '--reference-dir',str(data/'reference'),'--output-dir',str(run),'--expected-code-commit',commit,
            '--booted-at',booted,'--trial-started-at',start,'--guard-path',str(ops/'guard.json'),
            '--execute','--shutdown-when-done']
    with (ops/'controller.log').open('x') as log:
        child = subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    result = {'pid':child.pid,'argv':argv,'booted_at_proxy':booted,'trial_started_at_utc':start}
    dump_new(ops/'controller-launch.json',result)
    return result


def abort_setup(ops, booted):
    safe_ops(ops)
    hard = (datetime.fromisoformat(booted)+timedelta(minutes=90)).isoformat()
    verify_guard(ops/'guard.json',hard)
    if ((ops/'reservation.json').exists() or (ops/'controller-launch.json').exists()
            or active_workers() or subprocess.check_output(
                ['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip()):
        raise ValueError('dispatch/worker may exist; inspect instead of aborting it')
    from shutdown_guard import shutdown_command
    with (ops/'setup-abort-request.json').open('x') as f:
        json.dump({'requested_at_utc':datetime.now(timezone.utc).isoformat(),'reason':'known_setup_failure'},f)
    result = subprocess.run(shutdown_command(Path('/usr/bin/shutdown')),capture_output=True,timeout=30)
    value = {'returncode':result.returncode,'provider_billing_stopped':'unknown'}
    with (ops/'setup-abort-return.json').open('x') as f: json.dump(value,f)
    return value


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--arm-bootstrap',action='store_true'); p.add_argument('--dispatch',action='store_true')
    p.add_argument('--abort-setup',action='store_true')
    for name in ('ops','data','model','model-manifest'): p.add_argument('--'+name,type=Path)
    for name in ('booted-at','commit'): p.add_argument('--'+name)
    a=p.parse_args()
    if sum((a.arm_bootstrap,a.dispatch,a.abort_setup)) != 1: p.error('one explicit mode required')
    result = arm(a.ops,a.booted_at) if a.arm_bootstrap else abort_setup(a.ops,a.booted_at) if a.abort_setup else dispatch(a.ops,a.data,a.model,a.model_manifest,a.commit,a.booted_at)
    print(json.dumps(result))
