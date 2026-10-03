"""Scripted I1 production-path drill; optional unchanged historical T weight container.

No GPU, training, real G4 trigger or new model result. A metadata-only CI run cannot
create a complete receipt. A complete CPU receipt is explicitly scripted_contract.
"""
import argparse
from datetime import timedelta
from pathlib import Path
import shutil

from audit_g2 import adapter_bytes
from audit_i1 import audit
from d2_execution import ordered_cases, read
from drill_d2_execution import ScriptClock
from drill_g4 import OracleNative
from g2_rollout import run_panels
from i1_protocol import (ARMS, BUDGET, G4_COMMIT, G4_EXECUTION, ROOT, aware, binding,
                         execution_plan, manifest_for)
from i1_receipt_transfer import validate_receipt
from i1_rollout import run_projected_panels
from prepare_counterfactual_diagnostics import load_tokenizer
from restore_i1 import assemble
from run_i1_window import execute_phases, finalize, phases
from server_workspace import dump_new, sha256
import counterfactual_diagnostics as d2
import state_diagnostics as diagnostic


def drill(output, diagnostic_dir, d2_dir, tokenizer_dir, historical_adapter=None):
    if output.exists():
        raise ValueError('fresh scripted I1 output required')
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    cases = {'normal': None, 'diagnostic': diagnostic.load_prepared(diagnostic_dir),
             'd2': ordered_cases(d2.load_prepared(d2_dir))}
    factory = lambda panel, record: OracleNative(panel, cases[panel], tokenizer, record)
    history = output / 'SCRIPTED-REFERENCE-NOT-G4-MODEL'
    run_panels(history, diagnostic_dir, d2_dir, factory)
    old = ROOT / 'reports/qwen-state-coverage-2026-09-29/training/t'
    hashes = read(old / 'report.json')['adapter_sha256']
    measured = {'sha256': hashes['adapter_model.safetensors'], 'bytes': None, 'tensors': None}
    if historical_adapter:
        measured = adapter_bytes(historical_adapter / 'adapter_model.safetensors')
        if measured['sha256'] != hashes['adapter_model.safetensors']:
            raise ValueError('only unchanged historical T is a CPU drill container')
    reference = {'version': 'i1-fixed-reference-v1', 'model_result': False,
        'g4_code_commit': G4_COMMIT, 'g4_candidate_passed': False,
        'g4_binding': {'code_commit': G4_COMMIT, 'seed': 42, 'test_episodes': 0},
        'selection': 'preselected_G4_new_control', 'g4_episodes_replayed': 222, 'test_episodes': 0,
        'model': G4_EXECUTION['preparation']['model'], 'adapter_sha256': hashes, 'adapter_bytes': measured,
        'control_evaluation_sha256': {f'{p}/{n}.jsonl': sha256(history / p / f'{n}.jsonl')
            for p in ('normal', 'diagnostic', 'd2') for n in ('episodes', 'calls', 'generations')},
        **{key: '0' * 64 for key in ('g4_index_digest', 'g4_restore_receipt_sha256', 'g4_comparison_digest')},
        'scope': 'SCRIPTED prerequisite stub and unchanged historical T container, not actual G4 evidence'}
    plan = execution_plan(reference, scripted=True)
    start, clock = '2026-10-03T10:00:00+00:00', ScriptClock()
    clock.value = aware(start)
    bind = binding(plan, '0' * 40, start)
    run = output / 'SYNTHETIC-I1-CONTRACT-ONLY'
    dump_new(run / 'opening.json', {'binding': bind, 'booted_at_proxy': BUDGET['instance_boot'],
        'trial_started_at_utc': start, 'budget': BUDGET, 'evidence_kind': 'scripted_contract',
        'started_at_utc': start, 'lease_configuration_digest': plan['lease_configuration_digest']})
    dump_new(run / 'reference/manifest.json', reference)
    final = run / 'reference/final'
    final.mkdir(parents=True)
    shutil.copyfile(old / 'final/adapter_config.json', final / 'adapter_config.json')
    if historical_adapter:
        shutil.copyfile(historical_adapter / 'adapter_model.safetensors', final / 'adapter_model.safetensors')
    for name in reference['control_evaluation_sha256']:
        target = run / 'reference/g4-control' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(history / name, target)
    result = None
    def scripted_phase(name, argv, _out, _work, _clock):
        nonlocal result
        if name == 'audit':
            result = audit(run, diagnostic_dir, d2_dir, tokenizer_dir, plan=plan,
                           scripted=True, verify_weights=historical_adapter is not None)
            dump_new(run / 'comparison.json', result)
            return
        arm = name.removeprefix('evaluate-')
        path = run / 'evaluation' / arm
        dump_new(path / 'manifest.json', manifest_for(bind, plan, arm, scripted=True))
        dump_new(path / 'load.json', {'binding': bind, 'arm': arm, 'runtime': {'scripted_contract': True},
                                     'seconds': 0, 'at_utc': clock.now().isoformat()})
        run_projected_panels(path, diagnostic_dir, d2_dir, factory, arm)
        clock.value += timedelta(seconds=5)
        dump_new(path / 'finished.json', {'binding': bind, 'arm': arm, 'new_training': False,
            'finished_at_utc': clock.now().isoformat(), 'inference_wall_seconds': 5,
            'total_wall_seconds_including_load': 5})
    commands = phases(Path('unused-model'), Path('unused-manifest'), diagnostic_dir, d2_dir,
                      tokenizer_dir, run, '0' * 40)
    execute_phases(commands, run, aware(bind['work_cutoff']), clock, phase_runner=scripted_phase)
    for arm in ARMS:
        for panel, size in [('normal', 12), ('diagnostic', 19), ('d2', 80)]:
            report = result['arms'][arm][panel]['report']
            if len(report['results']) != size:
                raise ValueError('scripted I1 panel incomplete')
            passed = report['passed'] == size if panel == 'normal' else all(
                row['correct'] == row['total'] for row in report['panels'].values())
            if not passed:
                raise ValueError('scripted reference failed; this is not model behavior')
    receipt = None
    def recover(seconds):
        nonlocal receipt
        if receipt is not None:
            raise ValueError('unexpected repeated CPU restore')
        receipt = assemble(run, output / 'restored', diagnostic_dir, d2_dir, tokenizer_dir,
                           allow_partial=True, scripted=True, plan=plan)
        # Copy only the restorer-created scripted receipt; no handwritten ACK.
        shutil.copyfile(output / 'restored/off-instance-backup.json', run / 'off-instance-backup.json')
        clock.value += timedelta(seconds=seconds)
    status = 'complete' if historical_adapter else 'partial'
    index = finalize(run, status, [] if historical_adapter else [{'type': 'CPUWeightsUnavailable'}],
                     bind, aware(bind['collection_cutoff']), clock, kind='scripted_contract', sleep=recover)
    validate_receipt((run / 'off-instance-backup.json').read_bytes(), index, bind, kind='scripted_contract')
    summary = {'version': 'i1-cpu-readiness-v1', 'evidence_kind': 'scripted_contract', 'model_result': False,
        'gpu_calls': 0, 'new_training': False, 'test_episodes': 0, 'episodes_replayed': 222,
        'scripted_reference_episodes': 111,
        'scripted_generation_records': sum(v['tokens']['requests'] for a in result['arms'].values() for v in a.values()),
        'view_changed_requests': sum(v['changed_requests'] for v in result['arms']['view'].values()),
        'actual_historical_T_container_verified': historical_adapter is not None,
        'complete_scripted_restore': receipt['complete_study_replayed'],
        'archive_status': status, 'server_consumer_simulated_with_local_files': True,
        'scope': 'Scripted protocol plus optional actual historical weight bytes; no I1 model outcome'}
    dump_new(output / 'drill-report.json', summary)
    return summary


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('output-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--historical-adapter-dir', type=Path)
    a = p.parse_args()
    print(drill(a.output_dir, a.diagnostic_dir, a.d2_dir, a.tokenizer_dir, a.historical_adapter_dir))
