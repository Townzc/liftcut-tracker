"""One explicitly opened 24-hour research lease, separate from bounded trials.

Standard library only: uploaded before the code bundle. No model/data loading,
power-on, automatic reconnect, or extension capability.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

PERSIST = Path('/root/autodl-tmp/liftcut')


def now():
    return datetime.now(timezone.utc)


def aware(value):
    value = datetime.fromisoformat(value)
    if value.utcoffset() is None:
        raise ValueError('timezone-aware original opening required')
    return value


def validate(value, at=None):
    expected = {
        'version': 'liftcut-research-day-v1',
        'authorization': 'explicit_human_20261013_one_day_after_ready',
        'hourly_cny': 2.18, 'reserve_cny': 55,
        'automatic_shutdown': True, 'automatic_reboot': False,
        'paid_api_calls': 0, 'disk_expansion': False,
        'heldout_scope': 'E1_one_48_task_batch_with_fresh_A_and_D',
        'maximum_followup_gpu_trials': 2, 'final_collection_buffer_minutes': 45,
    }
    if (set(value) != set(expected) | {'booted_at_proxy', 'shutdown_at_utc'}
            or any(type(value[k]) is not type(v) or value[k] != v for k, v in expected.items())):
        raise ValueError('explicit one-day scope and budget required')
    boot, end = aware(value['booted_at_proxy']), aware(value['shutdown_at_utc'])
    if boot < aware('2026-10-13T17:40:00+00:00') or end != boot + timedelta(hours=24):
        raise ValueError('new opening and original 24-hour deadline required')
    if at is not None and not boot <= at < end:
        raise ValueError('outside original day lease')
    return end


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_new(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())


def event(path, status, **fields):
    with Path(path).open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'at_utc': now().isoformat(), 'status': status, **fields}) + '\n')
        stream.flush(); os.fsync(stream.fileno())


def identity(pid):
    folder = Path('/proc') / str(pid)
    fields = (folder / 'stat').read_text().split(') ', 1)[1].split()
    if fields[0] == 'Z':
        raise ValueError('dead process')
    return {'pid': pid, 'start_ticks': fields[19],
            'argv': [x.decode() for x in (folder / 'cmdline').read_bytes().split(b'\0') if x],
            'kernel_boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def lease_path(ops):
    return Path(ops) / 'day-lease.json'


def verify_live(path, expected=None):
    path = Path(path); lease = read(path); validate(lease, now())
    guard = read(path.with_name('day-guard.json'))
    rows = [json.loads(x) for x in path.with_name('day-power-events.jsonl').read_text().splitlines()]
    if (expected is not None and lease != expected) or (
            guard['lease_digest'] != digest(lease)
            or guard['identity'] != identity(guard['identity']['pid'])
            or hashlib.sha256(Path(guard['source']).read_bytes()).hexdigest() != guard['source_sha256']
            or not rows or rows[0]['status'] != 'armed'
            or rows[0]['lease_digest'] != digest(lease)
            or rows[0]['shutdown_at_utc'] != lease['shutdown_at_utc']):
        raise ValueError('original independent day guard differs')
    return lease


def arm(ops, lease):
    ops = Path(ops); validate(lease, now())
    if (sys.platform != 'linux' or ops.parent != PERSIST / 'runs'
            or not re.fullmatch(r'e1-ops-\d{8}-\d{6}', ops.name) or ops.resolve() != ops):
        raise ValueError('canonical new E1 operations path required')
    # A reservation survives an unknown launch. Never remove it to retry.
    write_new(PERSIST / 'ops' / ('day-opening-' + digest(lease)[:20] + '.json'),
              {'lease': lease, 'ops': str(ops), 'at_utc': now().isoformat()})
    path = lease_path(ops); write_new(path, lease)
    source = Path(__file__).resolve()
    with (ops / 'day-guard.log').open('x') as log:
        child = subprocess.Popen([sys.executable, str(source), '--guard', '--lease', str(path)],
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
    for _ in range(100):
        records = ops / 'day-power-events.jsonl'
        if records.exists() and records.stat().st_size:
            break
        if child.poll() is not None:
            raise ValueError('day guard exited; inspect, do not retry')
        time.sleep(.1)
    else:
        raise ValueError('day guard arming unknown; inspect, do not retry')
    guard = {'lease_digest': digest(lease), 'identity': identity(child.pid), 'source': str(source),
             'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
    write_new(ops / 'day-guard.json', guard); verify_live(path, lease)
    return guard


def request_shutdown(ops, reason):
    """Log failures must not suppress the authorized final power action."""
    from shutdown_guard import shutdown_command
    errors = []
    try:
        event(ops / 'day-power-events.jsonl', 'shutdown_requested', reason=reason)
    except OSError as error:
        errors.append(type(error).__name__)
    try:
        result = subprocess.run(shutdown_command(Path('/usr/bin/shutdown')), capture_output=True, timeout=30)
        value = {'at_utc': now().isoformat(), 'returncode': result.returncode,
                 'provider_power_state': 'unknown', 'provider_billing_stopped': 'unknown',
                 'request_log_errors': errors}
    except (OSError, subprocess.TimeoutExpired) as error:
        value = {'at_utc': now().isoformat(), 'returncode': None, 'error_type': type(error).__name__,
                 'provider_power_state': 'unknown', 'provider_billing_stopped': 'unknown',
                 'request_log_errors': errors}
    try:
        write_new(ops / 'day-shutdown-return.json', value)
    except OSError:
        pass
    return value


def guard(path):
    path = Path(path); lease = read(path); end = validate(lease, now())
    stop = time.monotonic() + (end - now()).total_seconds()
    # Even an exhausted log disk must not disarm an already authorized guard.
    try:
        event(path.with_name('day-power-events.jsonl'), 'armed', lease_digest=digest(lease),
              shutdown_at_utc=lease['shutdown_at_utc'])
    except OSError:
        pass
    while time.monotonic() < stop:
        time.sleep(min(15, max(0, stop - time.monotonic())))
    return request_shutdown(path.parent, 'original_authorized_day_deadline')


def start_trial_guard(ops, target, deadline):
    """Kill only this trial's original process group, never reset its clock."""
    ops = Path(ops); verify_live(lease_path(ops))
    if identity(target['pid']) != target or os.getpgid(target['pid']) != target['pid']:
        raise ValueError('original isolated E1 process group required')
    argv = [sys.executable, str(Path(__file__).resolve()), '--trial-guard', '--lease', str(lease_path(ops)),
            '--target-json', json.dumps(target), '--deadline', deadline]
    write_new(ops / 'trial-guard-reservation.json', {'target': target, 'deadline': deadline, 'argv': argv})
    with (ops / 'trial-guard.log').open('x') as log:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
    for _ in range(100):
        record = ops / 'trial-guard-events.jsonl'
        if record.exists() and record.stat().st_size:
            first = json.loads(record.read_text().splitlines()[0])
            if (first['status'] != 'armed' or first['target'] != target
                    or first['deadline'] != deadline):
                raise ValueError('trial guard original target/deadline differs')
            break
        if child.poll() is not None:
            raise ValueError('trial guard exited; inspect original trial, do not retry')
        time.sleep(.1)
    else:
        raise ValueError('trial guard arming unknown; inspect original trial, do not retry')
    value = {'identity': identity(child.pid), 'target': target, 'deadline': deadline}
    write_new(ops / 'trial-guard.json', value)
    return value


