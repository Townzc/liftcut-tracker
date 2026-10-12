"""Audit actual fixed weights, four fresh arms, original traces and projected tokens."""
import argparse
from pathlib import Path

from audit_g2 import baseline
from d2_execution import aware, expected_runtime, read
from i2_gates import ARMS, evaluate
from i2_protocol import manifest_for, validate_opening, verify_adapter, verify_plan
from i2_rollout import audit_projected_panels
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
        raise ValueError('real I2 audit must load its immutable execution plan')
    bind = validate_opening(read(run / 'opening.json'), plan, scripted=scripted)
    verify_diagnostic(diagnostic)
    verify_d2(d2)
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    reference = plan['reference']
    checkpoint = reference['checkpoint']
    if read(run / 'reference/manifest.json') != reference:
        raise ValueError('I2 source adapter/reference differs from frozen selection')
    weights = verify_adapter(run / 'reference/final', checkpoint) if verify_weights else None
    if not verify_weights and not scripted:
        raise ValueError('real I2 requires the actual unchanged checkpoint bytes')
    for name, expected in reference['i1_view_sha256'].items():
        if sha256(run / 'reference/i1-view' / name) != expected:
            raise ValueError('historical I1 view reference trace was changed')
    reports = {}
    for arm in ARMS:
        path = run / 'evaluation' / arm
        if read(path / 'manifest.json') != manifest_for(bind, plan, arm, scripted=scripted):
            raise ValueError('unmatched I2 weights or evaluation configuration')
        load, finish = read(path / 'load.json'), read(path / 'finished.json')
        if (load['binding'] != bind or finish['binding'] != bind or load['arm'] != arm
                or finish['arm'] != arm or finish['new_training'] is not False
                or load['runtime'] != ({'scripted_contract': True} if scripted else expected_runtime())
                or not aware(bind['trial_started_at_utc']) <= aware(load['at_utc'])
                       <= aware(finish['finished_at_utc']) <= aware(bind['work_cutoff'])
                or not 0 <= finish['inference_wall_seconds'] <= finish['total_wall_seconds_including_load']):
            raise ValueError('I2 runtime, timing or pure-inference contract differs')
        reports[arm] = audit_projected_panels(path, diagnostic, d2, tokenizer, arm)
    old, raw = signatures(run / 'reference/i1-view'), signatures(run / 'evaluation/A')
    changed = [case for case in sorted(set(old) | set(raw)) if old.get(case) != raw.get(case)]
    return {'version': 'i2-audit-v1', 'binding': bind,
            'evidence_kind': 'scripted_contract' if scripted else 'model', 'model_result': not scripted,
            'adapter_files_verified': verify_weights, 'weights': weights, 'new_training': False,
            'episodes_replayed': 444, 'token_ids_verified': True, 'projection_inputs_verified': True, 'inverse_evidence_mapping_verified': True,
            'test_episodes': 0, 'arms': reports,
            'gates': evaluate(reports, baseline(diagnostic, d2), {a: run / 'evaluation' / a for a in ARMS}),
            'historical_I1_view_repeat': {'all_native_requests_and_outputs_match': not changed,
                                     'changed_cases': changed, 'historical_replaces_new_A': False},
            'scope': 'Fixed-weight 2x2 system comparison on repeated development states, no independent generalization'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('run-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir', 'output'):
        p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    result = audit(a.run_dir, a.diagnostic_dir, a.d2_dir, a.tokenizer_dir)
    dump_new(a.output, result)
    print({k: result[k] for k in ('model_result', 'episodes_replayed', 'adapter_files_verified')})
