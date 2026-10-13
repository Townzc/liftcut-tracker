"""Exactly one future E1 A/D batch; original work/collection/power cutoffs never reset."""
import argparse
from datetime import timedelta
from pathlib import Path
import sys
import time
from d2_execution import Clock, read, aware, event_file
from e1_execution import ROOT, verify_plan, validate_opening
from e1_data_use import open_once
from e1_power import PERSIST, verify_guard, shutdown
from e1_protocol import ARMS
from e1_receipt import validate_receipt
from liftcut_agent.benchmark import load_catalog
from run_counterfactual_window import run_phase
from run_controlled_window import evidence_backup
from server_workspace import command, dump_new, sha256


def finalise(run, ops, status, failures, b, clock, *, scripted=False,
             sleep=time.sleep, archive=evidence_backup, power=shutdown):
    index, acknowledged = None, False
    try:
        dump_new(run / 'window-status.json', {'status': status, 'failures': failures, 'binding': b,
                 'finished_work_at_utc': clock.now().isoformat(), 'archive_is_self_contained': False})
        if any(run.rglob('*.safetensors')):
            raise ValueError('E1 delta must not repeat private parent weights')
        item = archive(run)
        index = {'version': 'e1-delta-index-v1', 'binding': b, 'status': status,
                 'evidence_kind': 'scripted_contract' if scripted else 'model',
                 'archive_is_self_contained': False, 'archives': [{'path': item['archive'], **item}]}
        dump_new(run / 'backup-index.json', index)
        event_file(run / 'events.jsonl', 'backup_ready', index=index)
        until = aware(b['collection_cutoff']) - timedelta(seconds=10)
        while clock.now() < until:
            receipt = run / 'off-instance-backup.json'
            if receipt.exists():
                try:
                    validate_receipt(receipt.read_bytes(), index, b, scripted=scripted)
                    acknowledged = True
                    event_file(run / 'events.jsonl', 'server_receipt_consumed', receipt_sha256=sha256(receipt), status=status)
                    break
                except (ValueError, KeyError, TypeError, OSError):
                    pass
            sleep(min(2, max(0, (until - clock.now()).total_seconds())))
        dump_new(run / 'backup-copy-status.json', {'off_instance_acknowledged': acknowledged,
                 'original_collection_cutoff': b['collection_cutoff'], 'provider_billing_stopped': 'unknown'})
    finally:
        # Archive/ACK/log failures cannot bypass the already authorized shutdown.
        if 'power_lease' in b:
            verify_guard(ops, b)
            dump_new(run / 'window-close.json', {'at_utc': clock.now().isoformat(), 'binding': b,
                'experiment_status': status, 'off_instance_acknowledged': acknowledged,
                'power_action': 'retained_under_original_day_lease',
                'shutdown_at_utc': b['power_shutdown_at_utc'], 'provider_billing_stopped': 'unknown'})
            event_file(run / 'events.jsonl', 'trial_closed_power_retained', backup_acknowledged=acknowledged,
                       original_shutdown_at_utc=b['power_shutdown_at_utc'])
        else:
            close_standalone(run, ops, status, acknowledged, b, clock, sleep, power)
    return index


def close_standalone(run, ops, status, acknowledged, b, clock, sleep, power):
    """Preserve the separately authorized original two-hour standalone mode."""
    try:
        dump_new(run / 'window-close.json', {'at_utc': clock.now().isoformat(),
            'experiment_status': status, 'off_instance_acknowledged': acknowledged,
            'power_action': 'shutdown_after_backup_or_original_cutoff', 'provider_billing_stopped': 'unknown'})
        event_file(run / 'events.jsonl', 'shutdown_about_to_be_requested', backup_acknowledged=acknowledged)
        sleep(min(2, max(0, (aware(b['hard_cutoff']) - clock.now()).total_seconds())))
    finally:
        power(ops, 'E1_complete_or_failed_original_window')


def phases(a, b):
    shared = ['--model-dir', str(a.model_dir), '--model-manifest', str(a.model_manifest),
              '--run-dir', str(a.run), '--parent-run', str(a.parent_run),
              '--expected-code-commit', b['code_commit'], '--allow-gpu']
    result = [('evaluate-' + arm, [sys.executable, str(ROOT / 'gpu_e1.py'), *shared, '--arm', arm]) for arm in ARMS]
    result.append(('audit', [sys.executable, str(ROOT / 'audit_e1.py'), '--run-dir', str(a.run),
        '--tokenizer-dir', str(a.tokenizer_dir), '--parent-run', str(a.parent_run),
        '--output', str(a.run / 'comparison.json')]))
    return result


def execute(a):
    plan = verify_plan(); opening = read(a.ops / 'opening.json'); b = validate_opening(opening, plan)
    verify_guard(a.ops, b)
    if (command(['git', 'rev-parse', 'HEAD'], ROOT) != b['code_commit']
            or command(['git', 'status', '--porcelain'], ROOT)
            or a.run != PERSIST / 'runs' / ('e1-run-' + b['run_id']) or a.run.resolve() != a.run
            or a.run.exists() or a.data_ledger != PERSIST / 'ops/e1-data-use' /
                ('reserved-' + plan['protocol']['dataset']['test_file_sha256_from_existing_manifest'] + '.json')):
        raise ValueError('unique canonical E1 run and original data reservation required')
    a.run.mkdir(exist_ok=False)
    dump_new(a.run / 'opening.json', opening); dump_new(a.run / 'reference.json', plan['parent_reference'])
    status, failures, clock = 'partial', [], Clock()
    try:
        catalog = load_catalog(ROOT / 'benchmark/catalog.json')
        open_once(ROOT / 'benchmark/recovery-v2/test.jsonl', a.data_ledger,
                  a.run / 'dataset', plan['protocol'], b, catalog, now=clock.now)
        event_file(a.run / 'events.jsonl', 'reserved_dataset_opened_once', planned_tasks=48, planned_episodes=96)
        for name, argv in phases(a, b):
            run_phase(name, argv, a.run, aware(b['work_cutoff']), clock)
        status = 'complete'
    except Exception as error:
        failures.append({'type': type(error).__name__, 'message': str(error)})
    finally:
        finalise(a.run, a.ops, status, failures, b, clock)
    return 0 if status == 'complete' else 2


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--execute', action='store_true', required=True)
    for n in ('ops', 'run', 'parent-run', 'model-dir', 'model-manifest', 'tokenizer-dir', 'data-ledger'):
        p.add_argument('--' + n, type=Path, required=True)
    raise SystemExit(execute(p.parse_args()))
