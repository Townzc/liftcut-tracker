"""Explicit overnight power lease, separate from immutable G3 training and evidence.

Only a fully archived, child-free G3 controller may be retired in its backup wait.
An independently armed replacement guard must exist before any original guard ends.
No model launch, receipt creation, original-file rewrite or power-on capability.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

DEADLINE = '2026-10-03T14:00:00+00:00'
COMMIT = 'eaa132538fefdf28973d808dd56a159e19b86d67'
RUN = '/root/autodl-tmp/liftcut/runs/g3-run-20261003-053547'
ORIGINAL_HARD = '2026-10-03T08:35:00.409447+00:00'


def now():
    return datetime.now(timezone.utc)


def validate_lease(cfg, at):
    if (cfg['version'] != 'liftcut-overnight-lease-v1' or cfg['deadline'] != DEADLINE
            or cfg['reserve_cny'] != 20 or cfg['hourly_cny'] != 2.18
            or cfg['execution_commit'] != COMMIT or cfg['g3_run'] != RUN
            or cfg['code_root'] != f'/root/autodl-tmp/liftcut/code/{COMMIT}/research/liftcut-agent'
            or cfg['original_hard_cutoff'] != ORIGINAL_HARD
            or cfg['authorization'] != 'explicit_user_20261003_overnight_0700_Los_Angeles_CNY20'):
        raise ValueError('lease must match the explicit overnight authorization')
    boot, end = (datetime.fromisoformat(cfg[k]) for k in ('booted_at_proxy', 'deadline'))
    if at.utcoffset() is None or not boot <= at < end or (end-boot).total_seconds() > 8.5*3600:
        raise ValueError('invalid authorized lease interval')
    maximum = (end-boot).total_seconds()*2.18/3600 + cfg['earlier_failed_opening_cny']
    if not 0 <= cfg['earlier_failed_opening_cny'] <= 1 or maximum > cfg['reserve_cny']:
        raise ValueError('cumulative compute proxy exceeds the authorization')
    return end, maximum


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def log(folder, event, **fields):
    row = {'event': event, 'at_utc': now().isoformat(), **fields}
    with (folder/'events.jsonl').open('a', encoding='utf-8') as out:
        out.write(json.dumps(row, separators=(',', ':'))+'\n')
    return row


def exclusive(path, obj):
    with path.open('x', encoding='utf-8') as out:
        json.dump(obj, out, indent=2)
        out.write('\n')


def process(pid):
    p = Path('/proc')/str(pid)
    argv = [x.decode() for x in (p/'cmdline').read_bytes().split(b'\0') if x]
    # comm may contain spaces, so parse only the tail after its final ')'.
    stat = (p/'stat').read_text().rsplit(')', 1)[1].split()
    return {'pid': pid, 'argv': argv, 'state': stat[0], 'ppid': int(stat[1]), 'start_ticks': stat[19]}


def checked_process(identity):
    current = process(identity['pid'])
    if (current['argv'] != identity['argv'] or current['start_ticks'] != identity['start_ticks']
            or current['state'] == 'Z'):
        raise ValueError('PID identity changed; do not signal it')
    return current


def shutdown():
    p = Path('/usr/bin/shutdown')
    with p.open('rb') as stream:
        prefix = stream.read(4)
    argv = [str(p)] if prefix.startswith((b'#!', b'\x7fELF')) else ['/bin/bash', str(p)]
    return subprocess.run(argv, capture_output=True, timeout=30).returncode


def guard(cfg, folder):
    deadline, maximum = validate_lease(cfg, now())
    identity = process(os.getpid())
    exclusive(folder/'guard-armed.json', {'deadline': cfg['deadline'], 'identity': identity,
                                        'maximum_compute_proxy_cny': maximum})
    log(folder, 'new_hard_guard_armed', deadline=cfg['deadline'], identity=identity)
    until = time.monotonic()+(deadline-now()).total_seconds()
    while time.monotonic() < until:
        time.sleep(min(15, max(0, until-time.monotonic())))
    log(folder, 'overnight_shutdown_requested', provider_billing_stopped='unknown')
    try:
        result = shutdown()
        exclusive(folder/'shutdown-return.json', {'returncode': result, 'at_utc': now().isoformat(),
                                                  'provider_billing_stopped': 'unknown'})
        log(folder, 'overnight_shutdown_returned', returncode=result, provider_billing_stopped='unknown')
    except Exception as error:
        log(folder, 'overnight_shutdown_error', error_type=type(error).__name__)
        raise


def guard_alive(folder, cfg):
    armed = read(folder/'guard-armed.json')
    if armed['deadline'] != cfg['deadline']:
        raise ValueError('replacement guard deadline differs')
    checked_process(armed['identity'])


def archive_ready(run, cfg):
    index_path = run/'backup-index.json'
    if not index_path.exists():
        return None
    index, status = read(index_path), read(run/'window-status.json')
    if (index['binding']['code_commit'] != cfg['execution_commit']
            or index['binding']['hard_cutoff'] != cfg['original_hard_cutoff']
            or index['binding']['booted_at_proxy'] != cfg['booted_at_proxy']
            or status['binding'] != index['binding'] or status['status'] != index['status']):
        raise ValueError('original G3 identity or completion differs')
    sys.path[:0] = [str(Path(cfg['code_root'])), str(Path(cfg['code_root'])/'src')]
    from g3_receipt_transfer import validate_index
    validate_index(index, index['binding'])
    for item in index['archives']:
        path = run/item['path']
        if path.is_symlink() or path.stat().st_size != item['bytes']:
            raise ValueError('G3 archive is not complete on disk')
        with path.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
                raise ValueError('G3 archive SHA differs')
    return index


def handoff(cfg, folder):
    validate_lease(cfg, now())
    guard_alive(folder, cfg)
    run = Path(cfg['g3_run'])
    # These saved /proc identities are captured by the installer, never guessed from names.
    controller = cfg['controller_identity']
    log(folder, 'handoff_watcher_started', original_controller_pid=controller['pid'])
    while now() < datetime.fromisoformat(cfg['original_hard_cutoff']):
        guard_alive(folder, cfg)
        checked_process(controller)
        index = archive_ready(run, cfg)
        if index is not None:
            os.kill(controller['pid'], signal.SIGSTOP)
            try:
                checked_process(controller)
                # G3 backup finalization has no remaining worker process. Never stop a training child.
                for p in Path('/proc').iterdir():
                    if p.name.isdigit():
                        try:
                            child = process(int(p.name))
                        except (OSError, ValueError):
                            continue
                        if child['ppid'] == controller['pid'] and child['state'] != 'Z':
                            raise ValueError('controller still has a live worker')
                guard_alive(folder, cfg)
                for original in cfg['original_guard_identities']:
                    checked_process(original)
                # The archived work is complete/partial already; retire only the backup-wait controller.
                os.kill(controller['pid'], signal.SIGKILL)
                log(folder, 'original_backup_wait_controller_retired', identity=controller,
                    run_status=index['status'], training_conditions_changed=False,
                    reason='new explicit overnight power lease; archives already complete')
                for original in cfg['original_guard_identities']:
                    checked_process(original)
                    os.kill(original['pid'], signal.SIGTERM)
                    log(folder, 'original_power_guard_superseded', identity=original, new_deadline=cfg['deadline'])
                exclusive(folder/'handoff-complete.json', {'index': index, 'at_utc': now().isoformat(),
                    'training_conditions_changed': False, 'original_shutdown_deferred_by_user': True,
                    'original_controller_receipt_consumption': 'unobserved',
                    'replacement_guard': read(folder/'guard-armed.json'), 'new_receipts_created': 0})
                return
            except BaseException:
                try:
                    checked_process(controller)
                    os.kill(controller['pid'], signal.SIGCONT)
                except (OSError, ValueError):
                    pass
                raise
        time.sleep(1)
    raise TimeoutError('original G3 backup never became available; original guards were retained')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--lease', required=True, type=Path)
    p.add_argument('--mode', choices=['guard', 'handoff'], required=True)
    a = p.parse_args()
    cfg = read(a.lease)
    if sys.platform != 'linux' or not Path('/root/autodl-tmp').is_dir():
        raise ValueError('only the authorized AutoDL instance can run this power policy')
    folder = a.lease.resolve().parent
    try:
        (guard if a.mode == 'guard' else handoff)(cfg, folder)
    except Exception as error:
        log(folder, 'lease_process_failed', mode=a.mode, error_type=type(error).__name__)
        raise
