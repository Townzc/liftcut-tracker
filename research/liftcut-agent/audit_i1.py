"""Audit actual fixed weights, both fresh arms, original traces and projected tokens."""
import argparse
from pathlib import Path

from audit_g2 import baseline
from d2_execution import aware, expected_runtime, read
from i1_gates import ARMS, evaluate
from i1_protocol import manifest_for, validate_opening, verify_adapter, verify_plan
from i1_rollout import audit_projected_panels
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from prepare_counterfactual_diagnostics import load_tokenizer, verify_prepared as verify_d2
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from server_workspace import dump_new, sha256


def signatures(directory):
    result = {}
    for panel in ('normal', 'diagnostic', 'd2'):
        calls = read_jsonl(directory / panel / 'calls.jsonl')
        generations = read_jsonl(directory / panel / 'generations.jsonl')
        if len(calls) != len(generations):
            raise ValueError('repeat comparison requires complete native call alignment')
        for call, generation in zip(calls, generations):
            result.setdefault(panel + '/' + call['case_id'], []).append({
                'request': call['call']['request'],
                'generation': {k: v for k, v in generation.items() if k != 'elapsed_seconds'}})
    return {case: digest(rows) for case, rows in result.items()}


def audit(run, diagnostic, d2, tokenizer_dir, *, plan=None, scripted=False, verify_weights=True):
    if plan is None:
        plan = verify_plan()
    elif not scripted:
        raise ValueError('real I1 audit must load its immutable execution plan')
    bind = validate_opening(read(run / 'opening.json'), plan, scripted=scripted)
    verify_diagnostic(diagnostic)
    verify_d2(d2)
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    reference = plan['reference']
    if read(run / 'reference/manifest.json') != reference:
        raise ValueError('I1 source adapter/reference differs from frozen selection')
    weights = verify_adapter(run / 'reference/final', reference) if verify_weights else None
    if not verify_weights and not scripted:
        raise ValueError('real I1 requires the actual unchanged checkpoint bytes')
    for name, expected in reference['control_evaluation_sha256'].items():
        if sha256(run / 'reference/g4-control' / name) != expected:
            raise ValueError('historical G4 reference trace was changed')
    reports = {}
    for arm in ARMS:
        path = run / 'evaluation' / arm
        if read(path / 'manifest.json') != manifest_for(bind, plan, arm, scripted=scripted):
            raise ValueError('unmatched I1 weights or evaluation configuration')
        load, finish = read(path / 'load.json'), read(path / 'finished.json')
        if (load['binding'] != bind or finish['binding'] != bind or load['arm'] != arm
                or finish['arm'] != arm or finish['new_training'] is not False
                or load['runtime'] != ({'scripted_contract': True} if scripted else expected_runtime())
                or not aware(bind['trial_started_at_utc']) <= aware(load['at_utc'])
                       <= aware(finish['finished_at_utc']) <= aware(bind['work_cutoff'])
                or not 0 <= finish['inference_wall_seconds'] <= finish['total_wall_seconds_including_load']):
            raise ValueError('I1 runtime, timing or pure-inference contract differs')
        reports[arm] = audit_projected_panels(path, diagnostic, d2, tokenizer, arm)
    old, raw = signatures(run / 'reference/g4-control'), signatures(run / 'evaluation/raw')
    changed = [case for case in sorted(set(old) | set(raw)) if old.get(case) != raw.get(case)]
    return {'version': 'i1-audit-v1', 'binding': bind,
            'evidence_kind': 'scripted_contract' if scripted else 'model', 'model_result': not scripted,
            'adapter_files_verified': verify_weights, 'weights': weights, 'new_training': False,
            'episodes_replayed': 222, 'token_ids_verified': True, 'projection_inputs_verified': True,
            'test_episodes': 0, 'arms': reports,
            'gates': evaluate(reports, baseline(diagnostic, d2), {a: run / 'evaluation' / a for a in ARMS}),
            'historical_G4_repeat': {'all_native_requests_and_outputs_match': not changed,
                                     'changed_cases': changed, 'historical_replaces_new_raw': False},
            'scope': 'Fixed-weight raw/view system comparison on repeated development states, no independent generalization'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('run-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir', 'output'):
        p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    result = audit(a.run_dir, a.diagnostic_dir, a.d2_dir, a.tokenizer_dir)
    dump_new(a.output, result)
    print({k: result[k] for k in ('model_result', 'episodes_replayed', 'adapter_files_verified')})
