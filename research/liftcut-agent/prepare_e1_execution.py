"""Offline E1 runtime drill: four copies of DEVELOPMENT tasks, never the reserved payload."""
import argparse
from copy import deepcopy
from pathlib import Path
from datetime import timedelta
import shutil
import sys
from audit_e1 import audit
from d2_execution import aware
from e1_data_use import reserve, open_once
from e1_execution import ROOT, EXECUTION, execution_plan, verify_plan, binding
from e1_protocol import ARMS, run_config
from e1_rollout import evaluate
from i2_oracle import ScriptedNative
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.interactive import digest
from prepare_counterfactual_diagnostics import load_tokenizer
from prepare_e1 import forbid_reserved_payload
from recovery_dataset import write_rows
from restore_e1 import assemble
from run_controlled_window import evidence_backup
from server_workspace import dump_new, sha256
from state_coverage import original


def development_fixture():
    # Public dev payload only. Four copies exercise the 48-row transport shape;
    # they supply zero new model accuracy or held-out generalization evidence.
    dev = original('dev'); result = []
    for bundle in range(4):
        for case in dev:
            row = deepcopy(case)
            row['id'] = f'scripted-e1-dev-copy-{bundle}-' + case['id']
            row['family_id'] = f'scripted-development-copy-{bundle}'
            row['split'] = 'test'  # exercise loader schema, not a genuine test task
            row['max_steps'] = 24
            result.append(row)
    return result


def scripted_authorization():
    # Synthetic future clock only; never sent to a server or treated as consent.
    return {'experiment': 'E1', 'source': 'explicit_human_new_server_window',
            'booted_at_proxy': '2026-10-14T00:00:00+00:00', 'maximum_minutes': 120,
            'reserve_cny': 5, 'hourly_cny': 2.18,
            'heldout_scope': 'one_48_task_batch_with_fresh_A_and_D', 'automatic_shutdown': True}


def scripted_day_authorization():
    """Synthetic fixture, never a real opening or a file ready for launch."""
    auth = scripted_authorization()
    auth['source'] = 'explicit_human_new_server_day'
    auth['power_lease'] = {'version': 'liftcut-research-day-v1',
        'authorization': 'explicit_human_20261013_one_day_after_ready',
        'booted_at_proxy': auth['booted_at_proxy'],
        'shutdown_at_utc': (aware(auth['booted_at_proxy']) + timedelta(hours=24)).isoformat(),
        'hourly_cny': 2.18, 'reserve_cny': 55, 'automatic_shutdown': True, 'automatic_reboot': False,
        'paid_api_calls': 0, 'disk_expansion': False,
        'heldout_scope': 'E1_one_48_task_batch_with_fresh_A_and_D',
        'maximum_followup_gpu_trials': 2, 'final_collection_buffer_minutes': 45}
    return auth


