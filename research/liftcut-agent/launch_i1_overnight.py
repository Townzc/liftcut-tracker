"""One conditional I1 dispatch/collector; no automatic retries or new power lease."""
import argparse
from datetime import timedelta
import getpass
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid

from d2_execution import event_file, expected_runtime, read, utcnow
from g4_execution import LEASE_DIR
from i1_protocol import (BUDGET, EXECUTION, ROOT, G4_COMMIT, aware, deadlines,
                         validate_opening, verify_adapter, verify_live_lease, verify_plan)
from i1_receipt_transfer import transfer_receipt, validate_index, validate_receipt
from launch_g3_remote import Remote, upload_verified
from launch_g4_overnight import download
from liftcut_agent.interactive import digest
from monitor_coverage_replication import TimeBudget, json_lines, persist_json, remote_bytes
from server_workspace import command, dump_new, sha256

PERSIST = PurePosixPath('/root/autodl-tmp/liftcut')
BASE = G4_COMMIT
PYTHON = str(PERSIST / 'envs/qwen-pilot-py312/bin/python')
G4_RUN = PurePosixPath(PERSIST / 'runs/g4-run-20261003-082710')
SHARED = PurePosixPath(PERSIST / 'data/g3-eaa1325')


def stage(output, commit, ref):
    plan = verify_plan()
    if (output.exists() or not re.fullmatch(r'[0-9a-f]{40}', commit)
            or command(['git', 'rev-parse', ref], ROOT) != commit
            or command(['git', 'diff', commit, '--', '.'], ROOT)
            or command(['git', 'status', '--porcelain', '--', '.'], ROOT)
            or command(['git', 'merge-base', BASE, commit], ROOT) != BASE):
        raise ValueError('fresh stage and exact clean I1 research commit required')
    output.mkdir(parents=True)
    command(['git', 'bundle', 'create', str((output / 'code.bundle').resolve()), ref, '^' + BASE], ROOT)
    command(['git', 'bundle', 'verify', str((output / 'code.bundle').resolve())], ROOT)
    shutil.copyfile(ROOT / 'd2_bundle.py', output / 'd2_bundle.py')
    result = {'commit': commit, 'base': BASE, 'execution_plan_sha256': sha256(EXECUTION),
              'files': {p.name: {'bytes': p.stat().st_size, 'sha256': sha256(p)} for p in output.iterdir()},
              'lease_configuration_digest': plan['lease_configuration_digest']}
    dump_new(output / 'stage.json', result)
    return result


def active_workers():
    found = []
    for path in Path('/proc').glob('[0-9]*'):
        if int(path.name) == os.getpid():
            continue
        try:
            argv = (path / 'cmdline').read_bytes().split(b'\0')
        except (FileNotFoundError, ProcessLookupError):
            continue
        names = {Path(x.decode(errors='replace')).name for x in argv[:3]}
        if any(n.startswith(('gpu_train_', 'gpu_g', 'run_g', 'gpu_i', 'run_i')) and n.endswith('.py') for n in names):
            found.append(int(path.name))
    return found


