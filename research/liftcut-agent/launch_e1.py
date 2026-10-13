"""Stage offline, or perform one explicitly authorized FUTURE E1 dispatch/restore.

No credentials on disk, no automatic reconnect/retry, no reuse of the old night.
The small power guard is armed before the larger Git delta is transmitted.
"""
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
from d2_execution import aware, read, utcnow, event_file
from e1_execution import ROOT, EXECUTION, verify_plan, binding, validate_opening, verify_parent
from e1_data_use import reserve
from e1_receipt import validate_index, validate_receipt, transfer_receipt
from launch_i3 import configure as parent_configure
from launch_g3_remote import Remote, upload_verified
from launch_g4_overnight import download
from liftcut_agent.interactive import digest
from monitor_coverage_replication import TimeBudget, remote_bytes, json_lines, persist_json
from server_workspace import command, dump_new, sha256

PERSIST = PurePosixPath('/root/autodl-tmp/liftcut')
BOOTSTRAP = ('e1_power.py', 'shutdown_guard.py', 'd2_bundle.py', 'day_lease.py', 'gpu_telemetry.py')


def stage(output, commit, ref):
    plan = verify_plan(); base = plan['parent_execution_commit']
    if (output.exists() or not re.fullmatch('[0-9a-f]{40}', commit)
            or command(['git', 'rev-parse', ref], ROOT) != commit
            or command(['git', 'diff', commit, '--', '.'], ROOT)
            or command(['git', 'status', '--porcelain', '--', '.'], ROOT)):
        raise ValueError('new stage and clean exact reviewed research commit required')
    output.mkdir(parents=True)
    command(['git', 'bundle', 'create', str((output / 'code.bundle').resolve()), ref, '^' + base], ROOT)
    command(['git', 'bundle', 'verify', str((output / 'code.bundle').resolve())], ROOT)
    for name in BOOTSTRAP:
        shutil.copyfile(ROOT / name, output / name)
    spec = {'version': 'e1-stage-v1', 'commit': commit, 'base': base,
            'execution_plan_sha256': sha256(EXECUTION), 'asset_upload_bytes': 0,
            'files': {p.name: {'bytes': p.stat().st_size, 'sha256': sha256(p)} for p in output.iterdir()}}
    dump_new(output / 'stage.json', spec)
    verify_stage(output)
    return spec


def verify_stage(directory):
    plan = verify_plan(); spec = read(directory / 'stage.json')
    if (spec['version'] != 'e1-stage-v1' or spec['base'] != plan['parent_execution_commit']
            or not re.fullmatch('[0-9a-f]{40}', spec['commit'])
            or spec['execution_plan_sha256'] != sha256(EXECUTION) or spec['asset_upload_bytes'] != 0
            or set(spec['files']) != {'code.bundle', *BOOTSTRAP}
            or sum(v['bytes'] for v in spec['files'].values()) > 20_000_000):
        raise ValueError('small immutable E1 code-only stage required')
    for n, v in spec['files'].items():
        path = directory / n
        if path.is_symlink() or path.stat().st_size != v['bytes'] or sha256(path) != v['sha256']:
            raise ValueError('E1 stage bytes differ')
        if n in BOOTSTRAP and sha256(ROOT / n) != v['sha256']:
            raise ValueError('E1 bootstrap source differs')
    return spec


def configure(raw, run_id):
    cfg = parent_configure(raw, run_id)
    for n in ('run', 'ops'):
        cfg['remote_' + n] = str(PERSIST / 'runs' / ('e1-' + n + '-' + run_id))
    for n in ('operations', 'downloads', 'restored'):
        cfg[n] = ROOT / 'outputs/autodl' / ('e1-' + run_id + '-' + n)
    return cfg


