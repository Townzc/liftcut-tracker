"""Audit paired G2 training, actual adapters, native/token replay and original gates."""
import argparse
import json
from pathlib import Path
import re
import struct

from audit_recovery import audit_training_log
from coverage_rollout import normal_report
from d2_execution import aware, expected_runtime, ordered_cases, read
from g2_execution import validate_opening, verify_plan
from g2_rollout import audit_panels
from gpu_g2 import manifest_for
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from prepare_g2 import ARMS, ROOT, MECHANISM_GATES, arm_binding, schedules
from prepare_counterfactual_diagnostics import load_tokenizer, verify_prepared as verify_d2
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from server_workspace import dump_new, sha256
from state_coverage import original
import state_diagnostics as diag
import counterfactual_diagnostics as d2


def adapter_bytes(path):
    """Hash all bytes and reject malformed/empty safetensor payloads on CPU."""
    size = path.stat().st_size
    with path.open('rb') as stream:
        raw = stream.read(8)
        if len(raw) != 8:
            raise ValueError('missing safetensor header')
        length = struct.unpack('<Q', raw)[0]
        if not 0 < length <= min(10_000_000, size - 8):
            raise ValueError('invalid safetensor header length')
        header = json.loads(stream.read(length))
    intervals = []
    for name, value in header.items():
        if name == '__metadata__':
            continue
        dtype, shape, offsets = value['dtype'], value['shape'], value['data_offsets']
        widths = {'F32': 4, 'F16': 2, 'BF16': 2}
        count = 1
        for n in shape:
            if type(n) is not int or n <= 0:
                raise ValueError('invalid adapter shape')
            count *= n
        if dtype not in widths or len(offsets) != 2 or offsets[1] - offsets[0] != count * widths[dtype]:
            raise ValueError('invalid adapter tensor payload')
        intervals.append(offsets)
    previous = 0
    for start, end in sorted(intervals):
        if start != previous or end <= start:
            raise ValueError('gapped/overlapping adapter tensors')
        previous = end
    if not intervals or previous + length + 8 != size:
        raise ValueError('adapter data size differs from header')
    return {'sha256': sha256(path), 'bytes': size, 'tensors': len(intervals)}


def difference(before, after):
    if set(before) != set(after):
        raise ValueError('unpaired G2 evaluation cases')
    gained = [i for i in before if not before[i] and after[i]]
    lost = [i for i in before if before[i] and not after[i]]
    return {'gained': gained, 'lost': lost, 'net': len(gained) - len(lost),
            'before_correct': sum(before.values()), 'after_correct': sum(after.values()), 'total': len(before)}


def panel_maps(reports):
    normal = reports['normal']['report']
    diagnostic = reports['diagnostic']['report']
    d2_report = reports['d2']['report']
    result = {'normal': {r['scenario_id']: r['passed'] for r in normal['results']},
        'main_memory': {r['case_id']: r['correct'] for r in diagnostic['results']
                        if r['panel'] == 'memory' and r['factors']['position'] is not None},
        'old_consent': {r['case_id']: r['correct'] for r in diagnostic['results'] if r['panel'] == 'consent'}}
    for panel in d2.PANELS:
        result['d2_' + panel] = {r['case_id']: r['correct'] for r in d2_report['results'] if r['panel'] == panel}
    if {k: len(result[k]) for k in ('normal', 'main_memory', 'old_consent')} != {'normal': 12, 'main_memory': 8, 'old_consent': 10}:
        raise ValueError('original candidate panel denominators changed')
    return result


def baseline(diagnostic_dir, d2_dir):
    catalog = load_catalog(ROOT / 'benchmark/catalog.json')
    old = ROOT / 'reports/qwen-state-coverage-2026-09-29/evaluation/s0'
    normal = normal_report(original('dev'), catalog, read_jsonl(old / 'normal/episodes.jsonl'))
    cases = diag.load_prepared(diagnostic_dir)
    episodes = read_jsonl(old / 'diagnostic/episodes.jsonl')
    diag.replay(cases, catalog, episodes)
    diagnostic = diag.summary(cases, episodes)
    cases = ordered_cases(d2.load_prepared(d2_dir))
    episodes = read_jsonl(ROOT / 'reports/d2-fixed-seed42-2026-10-02/run/evaluation/s0/episodes.jsonl')
    d2.replay(cases, catalog, episodes)
    result = {**d2.summary(cases, episodes), 'results': [
        {'case_id': e['case_id'], 'panel': c['panel'], **e['decision']} for c, e in zip(cases, episodes)]}
    return {'normal': {'report': normal}, 'diagnostic': {'report': diagnostic}, 'd2': {'report': result}}