def dispatch(commit, run_id):
    if sys.platform != 'linux' or not re.fullmatch(r'[0-9]{8}-[0-9]{6}', run_id):
        raise ValueError('Linux unique I1 run ID required')
    plan = verify_plan()
    verify_live_lease(plan)
    if command(['git', 'rev-parse', 'HEAD'], ROOT) != commit or command(['git', 'status', '--porcelain'], ROOT):
        raise ValueError('clean exact I1 checkout required')
    if active_workers() or command(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader'], ROOT):
        raise ValueError('another controller/worker or GPU process is active')
    import importlib.metadata
    import platform
    expected = expected_runtime()
    if (platform.python_version() != expected['python'] or any(
            importlib.metadata.version(k) != v for k, v in expected['packages'].items())):
        raise ValueError('pinned inference runtime changed')
    from gpu_counterfactual_diagnostics import verify_model
    from prepare_state_diagnostics import verify_prepared as diagnostic
    from prepare_counterfactual_diagnostics import verify_prepared as d2, load_tokenizer
    g4, shared = Path(G4_RUN), Path(SHARED)  # These filesystem operations run only on Linux.
    reference = plan['reference']
    if (digest(read(g4 / 'comparison.json')) != reference['g4_comparison_digest']
            or sha256(g4 / 'off-instance-backup.json') != reference['g4_restore_receipt_sha256']
            or read(g4 / 'backup-copy-status.json')['off_instance_acknowledged'] is not True
            or read(g4 / 'opening.json')['binding'] != reference['g4_binding']):
        raise ValueError('actual restored G4 prerequisite differs')
    verify_adapter(g4 / 'training/control/final', reference)
    historical = read(Path(PERSIST / 'runs/g4-ops-20261003-082710/controller-launch.json'))['argv']
    get = lambda flag: Path(historical[historical.index(flag) + 1])
    model, manifest = get('--model-dir'), get('--model-manifest')
    verify_model(model, manifest)
    diagnostic(shared / 'diagnostic')
    d2(shared / 'd2')
    load_tokenizer(shared / 'tokenizer')
    now = utcnow()
    deadlines(now.isoformat(), now)
    run, ops = Path(PERSIST / 'runs' / ('i1-run-' + run_id)), Path(PERSIST / 'runs' / ('i1-ops-' + run_id))
    if run.exists() or ops.exists():
        raise ValueError('I1 run already exists; inspect unknown outcomes, never relaunch')
    dump_new(LEASE_DIR / 'i1-dispatch-reservation.json', {'commit': commit, 'run': str(run), 'at_utc': now.isoformat()})
    ops.mkdir()
    argv = [sys.executable, str(ROOT / 'run_i1_window.py'), '--model-dir', str(model),
            '--model-manifest', str(manifest), '--diagnostic-dir', str(shared / 'diagnostic'),
            '--d2-dir', str(shared / 'd2'), '--tokenizer-dir', str(shared / 'tokenizer'),
            '--g4-run-dir', str(g4), '--output-dir', str(run), '--expected-code-commit', commit,
            '--trial-started-at', now.isoformat(), '--execute']
    with (ops / 'controller.log').open('x') as log:
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
    result = {'pid': process.pid, 'argv': argv, 'trial_started_at_utc': now.isoformat(),
              'instance_boot': BUDGET['instance_boot']}
    dump_new(ops / 'controller-launch.json', result)
    return result


def collect(sftp, cfg, plan, opening, budget, emit):
    bind, sent, last = validate_opening(opening, plan), None, None
    while budget.remaining() > 0:
        raw = remote_bytes(sftp, cfg['remote_run'] + '/events.jsonl', budget, tail=True)
        (cfg['operations'] / 'server-events-latest.jsonl').write_bytes(raw or b'')
        rows = json_lines(raw)
        if rows and rows[-1] != last:
            last = rows[-1]
            emit('server_event', record=last)
        if sent is None:
            raw = remote_bytes(sftp, cfg['remote_run'] + '/backup-index.json', budget)
            if raw:
                index = json.loads(raw)
                validate_index(index, bind)
                persist_json(cfg['downloads'] / 'backup-index.json', index)
                for item in index['archives']:
                    download(sftp, item['path'], item, cfg, budget, emit)
                output = cfg['restored'] / uuid.uuid4().hex
                argv = [str(cfg['restore_python']), str(ROOT / 'restore_i1.py'), '--archive-dir', str(cfg['downloads']),
                        '--output-dir', str(output), '--allow-partial']
                for key, flag in [('diagnostic', 'diagnostic-dir'), ('d2', 'd2-dir'), ('tokenizer', 'tokenizer-dir')]:
                    argv += ['--' + flag, str(cfg[key])]
                emit('restore_started', output=str(output))
                with (cfg['operations'] / 'restore.log').open('x', encoding='utf-8') as log:
                    subprocess.run(argv, check=True, timeout=max(1, budget.remaining()-60), stdout=log, stderr=subprocess.STDOUT)
                receipt = output / 'off-instance-backup.json'
                actual = validate_receipt(receipt.read_bytes(), index, bind)
                emit('off_instance_verified', receipt=actual)
                sent = transfer_receipt(sftp, receipt, cfg['remote_run'], index, bind, budget.deadline,
                                        now=budget.now, emit=emit)
                if sent['status'] not in ('published', 'already_present'):
                    return sent
        raw = remote_bytes(sftp, cfg['remote_run'] + '/backup-copy-status.json', budget)
        if raw:
            status = json.loads(raw)
            persist_json(cfg['operations'] / 'backup-copy-status.json', status)
            emit('server_receipt_observed', value=status)
            return {'receipt_transfer': sent, 'server_consumed': status['off_instance_acknowledged'],
                    'server_intentionally_on': True, 'provider_billing_stopped': False}
        time.sleep(min(5 if sent else 20, budget.remaining()))
    return {'status': 'original_collection_deadline_reached', 'receipt_transfer': sent}


def execute(stage_dir, config_file, run_id):
    cfg, spec = read(config_file), read(stage_dir / 'stage.json')
    commit = spec['commit']
    if not re.fullmatch(r'[0-9]{8}-[0-9]{6}', run_id):
        raise ValueError('unique I1 run ID required')
    for key in ('diagnostic', 'd2', 'tokenizer', 'restore_python', 'known_hosts'):
        cfg[key] = Path(cfg[key]).expanduser().resolve()
    subprocess.run([str(cfg['restore_python']), str(ROOT / 'i1_protocol.py'), '--verify',
                    '--diagnostic-dir', str(cfg['diagnostic']), '--d2-dir', str(cfg['d2']),
                    '--tokenizer-dir', str(cfg['tokenizer'])], check=True, timeout=90)
    plan = verify_plan()
    if spec['execution_plan_sha256'] != sha256(EXECUTION) or spec['base'] != BASE:
        raise ValueError('I1 staged plan/base changed')
    for name, item in spec['files'].items():
        if (Path(name).name != name or sha256(stage_dir / name) != item['sha256']
                or (stage_dir / name).stat().st_size != item['bytes']):
            raise ValueError('staged I1 file changed')
    cfg['remote_run'] = str(PERSIST / 'runs' / ('i1-run-' + run_id))
    for key in ('operations', 'downloads', 'restored'):
        cfg[key] = ROOT / 'outputs/autodl' / ('i1-' + run_id + '-' + key)
        cfg[key].mkdir(parents=True, exist_ok=False)
    (cfg['operations'] / 'monitor.lock').write_text(str(os.getpid()), encoding='utf-8')
    dump_new(cfg['operations'] / 'config.json', {k: str(v) if isinstance(v, Path) else v for k, v in cfg.items()})
    emit = lambda event, **kw: (event_file(cfg['operations'] / 'events.jsonl', event, **kw),
                               print(json.dumps({'event': event, **kw}), flush=True))
    import paramiko
    client = paramiko.SSHClient()
    client.load_host_keys(str(cfg['known_hosts']))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    setup = TimeBudget(min(utcnow() + timedelta(minutes=10), aware(BUDGET['work_latest']) - timedelta(minutes=55)))
    setup.check()
    timer = threading.Timer(max(1, (aware(BUDGET['collection_latest'])-utcnow()).total_seconds()), client.close)
    timer.daemon = True
    timer.start()
    password = getpass.getpass('I1 AutoDL password (not stored): ')
    try:
        client.connect(cfg['ssh_host'], port=cfg['ssh_port'], username=cfg['ssh_user'], password=password,
                       look_for_keys=False, allow_agent=False, timeout=15, auth_timeout=15, banner_timeout=15)
        password = None
        emit('ssh_connected')
        remote = Remote(client, cfg['operations'], setup, emit)
        directory, checkout = PERSIST / 'staging' / ('i1-' + run_id), PERSIST / 'code' / commit
        with client.open_sftp() as sftp:
            sftp.mkdir(str(directory))
            def remote_hash(path):
                code = 'import hashlib;from pathlib import Path;p=Path(' + repr(path) + ');print(hashlib.file_digest(p.open("rb"),"sha256").hexdigest())'
                return remote.run([PYTHON, '-c', code], 'hash').strip()
            for name in spec['files']:
                upload_verified(stage_dir / name, str(directory / name), sftp, remote_hash, setup, emit)
            install = 'import sys;sys.path.insert(0,' + repr(str(directory)) + ');from d2_bundle import install_bundle;print(install_bundle(' + repr(str(directory / 'code.bundle')) + ',' + repr(str(checkout)) + ',' + repr(commit) + ',' + repr(str(PERSIST / 'code' / BASE)) + ',' + repr(BASE) + '))'
            remote.run([PYTHON, '-c', install], 'install-code', timeout=180)
            result = json.loads(remote.run([PYTHON, str(checkout / 'research/liftcut-agent/launch_i1_overnight.py'),
                                           '--dispatch', '--commit', commit, '--run-id', run_id], 'dispatch', timeout=120))
            dump_new(cfg['operations'] / 'launch.json', result)
            emit('controller_dispatched', **result)
            for _ in range(30):
                raw = remote_bytes(sftp, cfg['remote_run'] + '/opening.json', setup)
                if raw:
                    break
                time.sleep(1)
            else:
                raise ValueError('I1 opening absent; inspect current dispatch, no retry')
            opening = json.loads(raw)
            bind = validate_opening(opening, plan)
            if bind['code_commit'] != commit or bind['trial_started_at_utc'] != result['trial_started_at_utc']:
                raise ValueError('I1 launch binding differs')
            dump_new(cfg['operations'] / 'opening.json', opening)
            outcome = collect(sftp, cfg, plan, opening, TimeBudget(aware(bind['collection_cutoff'])), emit)
            emit('collector_finished', result=outcome)
            return outcome
    except Exception as error:
        emit('collector_stopped', error_type=type(error).__name__, message=str(error), no_automatic_reconnect=True)
        raise
    finally:
        password = None
        client.close()
        timer.cancel()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('dispatch', 'stage', 'execute'):
        p.add_argument('--' + name, action='store_true')
    for name in ('stage-dir', 'config'):
        p.add_argument('--' + name, type=Path)
    for name in ('commit', 'ref', 'run-id'):
        p.add_argument('--' + name)
    a = p.parse_args()
    if sum((a.dispatch, a.stage, a.execute)) != 1:
        p.error('select exactly one action')
    result = dispatch(a.commit, a.run_id) if a.dispatch else stage(a.stage_dir, a.commit, a.ref) if a.stage else execute(a.stage_dir, a.config, a.run_id)
    print(json.dumps(result))