def _collect(sftp, cfg, plan, opening, budget, emit):
    b = validate_opening(opening, plan); sent = None; consumed = None; last = None
    while budget.remaining() > 0:
        raw = remote_bytes(sftp, cfg['remote_run'] + '/events.jsonl', budget, tail=True)
        (cfg['operations'] / 'server-events-latest.jsonl').write_bytes(raw or b'')
        rows = json_lines(raw)
        if rows and rows[-1] != last:
            last = rows[-1]; emit('server_event', record=last)
        if sent is None:
            raw = remote_bytes(sftp, cfg['remote_run'] + '/backup-index.json', budget)
            if raw:
                index = json.loads(raw); validate_index(index, b)
                persist_json(cfg['downloads'] / 'backup-index.json', index)
                for item in index['archives']:
                    download(sftp, item['path'], item, cfg, budget, emit)
                output = cfg['restored'] / uuid.uuid4().hex
                argv = [str(cfg['restore_python']), str(ROOT / 'restore_e1.py'), '--archive-dir', str(cfg['downloads']),
                        '--output-dir', str(output), '--allow-partial']
                for key, flag in (('tokenizer', 'tokenizer-dir'), ('parent_run_local', 'parent-run'),
                                  ('parent_receipt_local', 'parent-receipt'), ('parent_index_local', 'parent-index')):
                    argv += ['--' + flag, str(cfg[key])]
                emit('restore_started', output=str(output))
                with (cfg['operations'] / 'restore.log').open('x', encoding='utf-8') as log:
                    subprocess.run(argv, check=True, timeout=max(1, budget.remaining() - 30), stdout=log, stderr=subprocess.STDOUT)
                receipt = output / 'off-instance-backup.json'
                emit('off_instance_verified', receipt=validate_receipt(receipt.read_bytes(), index, b))
                sent = transfer_receipt(sftp, receipt, cfg['remote_run'], index, b,
                                        budget.deadline, now=budget.now, emit=emit)
                persist_json(cfg['operations'] / 'receipt-transfer.json', sent)
                if sent['status'] not in ('published', 'already_present'):
                    return {'receipt_transfer': sent, 'server_consumed': None, 'provider_billing_stopped': 'unknown'}
        raw = remote_bytes(sftp, cfg['remote_run'] + '/backup-copy-status.json', budget)
        if raw and consumed is None:
            value = json.loads(raw); persist_json(cfg['operations'] / 'backup-copy-status.json', value)
            consumed = value['off_instance_acknowledged']
            if type(consumed) is not bool:
                raise ValueError('server consumption must be an observed boolean')
            emit('server_receipt_observed', value=value)
        if 'power_lease' in b and sent is not None and consumed is not None:
            raw = remote_bytes(sftp, cfg['remote_run'] + '/window-close.json', budget)
            if raw:
                close = json.loads(raw)
                if (close['binding'] != b or close['off_instance_acknowledged'] is not consumed
                        or close['experiment_status'] != index['status']
                        or close['power_action'] != 'retained_under_original_day_lease'
                        or close['shutdown_at_utc'] != b['power_shutdown_at_utc']):
                    raise ValueError('original day trial closure differs')
                persist_json(cfg['operations'] / 'window-close.json', close)
                telemetry = remote_bytes(sftp, cfg['remote_ops'] + '/gpu-samples.jsonl', budget, limit=16_777_216)
                if telemetry is not None:
                    (cfg['operations'] / 'gpu-samples-at-collection.jsonl').write_bytes(telemetry)
                return {'status': 'trial_closed_power_retained', 'receipt_transfer': sent,
                        'server_consumed': consumed, 'power_action': close['power_action'],
                        'shutdown_at_utc': b['power_shutdown_at_utc'], 'provider_billing_stopped': 'unknown'}
        # These are observations, not inferences from a successful local exit.
        for filename in ('shutdown-request.json', 'shutdown-return.json'):
            target = cfg['operations'] / filename
            if not target.exists():
                raw = remote_bytes(sftp, cfg['remote_ops'] + '/' + filename, budget)
                if raw:
                    target.write_bytes(raw); emit('power_record_observed', file=filename)
        time.sleep(min(2, max(0, budget.remaining())))
    return {'status': 'original_collection_deadline', 'receipt_transfer': sent,
            'server_consumed': consumed, 'provider_power_state': 'unknown', 'provider_billing_stopped': 'unknown'}


