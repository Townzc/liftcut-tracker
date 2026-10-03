"""CPU-only native input-projection drill; scripted actions are not model evidence.

No training, GPU, checkpoint selection, archive receipt or remote launch occurs.
The oracle reads evaluation answers only to test plumbing and is never a model
transport used in an actual I1 experiment.
"""
import argparse
from pathlib import Path

from d2_execution import ordered_cases
from drill_g4 import OracleNative
from i1_rollout import ARMS, audit_projected_panels, run_projected_panels
from prepare_counterfactual_diagnostics import load_tokenizer
from server_workspace import dump_new
import counterfactual_diagnostics as d2
import state_diagnostics as diagnostic


def drill(output, diagnostic_dir, d2_dir, tokenizer_dir):
    if output.exists():
        raise ValueError('fresh output required for scripted projection drill')
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    cases = {'normal': None, 'diagnostic': diagnostic.load_prepared(diagnostic_dir),
             'd2': ordered_cases(d2.load_prepared(d2_dir))}
    reports = {}
    for arm in ARMS:
        path = output / 'SYNTHETIC-PROJECTION-ONLY' / arm
        run_projected_panels(path, diagnostic_dir, d2_dir,
            lambda panel, callback: OracleNative(panel, cases[panel], tokenizer, callback), arm)
        reports[arm] = audit_projected_panels(path, diagnostic_dir, d2_dir, tokenizer, arm)
        for panel, expected in [('normal', 12), ('diagnostic', 19), ('d2', 80)]:
            report = reports[arm][panel]['report']
            if len(report['results']) != expected:
                raise ValueError('scripted drill must replay the full registered panel')
            if panel == 'normal':
                passed = report['passed'] == expected
            else:
                passed = all(row['correct'] == row['total'] for row in report['panels'].values())
            if not passed:
                raise ValueError('scripted reference failed; not a model outcome')
    result = {'version': 'i1-projection-drill-v1', 'evidence_kind': 'scripted_contract',
              'new_model_calls': 0, 'gpu_calls': 0, 'test_episodes': 0, 'episodes_replayed': 222,
              'scope': '222 scripted native/environment episodes; real pinned tokenizer, no model benefit claim',
              'arms': reports}
    dump_new(output / 'report.json', result)
    return {arm: {panel: {'input_records': row['input_records'], 'changed_requests': row['changed_requests'],
                         'prompt_tokens': row['tokens']['generated_prompt_tokens']}
                 for panel, row in data.items()} for arm, data in reports.items()}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('output-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    args = p.parse_args()
    print(drill(args.output_dir, args.diagnostic_dir, args.d2_dir, args.tokenizer_dir))
