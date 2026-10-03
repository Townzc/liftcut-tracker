"""Audit G4 fresh paired weights, all222 native/token replays and frozen gates."""
import argparse
from pathlib import Path
import re
from audit_g2 import adapter_bytes, baseline
from audit_recovery import audit_training_log
from d2_execution import aware, expected_runtime, read
from g4_execution import validate_opening, verify_plan
from g2_rollout import audit_panels
from gpu_g4 import manifest_for
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from prepare_g4 import ARMS, ROOT, G3, arm_binding, schedules
from prepare_counterfactual_diagnostics import load_tokenizer, verify_prepared as verify_d2
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from server_workspace import dump_new, sha256
from g4_gates import evaluate


def historical_repeat(run):
    old=G3/'run/training/stop_half';new=run/'training/control'
    a=read_jsonl(old/'training.jsonl');b=read_jsonl(new/'training.jsonl')
    keys=('step','loss','gradient_norm_before_clip','input_tokens','supervised_tokens','decisions')
    return {'logged_steps':len(b),'all126_steps_match':len(a)==len(b)==126 and
            all({k:x[k] for k in keys}=={k:y[k] for k in keys} for x,y in zip(a,b)),
            'initialization_match':read(old/'initialization.json')['initial_adapter_sha256']==read(new/'initialization.json')['initial_adapter_sha256'],
            'final_adapter_sha256_match':read(old/'report.json')['adapter_sha256']['adapter_model.safetensors']==read(new/'report.json')['adapter_sha256']['adapter_model.safetensors'],
            'primary_comparison_uses_this_new_control':True}


def audit(run, prepared, diagnostic_dir, d2_dir, tokenizer_dir, *, verify_weights=True, scripted=False):
    execution = verify_plan(prepared)
    plan = execution['preparation']
    verify_diagnostic(diagnostic_dir)
    verify_d2(d2_dir)
    window = validate_opening(read(run / 'opening.json'), execution, scripted=scripted)
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    schedule, tokens, _ = schedules(prepared)
    arms, initials, weights, configs = {}, set(), {}, []
    for arm in ARMS:
        training, evaluation = run / 'training' / arm, run / 'evaluation' / arm
        bind = arm_binding(plan, window['code_commit'], arm)
        trained, tm = read(training / 'report.json'), read(training / 'manifest.json')
        kind = 'scripted_contract' if scripted else 'model'
        if (tm.get('evidence_kind', 'model') != kind or trained.get('evidence_kind', 'model') != kind
                or tm['binding'] != bind or trained['binding'] != bind or tm['plan'] != plan
                or tm['model'] != plan['model'] or tm['code_commit'] != window['code_commit']
                or not trained['reload_close'] or trained['changed_adapter_tensors'] <= 0
                or read(evaluation / 'manifest.json') != manifest_for(bind, trained, kind)):
            raise ValueError('G4 training/evaluation provenance mismatch')
        audit_training_log(training, plan, [tokens[x['variant']][x['index']] for x in schedule[arm]], arm)
        for log in read_jsonl(training / 'training.jsonl'):
            if log['binding_digest'] != digest(bind):
                raise ValueError('training step bound to another arm')
        initialization, probe = read(training / 'initialization.json'), read(training / 'memory-probe.json')
        fingerprint = initialization['initial_adapter_sha256']
        if (initialization['binding'] != bind or probe['binding'] != bind
                or initialization['initialization_seed'] != 42 or initialization['post_probe_seed'] != 42
                or not re.fullmatch(r'[0-9a-f]{64}', fingerprint) or trained['initial_adapter_sha256'] != fingerprint
                or not probe['initial_parameters_unchanged'] or probe['optimizer_steps'] != 0
                or not probe['forward_backward_passed'] or probe['sequence_tokens'] != plan['arms'][arm]['max_sequence_tokens']):
            raise ValueError('G4 initial parameters/longest-row probe differs')
        initials.add(fingerprint)
        for item in (read(training / 'runtime.json'), read(evaluation / 'load.json')):
            if item['binding'] != bind or item['runtime'] != ({'scripted_contract': True} if scripted else expected_runtime()):
                raise ValueError('G4 runtime differs from original conditions')
        if not scripted and not (aware(window['trial_started_at_utc']) <= aware(tm['started_at_utc'])
                <= aware(trained['finished_at_utc']) <= aware(window['work_cutoff'])):
            raise ValueError('training outside original work window')
        if set(trained['adapter_sha256']) != {'adapter_config.json', 'adapter_model.safetensors'}:
            raise ValueError('exact G4 adapter file inventory required')
        for name, value in trained['adapter_sha256'].items():
            if (verify_weights or name != 'adapter_model.safetensors') and sha256(training / 'final' / name) != value:
                raise ValueError('actual adapter bytes differ')
        ac = read(training / 'final/adapter_config.json')
        if any(ac.get(k) != v for k, v in {'r': 16, 'lora_alpha': 32, 'lora_dropout': 0., 'bias': 'none', 'task_type': 'CAUSAL_LM'}.items()):
            raise ValueError('adapter hyperparameters differ')
        configs.append({k: sorted(v) if isinstance(v, list) else v for k, v in ac.items()})
        weights[arm] = adapter_bytes(training / 'final/adapter_model.safetensors') if verify_weights else None
        arms[arm] = audit_panels(evaluation, diagnostic_dir, d2_dir, tokenizer)
        from analyze_g1_contexts import episode_chain
        chains = [episode_chain(e) for e in read_jsonl(evaluation / 'normal/episodes.jsonl')]
        arms[arm]['normal']['behavior'] = {'false_infeasible_without_validation': [
            e['scenario_id'] for e in chains if e['false_infeasible'] and e['infeasible_without_validation']]}
    if len(initials) != 1 or configs[0] != configs[1]:
        raise ValueError('two G4 arms did not begin with matching parameters/configuration')
    return {'version': 'g4-audit-v1', 'binding': window, 'evidence_kind': 'scripted_contract' if scripted else 'model',
            'model_result': not scripted, 'adapter_files_verified': verify_weights, 'weights': weights,
            'episodes_replayed': 222, 'token_ids_verified': True, 'test_episodes': 0,
            'arms': arms, 'gates': evaluate(arms, baseline(diagnostic_dir, d2_dir), {a:run/'evaluation'/a for a in ARMS}),
            'historical_control_repeat': historical_repeat(run),
            'initial_adapter_sha256': next(iter(initials)), 'scope': 'Seed42 pilot on reused development states; reserved48 unused'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('run-dir', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir', 'output'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--metadata-only', action='store_true')
    args = p.parse_args()
    result = audit(args.run_dir, args.prepared_dir, args.diagnostic_dir, args.d2_dir,
                   args.tokenizer_dir, verify_weights=not args.metadata_only)
    dump_new(args.output, result)
    print({k: result[k] for k in ('episodes_replayed', 'adapter_files_verified', 'model_result')})