def group_members(target):
    """Identify only the original isolated session; never trust a PID alone."""
    found = {}
    for folder in Path('/proc').glob('[0-9]*'):
        try:
            fields = (folder / 'stat').read_text().split(') ', 1)[1].split()
            if fields[0] == 'Z' or int(fields[2]) != target['pid'] or int(fields[3]) != target['pid']:
                continue
            item = identity(int(folder.name))
            if (item['kernel_boot_id'] == target['kernel_boot_id']
                    and int(item['start_ticks']) >= int(target['start_ticks'])):
                found[item['pid']] = item
        except (FileNotFoundError, ProcessLookupError, ValueError):
            continue
    return found


def trial_guard(path, target, deadline):
    path = Path(path); lease = verify_live(path); end = aware(deadline)
    if (end != aware(lease['booted_at_proxy']) + timedelta(minutes=120)
            or not now() < end < aware(lease['shutdown_at_utc'])):
        raise ValueError('original 120-minute E1 trial limit required')
    if identity(target['pid']) != target or os.getpgid(target['pid']) != target['pid']:
        raise ValueError('original isolated E1 controller required')
    stop = time.monotonic() + (end - now()).total_seconds()
    known = {target['pid']: target}
    event(path.with_name('trial-guard-events.jsonl'), 'armed', target=target, deadline=deadline)
    while True:
        try:
            leader = identity(target['pid'])
            if leader != target:
                return
        except (FileNotFoundError, ProcessLookupError, ValueError):
            leader = None
        members = group_members(target)
        if not members:
            return
        if leader is None and not any(known.get(pid) == item for pid, item in members.items()):
            event(path.with_name('trial-guard-events.jsonl'), 'group_identity_unknown_no_signal',
                  target=target, deadline=deadline)
            return
        known = members
        # A dead controller must not leave its already-observed GPU child running.
        if leader is None or time.monotonic() >= stop:
            try:
                event(path.with_name('trial-guard-events.jsonl'), 'original_trial_group_stop_requested',
                      target=target, deadline=deadline, controller_alive=leader is not None)
            finally:
                try:
                    os.killpg(target['pid'], signal.SIGKILL)
                except ProcessLookupError:
                    pass
            return
        time.sleep(min(2, max(0, stop - time.monotonic())))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--guard', action='store_true'); mode.add_argument('--trial-guard', action='store_true')
    parser.add_argument('--lease', type=Path, required=True)
    parser.add_argument('--target-json'); parser.add_argument('--deadline')
    args = parser.parse_args()
    if args.guard:
        print(json.dumps(guard(args.lease)))
    else:
        trial_guard(args.lease, json.loads(args.target_json), args.deadline)
