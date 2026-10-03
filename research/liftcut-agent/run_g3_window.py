"""G3 seed42 paired pilot with fresh training, early backups and original deadlines."""
import argparse
from datetime import timedelta
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

from d2_execution import event_file, read, utcnow
from g3_execution import ARMS, BUDGET, ROOT, Clock, aware, binding, deadlines, verify_plan
from g3_receipt_transfer import validate_receipt
from gpu_counterfactual_diagnostics import verify_model
from prepare_counterfactual_diagnostics import verify_prepared as verify_d2
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from run_controlled_window import evidence_backup
from run_counterfactual_window import run_phase
from run_recovery_window import archive_run, wait_guard_armed
from server_workspace import command, dump_new
from shutdown_guard import shutdown_command


def budget_from_setup(path, booted_at):
    rows = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]
    _, hard = deadlines(booted_at, aware(booted_at))
    if not rows or rows[0].get('status') != 'armed' or aware(rows[0]['deadline']) != hard:
        raise ValueError('original-deadline setup guard must already be armed')


def phases(model, manifest, prepared, diagnostic, d2, tokenizer, output, commit):
    shared = ['--model-dir', str(model), '--model-manifest', str(manifest), '--prepared-dir', str(prepared),
              '--run-dir', str(output), '--expected-code-commit', commit]
    commands = []
    for arm in ARMS:
        commands.append(('train-' + arm, [sys.executable, str(ROOT / 'gpu_train_g3.py'), *shared,
            '--arm', arm, '--output-dir', str(output / 'training' / arm), '--allow-gpu']))
        commands.append(('evaluate-' + arm, [sys.executable, str(ROOT / 'gpu_g3.py'), *shared,
            '--arm', arm, '--diagnostic-dir', str(diagnostic), '--d2-dir', str(d2), '--allow-gpu']))
    commands.append(('audit', [sys.executable, str(ROOT / 'audit_g3.py'), '--run-dir', str(output),
        '--prepared-dir', str(prepared), '--diagnostic-dir', str(diagnostic), '--d2-dir', str(d2),
        '--tokenizer-dir', str(tokenizer), '--output', str(output / 'comparison.json')]))
    return commands


def execute_phases(commands, output, bind, work, clock, *, phase_runner=run_phase):
    for name, argv in commands:
        phase_runner(name, argv, output, work, clock)
        if name.startswith('train-'):
            arm = name.removeprefix('train-')
            if arm not in ARMS:
                raise ValueError('unknown G3 arm')
            backup = archive_run(output / 'training' / arm)
            event_file(output / 'early-index.jsonl', 'arm_archive', arm=arm, binding=bind,
                       path='training/' + backup['archive'], **backup)


def finalize(output, status, failures, bind, hard, clock, *, kind='model', sleep=time.sleep,
             shutdown=None, grace_seconds=900):
    shutdown = shutdown or (lambda: subprocess.run(shutdown_command(Path('/usr/bin/shutdown')),
                                                   capture_output=True, timeout=30).returncode)
    acknowledged, index = False, None
    try:
        dump_new(output / 'window-status.json', {'status': status, 'failures': failures, 'binding': bind,
            'finished_work_at_utc': clock.now().isoformat(), 'provider_billing_stopped': 'unknown'})
        archives = []
        for arm in ARMS:
            directory = output / 'training' / arm
            if directory.exists():
                # Preserve partial training as bytes, never upgrade it to complete.
                backup = read(directory / 'backup-ready.json') if (directory / 'backup-ready.json').exists() else archive_run(directory)
                archives.append({'part': arm, 'path': 'training/' + backup['archive'], **backup})
        backup = evidence_backup(output)
        archives.append({'part': 'evidence', 'path': backup['archive'], **backup})
        index = {'version': 'g3-backup-v1', 'binding': bind, 'evidence_kind': kind, 'status': status, 'archives': archives}
        dump_new(output / 'backup-index.json', index)
        event_file(output / 'events.jsonl', 'backup_ready', index=index)
        until = min(hard - timedelta(seconds=60), clock.now() + timedelta(seconds=grace_seconds))
        while clock.now() < until:
            receipt = output / 'off-instance-backup.json'
            if receipt.exists():
                try:
                    validate_receipt(receipt.read_bytes(), index, bind, kind=kind)
                    acknowledged = True
                    event_file(output / 'events.jsonl', 'server_receipt_consumed', status=status)
                    break
                except (ValueError, KeyError, TypeError, OSError):
                    pass
            sleep(min(2, max(0, (until - clock.now()).total_seconds())))
        dump_new(output / 'backup-copy-status.json', {'off_instance_acknowledged': acknowledged})
    except Exception as error:
        print(json.dumps({'backup_failure': type(error).__name__, 'persistent_bytes_retained': True}), flush=True)
    finally:
        try:
            event_file(output / 'events.jsonl', 'shutdown_requested', acknowledged=acknowledged)
        except Exception:
            pass
        try:
            code = shutdown()
            dump_new(output / 'shutdown-request.json', {'returncode': code, 'at_utc': clock.now().isoformat(),
                'provider_power_state_verified': False, 'provider_billing_stopped': 'unknown'})
        except Exception as error:
            print(json.dumps({'shutdown_error': type(error).__name__, 'independent_guard_retained': True}), flush=True)
    return index


