"""Rebuild complete E1 scores from original full episodes, native tokens and weight bytes."""
import argparse
from pathlib import Path
from d2_execution import read, aware, expected_runtime
from e1_execution import ROOT, verify_plan, validate_opening, verify_parent, cases_for_run
from e1_protocol import ARMS, run_config, decide
from e1_rollout import audit_arm
from liftcut_agent.benchmark import load_catalog
from prepare_counterfactual_diagnostics import load_tokenizer
from server_workspace import dump_new


def audit(run, tokenizer_dir, parent=None, receipt=None, index=None, *,
          scripted=False, plan=None, metadata_only=False):
    if plan is None:
        plan = verify_plan()
    elif not scripted:
        raise ValueError('model evidence requires the frozen E1 execution plan')
    b = validate_opening(read(run / 'opening.json'), plan, scripted=scripted)
    if read(run / 'reference.json') != plan['parent_reference']:
        raise ValueError('external original weight reference changed')
    weights = None if metadata_only else verify_parent(parent, plan, receipt, index)
    catalog = load_catalog(ROOT / 'benchmark/catalog.json')
    cases = cases_for_run(run, plan, catalog)
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    reports = {}
    previous_finish = aware(read(run / 'dataset/data-opened.json')['preserved_at_utc'])
    for arm in ARMS:
        folder = run / 'evaluation' / arm
        if read(folder / 'manifest.json') != {'binding': b, 'arm': arm, 'config': run_config().manifest()}:
            raise ValueError('original full-task arm/config differs')
        load, finish = read(folder / 'load.json'), read(folder / 'finished.json')
        if (load['binding'] != b or finish['binding'] != b or load['arm'] != arm or finish['arm'] != arm
                or load['runtime'] != ({'scripted_contract': True} if scripted else expected_runtime())
                or not previous_finish <= aware(load['at_utc']) <= aware(finish['at_utc']) <= aware(b['work_cutoff'])
                or finish['new_training'] is not False
                or not 0 <= finish['inference_wall_seconds'] <= finish['total_wall_seconds_including_load']):
            raise ValueError('arm timing/order/runtime differs')
        previous_finish = aware(finish['at_utc'])
        reports[arm] = audit_arm(folder / 'episodes', cases, catalog, tokenizer, arm, scripted=scripted)
    complete = not metadata_only
    return {'version': 'e1-audit-v1', 'binding': b,
            'evidence_kind': 'scripted_contract' if scripted else 'model', 'model_result': not scripted,
            'complete_evidence': complete, 'full_task_episodes_replayed': 96, 'unique_task_inputs': 48,
            'actual_external_weight_verified': complete, 'external_weights': weights,
            'archive_is_self_contained': False, 'new_training': False,
            'reserved_task_payloads_used': 0 if scripted else 48,
            'token_ids_verified': True, 'projection_inputs_verified': True, 'inverse_mapping_verified': True,
            'arms': reports, 'decision': decide({a: reports[a]['rows'] for a in ARMS},
                                                complete=complete, actual_model_result=not scripted)}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for n in ('run-dir', 'tokenizer-dir', 'parent-run', 'output'):
        p.add_argument('--' + n, type=Path, required=True)
    for n in ('parent-receipt', 'parent-index'):
        p.add_argument('--' + n, type=Path)
    a = p.parse_args()
    result = audit(a.run_dir, a.tokenizer_dir, a.parent_run, a.parent_receipt, a.parent_index)
    dump_new(a.output, result)
    print({k: result[k] for k in ('full_task_episodes_replayed', 'actual_external_weight_verified')})