def drill(output, tokenizer_dir, parent=None, receipt=None, index=None, *, day=False):
    if output.exists():
        raise ValueError('fresh offline rehearsal output required')
    plan = deepcopy(verify_plan()); cases = development_fixture()
    output.mkdir(parents=True)
    payload = output / 'fixture-development-copies.jsonl'; write_rows(payload, cases)
    plan['protocol']['dataset']['test_file_sha256_from_existing_manifest'] = sha256(payload)
    plan['scripted_development_fixture_only'] = True
    start = '2026-10-14T00:01:00+00:00'; clock = lambda: aware(start)
    authorization = scripted_day_authorization() if day else scripted_authorization()
    b = binding(plan, '0' * 40, authorization, '20261014-000100', start)
    run = output / 'SCRIPTED-E1-DEVELOPMENT-ONLY'; run.mkdir()
    dump_new(run / 'opening.json', {'binding': b, 'at_utc': start, 'evidence_kind': 'scripted_contract'})
    dump_new(run / 'reference.json', plan['parent_reference'])
    catalog = load_catalog(ROOT / 'benchmark/catalog.json')
    ledger = reserve(output / 'SCRIPTED-LEDGER-ONLY', plan['protocol'], b, side='server', now=clock)
    open_once(payload, ledger, run / 'dataset', plan['protocol'], b, catalog, now=clock)
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    for arm in ARMS:
        folder = run / 'evaluation' / arm
        dump_new(folder / 'manifest.json', {'binding': b, 'arm': arm, 'config': run_config().manifest()})
        dump_new(folder / 'load.json', {'binding': b, 'arm': arm, 'runtime': {'scripted_contract': True}, 'at_utc': start, 'seconds': 0})
        evaluate(folder / 'episodes', cases, catalog,
                 lambda callback: ScriptedNative('normal', cases, tokenizer, callback, arm), arm)
        dump_new(folder / 'finished.json', {'binding': b, 'arm': arm, 'at_utc': start,
                 'inference_wall_seconds': 0, 'total_wall_seconds_including_load': 0, 'new_training': False})
    result = audit(run, tokenizer_dir, parent, receipt, index,
                   scripted=True, plan=plan, metadata_only=parent is None)
    dump_new(run / 'comparison.json', result); complete = parent is not None
    status = 'complete' if complete else 'partial'
    dump_new(run / 'window-status.json', {'binding': b, 'status': status, 'failures': [], 'archive_is_self_contained': False})
    item = evidence_backup(run)
    backup = {'version': 'e1-delta-index-v1', 'binding': b, 'status': status,
              'evidence_kind': 'scripted_contract', 'archive_is_self_contained': False,
              'archives': [{'path': item['archive'], **item}]}
    downloads = output / 'downloads'; downloads.mkdir()
    shutil.copyfile(run / item['archive'], downloads / item['archive']); dump_new(downloads / 'backup-index.json', backup)
    restored = assemble(downloads, output / 'restored', tokenizer_dir, parent, receipt, index,
                        allow_partial=True, scripted=True, plan=plan)
    if restored['model_result'] or restored['complete_study_replayed'] != complete:
        raise ValueError('scripted/partial evidence was promoted to an actual complete result')
    report = {'version': 'e1-execution-offline-readiness-v1', 'evidence_kind': 'scripted_development_contract',
              'model_result': False, 'new_model_calls': 0, 'reserved_task_payloads_read': 0,
              'development_original_tasks': 12, 'development_copies': 48, 'full_scripted_episodes': 96,
              'source_sha256': plan['source_sha256'], 'frozen_execution_digest': digest(verify_plan()),
              'scripted_fixture_plan_digest': digest(plan), 'actual_parent_weight_verified': complete,
              'complete_scripted_delta_restore': complete, 'archive_is_self_contained': False,
              'archive_bytes': item['bytes'], 'archive_sha256': item['sha256'],
              'arms': {a: {k: result['arms'][a][k] for k in
                   ('requests', 'actual_model_calls', 'serialized_generations', 'recorded_prompt_tokens',
                    'recorded_completion_tokens', 'recorded_usage_is_model_usage')} for a in ARMS},
              'scripted_decision': result['decision'], 'future_window_authorized': False,
              'scripted_receipt_sha256': sha256(output / 'restored/off-instance-backup.json')}
    report['power_mode'] = 'synthetic_day_lease' if day else 'synthetic_standalone'
    dump_new(output / 'scripted-plan.json', plan); dump_new(output / 'readiness.json', report)
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--freeze', action='store_true'); mode.add_argument('--drill', action='store_true')
    for n in ('output-dir', 'tokenizer-dir', 'parent-run', 'parent-receipt', 'parent-index'):
        p.add_argument('--' + n, type=Path)
    p.add_argument('--day', action='store_true')
    a = p.parse_args(); sys.addaudithook(forbid_reserved_payload)
    if a.freeze:
        plan = execution_plan(); dump_new(EXECUTION, plan)
        print({'frozen_sources': len(plan['source_sha256']), 'new_model_calls': 0, 'heldout_tasks_read': 0})
    else:
        value = drill(a.output_dir, a.tokenizer_dir, a.parent_run, a.parent_receipt, a.parent_index, day=a.day)
        print({k: v for k, v in value.items() if k not in ('source_sha256', 'scripted_decision')})