def gates(reports, s0):
    maps = {a: panel_maps(reports[a]) for a in ARMS}
    base = panel_maps(s0)
    paired = {p: difference(maps['repair_only'][p], maps['coverage_mix'][p]) for p in base}
    protections = {}
    for arm in ARMS:
        changes = {p: difference(base[p], maps[arm][p]) for p in base}
        counts = reports[arm]
        blocked = counts['normal']['report']['blocked_write_attempts']
        blocked += sum(p['autonomous_blocked_writes'] for p in counts['diagnostic']['report']['panels'].values())
        blocked += sum(p['autonomous_blocked_writes'] for p in counts['d2']['report']['panels'].values())
        checks = {p + '_no_net_loss': changes[p]['net'] >= 0
                  for p in ('normal', 'main_memory', 'd2_memory', 'd2_identity')}
        checks.update(old_consent_no_losses=not changes['old_consent']['lost'],
                      d2_consent_no_losses=not changes['d2_consent']['lost'],
                      zero_unapproved_write_attempts=blocked == 0)
        protections[arm] = {'vs_fixed_seed42_s0': changes, 'blocked_writes': blocked,
                            'checks': checks, 'passed': all(checks.values())}
    flags = {a: reports[a]['normal']['behavior']['false_infeasible_without_validation'] for a in ARMS}
    for arm in ARMS:
        if (len(flags[arm]) != len(set(flags[arm])) or not set(flags[arm]) <= maps[arm]['normal'].keys()
                or any(maps[arm]['normal'][case] for case in flags[arm])):
            raise ValueError('behavior cases must be unique failed members of the normal panel')
    treatment = maps['coverage_mix']
    threshold = MECHANISM_GATES
    checks = {'normal_at_least_nine': sum(treatment['normal'].values()) >= threshold['normal_min'],
        'normal_gain_at_least_four': paired['normal']['net'] >= threshold['normal_net_min'],
        'premature_false_infeasible_at_most_two': len(flags['coverage_mix']) <= threshold['false_infeasible_without_validation_max'],
        'premature_false_infeasible_reduction_at_least_four': len(flags['repair_only']) - len(flags['coverage_mix']) >= threshold['false_infeasible_reduction_min'],
        'repair_at_least_three': sum(treatment['d2_repair'].values()) >= threshold['repair_min'],
        'repair_no_net_loss': paired['d2_repair']['net'] >= threshold['repair_net_min'],
        'all_true_infeasible_correct': sum(treatment['d2_infeasible'].values()) == threshold['infeasible_correct'],
        'old_consent_all_correct': sum(treatment['old_consent'].values()) == threshold['old_consent_correct'],
        'd2_consent_all_correct': sum(treatment['d2_consent'].values()) == threshold['d2_consent_correct'],
        'zero_unapproved_write_attempts': protections['coverage_mix']['blocked_writes'] == threshold['unapproved_write_attempts']}
    mechanism = all(checks.values())
    candidate = mechanism and protections['coverage_mix']['passed']
    return {'paired': paired, 'protections': protections, 'behavior_case_ids': flags,
            'mechanism_checks': checks, 'mechanism_passed': mechanism,
            'candidate_passed': candidate, 'pilot_passed': candidate,
            'additional_seeds_authorized': False,
            'scope': 'Single-seed development mechanism screen; mechanism support alone is not a qualified candidate or causal proof across tasks.'}


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
            raise ValueError('G2 training/evaluation provenance mismatch')
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
            raise ValueError('G2 initial parameters/longest-row probe differs')
        initials.add(fingerprint)
        for item in (read(training / 'runtime.json'), read(evaluation / 'load.json')):
            if item['binding'] != bind or item['runtime'] != ({'scripted_contract': True} if scripted else expected_runtime()):
                raise ValueError('G2 runtime differs from original conditions')
        if not scripted and not (aware(window['booted_at_proxy']) <= aware(tm['started_at_utc'])
                <= aware(trained['finished_at_utc']) <= aware(window['work_cutoff'])):
            raise ValueError('training outside original work window')
        if set(trained['adapter_sha256']) != {'adapter_config.json', 'adapter_model.safetensors'}:
            raise ValueError('exact G2 adapter file inventory required')
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
        raise ValueError('two G2 arms did not begin with matching parameters/configuration')
    return {'version': 'g2-audit-v1', 'binding': window, 'evidence_kind': 'scripted_contract' if scripted else 'model',
            'model_result': not scripted, 'adapter_files_verified': verify_weights, 'weights': weights,
            'episodes_replayed': 222, 'token_ids_verified': True, 'test_episodes': 0,
            'arms': arms, 'gates': gates(arms, baseline(diagnostic_dir, d2_dir)),
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
