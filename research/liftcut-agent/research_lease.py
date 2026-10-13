"""Explicit overnight power lease, independent of bounded experiment workers."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

PERSIST = Path('/root/autodl-tmp/liftcut')


def aware(value):
    value = datetime.fromisoformat(value)
    if value.utcoffset() is None:
        raise ValueError('timezone-aware lease dates required')
    return value


def validate(value, now=None):
    if value['version'] != 'liftcut-research-lease-v1':
        raise ValueError('unknown power lease')
    boot, end = aware(value['booted_at_proxy']), aware(value['shutdown_at_utc'])
    hours = (end-boot).total_seconds()/3600
    rate, reserve = value['hourly_cny'], value['reserve_cny']
    if (not 0 < hours <= 12 or not all(isinstance(x,(int,float)) and not isinstance(x,bool)
            and math.isfinite(x) and x > 0 for x in (rate,reserve)) or hours*rate > reserve
            or value['automatic_shutdown'] is not True or value['automatic_reboot'] is not False
            or value['paid_api_calls'] != 0 or value['disk_expansion'] is not False
            or value['heldout_tasks_allowed'] != 0 or not value['authorization']
            or type(value.get('final_collection_buffer_minutes')) is not int
            or value['final_collection_buffer_minutes'] < 45
            or value.get('maximum_followup_trials') != 2):
        raise ValueError('lease exceeds explicit time/cost/scope limits')
    if now is not None and not boot <= now < end:
        raise ValueError('outside original authorized power lease')
    return end


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def identity(pid):
    p=Path('/proc')/str(pid)
    fields=(p/'stat').read_text().split(') ',1)[1].split()
    if fields[0]=='Z':raise ValueError('dead process')
    return {'pid':pid,'start_ticks':fields[19],
            'argv':[x.decode() for x in (p/'cmdline').read_bytes().split(b'\0') if x],
            'kernel_boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def write_new(path,value):
    with path.open('x',encoding='utf-8') as f:
        json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())


def event(path,status,**extra):
    with path.open('a',encoding='utf-8') as f:
        f.write(json.dumps({'at_utc':datetime.now(timezone.utc).isoformat(),'status':status,**extra})+'\n')
        f.flush();os.fsync(f.fileno())


def verify_live(lease_path, expected=None):
    lease_path=Path(lease_path)
    value=json.loads(lease_path.read_text())
    validate(value,datetime.now(timezone.utc))
    if expected is not None and value != expected:raise ValueError('original lease changed')
    guard=json.loads(lease_path.with_name('guard.json').read_text())
    events=[json.loads(x) for x in lease_path.with_name('events.jsonl').read_text().splitlines()]
    if (guard['lease_digest']!=digest(value) or identity(guard['identity']['pid'])!=guard['identity']
            or not events or events[0]['status']!='armed' or events[0]['lease_digest']!=digest(value)
            or events[0]['shutdown_at_utc']!=value['shutdown_at_utc']
            or hashlib.sha256(Path(guard['source']).read_bytes()).hexdigest()!=guard['source_sha256']):
        raise ValueError('independent power guard no longer matches')
    return value


def guard(lease_path):
    lease=json.loads(lease_path.read_text());now=datetime.now(timezone.utc);end=validate(lease,now)
    event(lease_path.with_name('events.jsonl'),'armed',lease_digest=digest(lease),shutdown_at_utc=lease['shutdown_at_utc'])
    stop=time.monotonic()+(end-now).total_seconds()
    while time.monotonic()<stop:time.sleep(min(15,max(0,stop-time.monotonic())))
    event(lease_path.with_name('events.jsonl'),'shutdown_requested',reason='authorized_overnight_deadline')
    binary=Path('/usr/bin/shutdown');prefix=binary.read_bytes()[:4]
    command=[str(binary)] if prefix.startswith((b'#!',b'\x7fELF')) else ['/bin/bash',str(binary)]
    result=subprocess.run(command,capture_output=True,timeout=30)
    # Never publish provider response bodies (they may contain credentials).
    returned={'at_utc':datetime.now(timezone.utc).isoformat(),'returncode':result.returncode,
              'provider_power_state':'unknown','provider_billing_stopped':'unknown'}
    write_new(lease_path.with_name('shutdown-return.json'),returned)
    event(lease_path.with_name('events.jsonl'),'command_returned',**returned)
    return result.returncode


def arm(lease_path):
    lease_path=Path(lease_path)
    if (sys.platform!='linux' or lease_path.name!='lease.json' or lease_path.parent.parent!=PERSIST/'ops'
            or not re.fullmatch(r'overnight-\d{8}-\d{6}',lease_path.parent.name)
            or lease_path.resolve()!=lease_path):raise ValueError('intended persistent lease path required')
    value=json.loads(lease_path.read_text());validate(value,datetime.now(timezone.utc))
    if lease_path.with_name('guard.json').exists() or lease_path.with_name('events.jsonl').exists():
        raise ValueError('guard outcome may exist; inspect, never restart')
    write_new(lease_path.with_name('guard-reservation.json'),{'at_utc':datetime.now(timezone.utc).isoformat(),'lease_digest':digest(value)})
    source=Path(__file__).resolve()
    with lease_path.with_name('guard.log').open('x') as f:
        process=subprocess.Popen([sys.executable,str(source),'--guard','--lease',str(lease_path)],
            stdin=subprocess.DEVNULL,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
    for _ in range(100):
        if lease_path.with_name('events.jsonl').exists() and lease_path.with_name('events.jsonl').stat().st_size:break
        if process.poll() is not None:raise ValueError('guard exited; inspect existing evidence')
        time.sleep(.1)
    else:raise ValueError('guard arming unobserved; no automatic retry')
    record={'identity':identity(process.pid),'lease_digest':digest(value),'source':str(source),
            'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
    write_new(lease_path.with_name('guard.json'),record)
    verify_live(lease_path,value)
    return record


def trial_guard(target, deadline, log):
    """Stop only the original controller process group at its own hard limit."""
    end=aware(deadline);now=datetime.now(timezone.utc)
    if not now < end or (end-now).total_seconds()>91*60:raise ValueError('bounded trial deadline required')
    actual=identity(target['pid'])
    if actual!=target or os.getpgid(target['pid'])!=target['pid']:raise ValueError('original isolated controller required')
    event(log,'trial_guard_armed',target=target,deadline=deadline)
    until=time.monotonic()+(end-now).total_seconds()
    while time.monotonic()<until:
        try:
            if identity(target['pid'])!=target:return 0
        except (FileNotFoundError,ProcessLookupError,ValueError):return 0
        time.sleep(min(2,max(0,until-time.monotonic())))
    if identity(target['pid'])==target and os.getpgid(target['pid'])==target['pid']:
        event(log,'trial_group_kill_requested',deadline=deadline)
        os.killpg(target['pid'],signal.SIGKILL)
    return 0


if __name__=='__main__':
    p=argparse.ArgumentParser(allow_abbrev=False)
    group=p.add_mutually_exclusive_group(required=True)
    for name in ('arm','guard','trial-guard'):group.add_argument('--'+name,action='store_true')
    p.add_argument('--lease',type=Path);p.add_argument('--target-json');p.add_argument('--deadline');p.add_argument('--log',type=Path)
    a=p.parse_args()
    if a.arm:print(json.dumps(arm(a.lease)))
    elif a.guard:raise SystemExit(guard(a.lease))
    else:raise SystemExit(trial_guard(json.loads(a.target_json),a.deadline,a.log))
