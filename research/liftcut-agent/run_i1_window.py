"""One fixed-weight I1 trial within the existing power lease; no training or reboot."""
import argparse
from datetime import timedelta
import json
from pathlib import Path
import platform
import shutil
import sys
import time

from d2_execution import Clock, event_file, read, utcnow
from gpu_counterfactual_diagnostics import verify_model
from i1_protocol import (ARMS, BUDGET, ROOT, aware, binding, deadlines, validate_reference,
                         verify_adapter, verify_live_lease, verify_plan)
from i1_receipt_transfer import validate_receipt
from liftcut_agent.interactive import digest
from prepare_counterfactual_diagnostics import verify_prepared as verify_d2
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from run_controlled_window import evidence_backup
from run_counterfactual_window import run_phase
from server_workspace import command, dump_new, sha256


def copy_reference(g4_run, output, reference):
    validate_reference(reference)
    if (digest(read(g4_run / 'comparison.json')) != reference['g4_comparison_digest']
            or sha256(g4_run / 'off-instance-backup.json') != reference['g4_restore_receipt_sha256']
            or read(g4_run / 'backup-copy-status.json')['off_instance_acknowledged'] is not True
            or read(g4_run / 'opening.json')['binding'] != reference['g4_binding']):
        raise ValueError('actual G4 source restoration/consumption/reference mismatch')
    verify_adapter(g4_run / 'training/control/final', reference)
    for name, expected in reference['control_evaluation_sha256'].items():
        source = g4_run / 'evaluation/control' / name
        if sha256(source) != expected:
            raise ValueError('G4 control history differs from frozen reference')
        target = output / 'reference/g4-control' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    directory = output / 'reference/final'
    directory.mkdir(parents=True, exist_ok=False)
    for name in reference['adapter_sha256']:
        shutil.copyfile(g4_run / 'training/control/final' / name, directory / name)
    verify_adapter(directory, reference)
    dump_new(output / 'reference/manifest.json', reference)


def phases(model, model_manifest, diagnostic, d2, tokenizer, output, commit):
    shared = ['--model-dir', str(model), '--model-manifest', str(model_manifest),
              '--diagnostic-dir', str(diagnostic), '--d2-dir', str(d2),
              '--run-dir', str(output), '--expected-code-commit', commit]
    commands = [('evaluate-' + arm, [sys.executable, str(ROOT / 'gpu_i1.py'), *shared,
                                    '--arm', arm, '--allow-gpu']) for arm in ARMS]
    commands.append(('audit', [sys.executable, str(ROOT / 'audit_i1.py'), '--run-dir', str(output),
                    '--diagnostic-dir', str(diagnostic), '--d2-dir', str(d2),
                    '--tokenizer-dir', str(tokenizer), '--output', str(output / 'comparison.json')]))
    return commands


def execute_phases(commands, output, work, clock, *, phase_runner=run_phase):
    for name, argv in commands:
        phase_runner(name, argv, output, work, clock)


def finalize(output, status, failures, bind, collect, clock, *, kind='model', sleep=time.sleep):
    dump_new(output / 'window-status.json', {'status': status, 'failures': failures, 'binding': bind,
             'finished_work_at_utc': clock.now().isoformat(), 'provider_billing_stopped': False})
    backup = evidence_backup(output)
    index = {'version': 'i1-backup-v1', 'binding': bind, 'evidence_kind': kind, 'status': status,
             'archives': [{'path': backup['archive'], **backup}]}
    dump_new(output / 'backup-index.json', index)
    event_file(output / 'events.jsonl', 'backup_ready', index=index)
    until = min(collect - timedelta(seconds=30), clock.now() + timedelta(minutes=30))
    acknowledged = False
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
        sleep(min(2, max(0, (until-clock.now()).total_seconds())))
    dump_new(output / 'backup-copy-status.json', {'off_instance_acknowledged': acknowledged,
             'power_deadline': BUDGET['power_deadline'], 'provider_billing_stopped': False})
    event_file(output / 'events.jsonl', 'i1_controller_finished', status=status, acknowledged=acknowledged,
               independent_overnight_guard_retained=True, power_deadline=BUDGET['power_deadline'])
    return index


def main():
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('model-dir', 'model-manifest', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir', 'g4-run-dir', 'output-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--expected-code-commit', required=True)
    p.add_argument('--trial-started-at')
    p.add_argument('--execute', action='store_true')
    a = p.parse_args()
    plan = verify_plan()
    verify_diagnostic(a.diagnostic_dir)
    verify_d2(a.d2_dir)
    commands = phases(a.model_dir, a.model_manifest, a.diagnostic_dir, a.d2_dir, a.tokenizer_dir,
                      a.output_dir, a.expected_code_commit)
    if not a.execute:
        print(json.dumps({'dry_run': True, 'gpu_calls': 0, 'budget': BUDGET, 'phases': commands}))
        return 0
    if platform.system() != 'Linux' or not a.trial_started_at:
        raise ValueError('explicit authorized Linux trial required')
    work, collect = deadlines(a.trial_started_at, utcnow())
    verify_live_lease(plan)
    if (a.output_dir.exists() or a.output_dir.resolve().parent != Path('/root/autodl-tmp/liftcut/runs')
            or not a.output_dir.name.startswith('i1-run-') or command(['git', 'status', '--porcelain'], ROOT)
            or command(['git', 'rev-parse', 'HEAD'], ROOT) != a.expected_code_commit):
        raise ValueError('new persistent I1 run and clean exact checkout required')
    a.output_dir.mkdir(parents=True, exist_ok=False)
    output, clock, status, failures = a.output_dir, Clock(), 'partial', []
    bind = binding(plan, a.expected_code_commit, a.trial_started_at)
    dump_new(output / 'opening.json', {'binding': bind, 'booted_at_proxy': BUDGET['instance_boot'],
        'trial_started_at_utc': a.trial_started_at, 'budget': BUDGET, 'evidence_kind': 'model',
        'started_at_utc': utcnow().isoformat(), 'lease_configuration_digest': plan['lease_configuration_digest']})
    try:
        if shutil.disk_usage(output).free < 3_000_000_000:
            raise ValueError('3GB free disk required; no expansion')
        verify_model(a.model_dir, a.model_manifest)
        copy_reference(a.g4_run_dir, output, plan['reference'])
        execute_phases(commands, output, work, clock)
        status = 'complete'
    except Exception as error:
        failures.append({'type': type(error).__name__, 'message': str(error)})
    finally:
        finalize(output, status, failures, bind, collect, clock)
    return 0 if status == 'complete' else 2


if __name__ == '__main__':
    raise SystemExit(main())