def collect(sftp, cfg, plan, opening, budget, emit):
    try:
        return _collect(sftp, cfg, plan, opening, budget, emit)
    except Exception as error:
        # A shutdown may break SSH before its command result is readable. Preserve
        # each actual observation; a published receipt is not server consumption
        # and a disconnected transport is not proof of provider billing status.
        channel = sftp.get_channel()
        transport = channel.get_transport()
        if transport is not None and transport.is_active():
            raise
        transfer = cfg['operations'] / 'receipt-transfer.json'
        if not transfer.exists():
            raise
        sent = read(transfer)
        if sent['status'] not in ('published', 'already_present'):
            raise
        acceptance = cfg['operations'] / 'backup-copy-status.json'
        consumed = read(acceptance)['off_instance_acknowledged'] if acceptance.exists() else None
        result = {'status': 'connection_ended_after_receipt_publication', 'receipt_transfer': sent,
                  'server_consumed': consumed, 'error_type': type(error).__name__,
                  'shutdown_request_observed': (cfg['operations'] / 'shutdown-request.json').exists(),
                  'shutdown_return_observed': (cfg['operations'] / 'shutdown-return.json').exists(),
                  'provider_power_state': 'unknown', 'provider_billing_stopped': 'unknown'}
        emit('connection_end_observed', result=result)
        return result


