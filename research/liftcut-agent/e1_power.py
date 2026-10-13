"""Standalone E1 setup power guard; only for a separately authorized future opening.

This small standard-library bootstrap is uploaded and armed before the code
bundle. It never opens task payloads, starts models, or reboots an instance.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

PERSIST = Path('/root/autodl-tmp/liftcut')
NOT_BEFORE = datetime(2026, 10, 13, 15, tzinfo=timezone.utc)


def now():
    return datetime.now(timezone.utc)


def aware(value):
    value = datetime.fromisoformat(value)
    if value.utcoffset() is None:
        raise ValueError('timezone-aware original opening required')
    return value


def write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())


def identity(pid):
    p = Path('/proc') / str(pid)
    fields = (p / 'stat').read_text().split(') ', 1)[1].split()
    if fields[0] == 'Z':
        raise ValueError('dead power guard')
    return {'pid': pid, 'start_ticks': fields[19],
            'argv': [x.decode() for x in (p / 'cmdline').read_bytes().split(b'\0') if x],
            'kernel_boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def active_workers():
    found = []
    for p in Path('/proc').glob('[0-9]*'):
        if int(p.name) == os.getpid():
            continue
        try:
            args = (p / 'cmdline').read_bytes().split(b'\0')
        except (FileNotFoundError, ProcessLookupError):
            continue
        names = {Path(a.decode(errors='replace')).name for a in args[:3]}
        if any(n.startswith(('gpu_train_', 'gpu_g', 'run_g', 'gpu_i', 'run_i', 'gpu_e', 'run_e'))
               and n.endswith('.py') for n in names):
            found.append(int(p.name))
    return found


def validate_bound_power(b, at):
    auth = b['authorization']; boot = aware(b['booted_at_proxy']); hard = aware(b['hard_cutoff'])
    day = auth.get('power_lease')
    expected = {'experiment': 'E1', 'source': 'explicit_human_new_server_window',
                'booted_at_proxy': b['booted_at_proxy'], 'maximum_minutes': 120,
                'reserve_cny': 5, 'hourly_cny': 2.18,
                'heldout_scope': 'one_48_task_batch_with_fresh_A_and_D', 'automatic_shutdown': True}
    if day is not None:
        from day_lease import validate
        validate(day, at)
        expected.update(source='explicit_human_new_server_day', power_lease=day)
        if (b.get('power_lease') != day or day['booted_at_proxy'] != b['booted_at_proxy']
                or b.get('power_shutdown_at_utc') != day['shutdown_at_utc']):
            raise ValueError('original day power binding differs')
    if (boot < NOT_BEFORE or hard != boot + timedelta(minutes=120)
            or auth != expected
            or not boot <= aware(b['trial_started_at_utc']) <= at <= boot + timedelta(minutes=10)
            or not re.fullmatch(r'\d{8}-\d{6}', b['run_id'])
            or not re.fullmatch('[0-9a-f]{40}', b['code_commit'])):
        raise ValueError('new separately authorized 120-minute E1 power binding required')
    return hard


def safe_ops(ops, b):
    if (ops != PERSIST / 'runs' / ('e1-ops-' + b['run_id'])
            or ops.is_symlink() or ops.resolve() != ops):
        raise ValueError('canonical fresh persistent E1 operations path required')


def arm(ops, b):
    if sys.platform != 'linux':
        raise ValueError('authorized AutoDL Linux only')
    validate_bound_power(b, now()); safe_ops(ops, b)
    gpu = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader'], text=True)
    if active_workers() or gpu.strip():
        raise ValueError('existing experiment or GPU process; do not arm again')
    ops.mkdir(parents=True, exist_ok=False)
    key = hashlib.sha256(b['booted_at_proxy'].encode()).hexdigest()[:20]
    write_new(PERSIST / 'ops' / ('e1-opening-' + key + '.json'), {'binding': b, 'ops': str(ops)})
    if 'power_lease' in b:
        from day_lease import arm as arm_day
        from gpu_telemetry import start as start_observer
        day_guard = arm_day(ops, b['power_lease'])
        value = {'version': 'e1-day-guard-v1', 'binding': b, 'day_guard': day_guard}
        write_new(ops / 'guard.json', value)
        verify_guard(ops, b)
        # Pure observation, independent of the model process and its conditions.
        start_observer(ops)
        return value
    script = Path(__file__).with_name('shutdown_guard.py')
    argv = [sys.executable, str(script), '--arm', '--deadline', b['hard_cutoff'],
            '--receipt', str(ops / 'power-events.jsonl')]
    with (ops / 'power.log').open('x') as log:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log,
                                 stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(100):
        event = ops / 'power-events.jsonl'
        if event.exists() and event.stat().st_size:
            break
        if child.poll() is not None:
            raise ValueError('power guard failed; inspect, never repeat')
        time.sleep(.1)
    else:
        raise ValueError('power guard arming unknown; inspect, never repeat')
    value = {'version': 'e1-power-v1', 'binding': b, 'identity': identity(child.pid),
             'argv': argv, 'source': str(script), 'source_sha256': hashlib.sha256(script.read_bytes()).hexdigest()}
    write_new(ops / 'guard.json', value)
    verify_guard(ops, b)
    return value


def verify_guard(ops, b):
    safe_ops(ops, b)
    guard = json.loads((ops / 'guard.json').read_text(encoding='utf-8'))
    if 'power_lease' in b:
        from day_lease import verify_live, lease_path, read
        if (guard != {'version': 'e1-day-guard-v1', 'binding': b,
                      'day_guard': read(ops / 'day-guard.json')}
                or verify_live(lease_path(ops), b['power_lease']) != b['power_lease']):
            raise ValueError('original independent day guard differs')
        return guard
    rows = [json.loads(x) for x in (ops / 'power-events.jsonl').read_text(encoding='utf-8').splitlines()]
    if (guard['version'] != 'e1-power-v1' or guard['binding'] != b
            or guard['identity'] != identity(guard['identity']['pid'])
            or guard['identity']['argv'] != guard['argv']
            or hashlib.sha256(Path(guard['source']).read_bytes()).hexdigest() != guard['source_sha256']
            or not rows or rows[0]['status'] != 'armed' or rows[0]['deadline'] != b['hard_cutoff']
            or not aware(b['booted_at_proxy']) <= now() < aware(b['hard_cutoff'])):
        raise ValueError('original E1 guard identity/source/deadline differs')
    return guard


def shutdown(ops, reason):
    from shutdown_guard import shutdown_command
    errors = []
    try:
        write_new(ops / 'shutdown-request.json', {'at_utc': now().isoformat(), 'reason': reason})
    except OSError as error:
        errors.append(type(error).__name__)
    # A full log disk must not prevent the authorized power action.
    result = subprocess.run(shutdown_command(Path('/usr/bin/shutdown')), capture_output=True, timeout=30)
    value = {'at_utc': now().isoformat(), 'returncode': result.returncode, 'provider_billing_stopped': 'unknown'}
    if errors:
        value['request_log_errors'] = errors
    try:
        write_new(ops / 'shutdown-return.json', value)
    except OSError as error:
        value['return_log_error'] = type(error).__name__
    return value


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--arm', action='store_true'); mode.add_argument('--abort-setup', action='store_true')
    p.add_argument('--ops', type=Path, required=True); p.add_argument('--binding-json', required=True)
    a = p.parse_args()
    b = json.loads(a.binding_json)
    if a.arm:
        value = arm(a.ops, b)
    else:
        verify_guard(a.ops, b)
        gpu = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader'], text=True)
        if (a.ops / 'dispatch-reservation.json').exists() or active_workers() or gpu.strip():
            raise ValueError('dispatch may exist; cannot abort setup')
        if 'power_lease' in b:
            value = {'power_action': 'retained_under_original_day_lease',
                     'reason': 'known_E1_setup_failure_before_dispatch',
                     'shutdown_at_utc': b['power_shutdown_at_utc'], 'provider_billing_stopped': 'unknown'}
            write_new(a.ops / 'setup-failure-power-retained.json', value)
        else:
            value = shutdown(a.ops, 'known_E1_setup_failure_before_dispatch')
    print(json.dumps(value))
