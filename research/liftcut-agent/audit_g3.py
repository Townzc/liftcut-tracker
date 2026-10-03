"""Audit both G3 stop-context arms: provenance, actual adapters, native/token replay,
the 12-step control reproduction and the pre-registered per-arm gates.

The control is the published G2 coverage_mix evaluation, read from the repository.
"""
import argparse
from pathlib import Path
import re

from audit_g2 import adapter_bytes
from audit_recovery import audit_training_log
from d2_execution import aware, expected_runtime, read
from g2_rollout import audit_panels
from g3_execution import validate_opening, verify_plan
from gpu_g3 import manifest_for
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from prepare_counterfactual_diagnostics import load_tokenizer, verify_prepared as verify_d2
from prepare_g3 import (ARMS, G2_REVIEW, G2_TRAINING, ROOT, arm_binding, carried_forward,
                        control_reproduced, gates, published_maps, schedules)
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from server_workspace import dump_new, sha256

G2_EVALUATION = ROOT / 'reports/g2-seed42-2026-10-03/run/evaluation/coverage_mix'


def control_evidence(plan):
    if (sha256(G2_REVIEW) != plan['control']['g2_review_sha256']
            or sha256(G2_TRAINING / 'training.jsonl') != plan['control']['g2_training_log_sha256']):
        raise ValueError('published G2 control evidence differs from the frozen G3 plan')
    return published_maps(G2_EVALUATION), read_jsonl(G2_TRAINING / 'training.jsonl'), \
        read(G2_TRAINING / 'initialization.json')['initial_adapter_sha256']


def audit(run, prepared, diagnostic_dir, d2_dir, tokenizer_dir, *, verify_weights=True, scripted=False):
    execution = verify_plan(prepared)
    plan = execution['preparation']
    verify_diagnostic(diagnostic_dir)
    verify_d2(d2_dir)
    window = validate_opening(read(run / 'opening.json'), execution, scripted=scripted)
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    schedule, tokens, _ = schedules(prepared)
    (control_maps, control_stops, control_blocked), control_log, control_initial = control_evidence(plan)
    arms, initials, weights, configs, results, reproduction = {}, set(), {}, [], {}, {}
    kind = 'scripted_contract' if scripted else 'model'
    for arm in ARMS:
        training, evaluation = run / 'training' / arm, run / 'evaluation' / arm
        bind = arm_binding(plan, window['code_commit'], arm)
        trained, tm = read(training / 'report.json'), read(training / 'manifest.json')
        if (tm.get('evidence_kind', 'model') != kind or trained.get('evidence_kind', 'model') != kind
                or tm['binding'] != bind or trained['binding'] != bind or tm['plan'] != plan
                or tm['model'] != plan['model'] or tm['code_commit'] != window['code_commit']
                or not trained['reload_close'] or trained['changed_adapter_tensors'] <= 0
                or read(evaluation / 'manifest.json') != manifest_for(bind, trained, kind)):
            raise ValueError('G3 training/evaluation provenance mismatch')
        audit_training_log(training, plan, [tokens[x['variant']][x['index']] for x in schedule[arm]], arm)
        logs = read_jsonl(training / 'training.jsonl')
        if any(log['binding_digest'] != digest(bind) for log in logs):
            raise ValueError('training step bound to another arm')
        initialization, probe = read(training / 'initialization.json'), read(training / 'memory-probe.json')
        fingerprint = initialization['initial_adapter_sha256']
        if (initialization['binding'] != bind or probe['binding'] != bind
                or initialization['initialization_seed'] != 42 or initialization['post_probe_seed'] != 42
                or not re.fullmatch(r'[0-9a-f]{64}', fingerprint) or trained['initial_adapter_sha256'] != fingerprint
                or not probe['initial_parameters_unchanged'] or probe['optimizer_steps'] != 0
                or not probe['forward_backward_passed'] or probe['sequence_tokens'] != plan['arms'][arm]['max_sequence_tokens']):
            raise ValueError('G3 initial parameters/longest-row probe differs')
        initials.add(fingerprint)
        for item in (read(training / 'runtime.json'), read(evaluation / 'load.json')):
            if item['binding'] != bind or item['runtime'] != ({'scripted_contract': True} if scripted else expected_runtime()):
                raise ValueError('G3 runtime differs from original conditions')
        if not scripted and not (aware(window['booted_at_proxy']) <= aware(tm['started_at_utc'])
                <= aware(trained['finished_at_utc']) <= aware(window['work_cutoff'])):
            raise ValueError('training outside original work window')
        if set(trained['adapter_sha256']) != {'adapter_config.json', 'adapter_model.safetensors'}:
            raise ValueError('exact G3 adapter file inventory required')
        for name, value in trained['adapter_sha256'].items():
            if (verify_weights or name != 'adapter_model.safetensors') and sha256(training / 'final' / name) != value:
                raise ValueError('actual adapter bytes differ')
        ac = read(training / 'final/adapter_config.json')
        if any(ac.get(k) != v for k, v in {'r': 16, 'lora_alpha': 32, 'lora_dropout': 0., 'bias': 'none', 'task_type': 'CAUSAL_LM'}.items()):
            raise ValueError('adapter hyperparameters differ')
        configs.append({k: sorted(v) if isinstance(v, list) else v for k, v in ac.items()})
        weights[arm] = adapter_bytes(training / 'final/adapter_model.safetensors') if verify_weights else None
        arms[arm] = audit_panels(evaluation, diagnostic_dir, d2_dir, tokenizer)
        first = plan['divergence'][arm]['first_changed_optimizer_step']
        recorded = read(training / 'control-reproduction.json') if (training / 'control-reproduction.json').exists() else None
        observed = control_reproduced(logs, control_log, first)
        if not scripted and (recorded is None or recorded['binding'] != bind or recorded['reproduced'] != observed
                             or recorded['shared_steps'] != first - 1):
            raise ValueError('training-time control reproduction record differs from the logs')
        reproduction[arm] = {'shared_steps': first - 1, 'reproduced': observed,
                             'initial_adapter_matches_g2': fingerprint == control_initial}
        maps, stops, blocked = published_maps(evaluation)
        results[arm] = gates(maps, control_maps, stops, blocked)
    if len(initials) != 1 or configs[0] != configs[1]:
        raise ValueError('two G3 arms did not begin with matching parameters/configuration')
    paired_claim = all(r['reproduced'] and r['initial_adapter_matches_g2'] for r in reproduction.values())
    return {'version': 'g3-audit-v1', 'binding': window, 'evidence_kind': kind,
            'model_result': not scripted, 'adapter_files_verified': verify_weights, 'weights': weights,
            'episodes_replayed': 222, 'token_ids_verified': True, 'test_episodes': 0, 'arms': arms,
            'control': {'arm': 'g2/coverage_mix', 'false_infeasible_stops': control_stops,
                        'blocked_writes': control_blocked, 'reproduction': reproduction,
                        'paired_claim_allowed': paired_claim},
            'gates': results, 'carried_forward': carried_forward(results),
            'initial_adapter_sha256': next(iter(initials)),
            'scope': 'Seed42 stop-context screen on reused development states; reserved48 unused. '
                     'Without bitwise control reproduction the comparison is historical only.'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('run-dir', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir', 'output'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--metadata-only', action='store_true')
    args = p.parse_args()
    result = audit(args.run_dir, args.prepared_dir, args.diagnostic_dir, args.d2_dir,
                   args.tokenizer_dir, verify_weights=not args.metadata_only)
    dump_new(args.output, result)
    print({k: result[k] for k in ('episodes_replayed', 'adapter_files_verified', 'model_result', 'carried_forward')})