def execute(stage_dir, config_file, run_id, authorization_file):
    cfg = configure(read(config_file), run_id); spec = verify_stage(stage_dir); plan = verify_plan()
    b = binding(plan, spec['commit'], read(authorization_file), run_id, utcnow().isoformat())
    verify_parent(cfg['parent_run_local'], plan, cfg['parent_receipt_local'], cfg['parent_index_local'])
    # The persistent dataset key, not just a new run ID, prevents silent retries.
    reserve(ROOT / 'outputs/autodl/e1-data-use', plan['protocol'], b, side='local')
    for n in ('operations', 'downloads', 'restored'):
        cfg[n].mkdir(parents=True, exist_ok=False)
    dump_new(cfg['operations'] / 'binding.json', b)
    dump_new(cfg['operations'] / 'config.json', {k: str(v) if isinstance(v, Path) else v for k, v in cfg.items()})
    def emit(event, **fields):
        event_file(cfg['operations'] / 'events.jsonl', event, **fields)
        print(json.dumps({'event': event, **fields}), flush=True)
    emit('exclusive_local_dispatch_reserved', pid=os.getpid(), commit=spec['commit'], binding=b)
    import paramiko
    client = paramiko.SSHClient(); client.load_host_keys(str(cfg['known_hosts']))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    password = getpass.getpass('Authorized future E1 instance password (not stored): ')
    setup = TimeBudget(aware(b['booted_at_proxy']) + timedelta(minutes=10))
    if setup.remaining() <= 0:
        raise TimeoutError('original E1 setup deadline passed')
    timer = threading.Timer(setup.remaining(), client.close); timer.daemon = True; timer.start()
    dispatched, armed = False, False
    directory = PERSIST / 'staging' / ('e1-' + run_id)
    try:
        client.connect(cfg['ssh_host'], port=cfg['ssh_port'], username=cfg['ssh_user'], password=password,
                       look_for_keys=False, allow_agent=False, timeout=15, auth_timeout=15, banner_timeout=15)
        password = None; emit('ssh_connected')
        remote = Remote(client, cfg['operations'], setup, emit); py = cfg['bootstrap_python']
        remote.run([py, '-c', 'from pathlib import Path;Path(' + repr(str(directory)) + ').mkdir(exist_ok=False)'], 'new-stage')
        with client.open_sftp() as sftp:
            def remote_hash(path):
                code = 'from pathlib import Path;import hashlib;h=hashlib.sha256();f=Path(' + repr(path) + ').open("rb")\nfor b in iter(lambda:f.read(1048576),b""):h.update(b)\nprint(h.hexdigest())'
                return remote.run([py, '-c', code], 'hash').strip()
            for name in BOOTSTRAP:
                upload_verified(stage_dir / name, str(directory / name), sftp, remote_hash, setup, emit)
            power_argv = [py, str(directory / 'e1_power.py'), '--arm', '--ops', cfg['remote_ops'], '--binding-json', json.dumps(b)]
            guard = json.loads(remote.run(power_argv, 'arm-original-power', timeout=30))
            armed = True; dump_new(cfg['operations'] / 'guard.json', guard)
            upload_verified(stage_dir / 'code.bundle', str(directory / 'code.bundle'), sftp, remote_hash, setup, emit)
            checkout = PERSIST / 'code' / spec['commit']; base = PERSIST / 'code' / spec['base']
            code = 'import sys;sys.path.insert(0,' + repr(str(directory)) + ');from d2_bundle import install_bundle;print(install_bundle(' + ','.join(repr(str(x)) for x in (directory / 'code.bundle', checkout, spec['commit'], base, spec['base'])) + '))'
            remote.run([py, '-c', code], 'install-new-checkout', timeout=180)
            argv = [cfg['remote_python'], str(checkout / 'research/liftcut-agent/e1_setup.py'), '--dispatch',
                    '--binding-json', json.dumps(b), '--ops', cfg['remote_ops'], '--run', cfg['remote_run'],
                    '--model-dir', cfg['remote_model'], '--model-manifest', cfg['remote_model_manifest'],
                    '--tokenizer-dir', str(PurePosixPath(cfg['remote_data']) / 'tokenizer'), '--parent-run', cfg['remote_parent_run']]
            dispatched = True  # set BEFORE issuing an uncertain remote mutation
            launched = json.loads(remote.run(argv, 'dispatch', timeout=180))
            if validate_opening(launched['opening'], plan) != b:
                raise ValueError('actual E1 dispatch changed original binding')
            dump_new(cfg['operations'] / 'launch.json', launched); emit('controller_dispatched', value=launched)
            timer.cancel(); budget = TimeBudget(aware(b['collection_cutoff']))
            timer = threading.Timer(budget.remaining(), client.close); timer.daemon = True; timer.start()
            result = collect(sftp, cfg, plan, launched['opening'], budget, emit)
            emit('collector_finished', result=result); return result
    except BaseException as error:
        emit('collector_stopped', error_type=type(error).__name__, dispatch_may_have_started=dispatched,
             power_guard_armed=armed, no_automatic_reconnect=True, provider_billing_stopped='unknown')
        if armed and not dispatched:
            # Same live session only. The bootstrap checks no dispatch/worker/GPU
            # before requesting the already authorized failure shutdown.
            try:
                value = remote.run([py, str(directory / 'e1_power.py'), '--abort-setup', '--ops', cfg['remote_ops'],
                                    '--binding-json', json.dumps(b)], 'abort-known-setup', timeout=30)
                emit('known_setup_shutdown_returned', value=json.loads(value))
            except Exception as abort_error:
                emit('setup_shutdown_observation_unknown', error_type=type(abort_error).__name__)
        raise
    finally:
        password = None; client.close(); timer.cancel()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--stage', action='store_true'); mode.add_argument('--execute', action='store_true')
    for n in ('output-dir', 'stage-dir', 'config', 'authorization'):
        p.add_argument('--' + n, type=Path)
    for n in ('commit', 'ref', 'run-id'):
        p.add_argument('--' + n)
    a = p.parse_args()
    print(stage(a.output_dir, a.commit, a.ref) if a.stage else execute(a.stage_dir, a.config, a.run_id, a.authorization))