def main():
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('model-dir', 'model-manifest', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir', 'output-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--expected-code-commit', required=True)
    p.add_argument('--hourly-cny', type=float, required=True)
    p.add_argument('--booted-at')
    p.add_argument('--setup-guard', type=Path)
    p.add_argument('--execute', action='store_true')
    p.add_argument('--shutdown-when-done', action='store_true')
    args = p.parse_args()
    plan = verify_plan(args.prepared_dir)
    verify_diagnostic(args.diagnostic_dir)
    verify_d2(args.d2_dir)
    if args.hourly_cny != BUDGET['hourly_cny']:
        raise ValueError('price differs from reviewed G3 budget')
    commands = phases(args.model_dir, args.model_manifest, args.prepared_dir, args.diagnostic_dir,
                       args.d2_dir, args.tokenizer_dir, args.output_dir, args.expected_code_commit)
    if not args.execute:
        print(json.dumps({'dry_run': True, 'gpu_calls': 0, 'budget': BUDGET, 'phases': commands}, indent=2))
        return 0
    if (platform.system() != 'Linux' or not Path('/root/autodl-tmp').is_dir() or not args.booted_at
            or not args.shutdown_when_done or args.setup_guard is None):
        raise ValueError('new authorized AutoDL opening and setup guard required')
    work, hard = deadlines(args.booted_at, utcnow())
    rows = [json.loads(line) for line in args.setup_guard.read_text().splitlines()]
    if not rows or rows[0].get('status') != 'armed' or aware(rows[0]['deadline']) != hard:
        raise ValueError('original-deadline setup guard required')
    if (args.output_dir.exists() or args.output_dir.resolve().parent != Path('/root/autodl-tmp/liftcut/runs')
            or not args.output_dir.name.startswith('g3-run-') or command(['git', 'status', '--porcelain'], ROOT)
            or command(['git', 'rev-parse', 'HEAD'], ROOT) != args.expected_code_commit):
        raise ValueError('fresh persistent run and exact clean committed checkout required')
    args.output_dir.mkdir(parents=True, exist_ok=False)
    output, clock, status, failures = args.output_dir, Clock(), 'partial', []
    bind = binding(plan, args.expected_code_commit, args.booted_at)
    dump_new(output / 'opening.json', {'binding': bind, 'booted_at_proxy': args.booted_at, 'budget': BUDGET,
                                      'evidence_kind': 'model', 'started_at_utc': utcnow().isoformat()})
    try:
        with (output / 'deadline-guard.log').open('x') as stream:
            guard = subprocess.Popen([sys.executable, str(ROOT / 'shutdown_guard.py'), '--arm',
                '--deadline', hard.isoformat(), '--receipt', str(output / 'deadline-guard.jsonl')],
                stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        wait_guard_armed(guard, output / 'deadline-guard.jsonl')
        if shutil.disk_usage(output).free < 3_000_000_000:
            raise ValueError('at least 3GB disk required; do not expand storage')
        verify_model(args.model_dir, args.model_manifest)
        execute_phases(commands, output, bind, work, clock)
        status = 'complete'
    except Exception as error:
        failures.append({'type': type(error).__name__, 'message': str(error)})
    finally:
        finalize(output, status, failures, bind, hard, clock)
    return 0 if status == 'complete' else 2


if __name__ == '__main__':
    raise SystemExit(main())
