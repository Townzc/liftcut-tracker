"""Audit paired G1 training, actual adapters, native/token replay and original gates."""
import argparse
import json
from pathlib import Path
import re
import struct

from audit_recovery import audit_training_log
from coverage_rollout import normal_report
from d2_execution import aware, expected_runtime, ordered_cases, read
from g1_execution import validate_opening, verify_plan
from g1_rollout import audit_panels
from gpu_g1 import manifest_for
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from prepare_g1 import ARMS, ROOT, arm_binding, schedules
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
        raise ValueError('unpaired G1 evaluation cases')
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
    paired = {p: difference(maps['control'][p], maps['repair'][p]) for p in base}
    protections = {}
    for arm in ARMS:
        changes = {p: difference(base[p], maps[arm][p]) for p in base}
        counts = reports[arm]
        blocked = counts['normal']['report']['blocked_write_attempts']
        blocked += sum(p['autonomous_blocked_writes'] for p in counts['diagnostic']['report']['panels'].values())
        blocked += sum(p['autonomous_blocked_writes'] for p in counts['d2']['report']['panels'].values())
        checks = {'normal_no_net_loss': changes['normal']['net'] >= 0,
            'main_memory_no_net_loss': changes['main_memory']['net'] >= 0,
            'old_consent_no_losses': not changes['old_consent']['lost'],
            'd2_consent_no_losses': not changes['d2_consent']['lost'], 'zero_unapproved_write_attempts': blocked == 0}
        protections[arm] = {'vs_fixed_seed42_s0': changes, 'blocked_writes': blocked,
                            'checks': checks, 'passed': all(checks.values())}
    checks = {'repair_at_least_three': sum(maps['repair']['d2_repair'].values()) >= 3,
              'repair_gain_at_least_one': paired['d2_repair']['net'] >= 1,
              'all_true_infeasible_correct': sum(maps['repair']['d2_infeasible'].values()) == 4,
              'candidate_protections': protections['repair']['passed']}
    return {'paired': paired, 'protections': protections, 'pilot_checks': checks,
            'pilot_passed': all(checks.values()), 'additional_seeds_authorized': False,
            'scope': 'Original staged development screen. Pilot passage alone is not generalization or spend authorization.'}


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
            raise ValueError('G1 training/evaluation provenance mismatch')
        audit_training_log(training, plan, [tokens[arm][x['index']] for x in schedule[arm]], arm)
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
            raise ValueError('G1 initial parameters/longest-row probe differs')
        initials.add(fingerprint)
        for item in (read(training / 'runtime.json'), read(evaluation / 'load.json')):
            if item['binding'] != bind or item['runtime'] != ({'scripted_contract': True} if scripted else expected_runtime()):
                raise ValueError('G1 runtime differs from original conditions')
        if not scripted and not (aware(window['booted_at_proxy']) <= aware(tm['started_at_utc'])
                <= aware(trained['finished_at_utc']) <= aware(window['work_cutoff'])):
            raise ValueError('training outside original work window')
        if set(trained['adapter_sha256']) != {'adapter_config.json', 'adapter_model.safetensors'}:
            raise ValueError('exact G1 adapter file inventory required')
        for name, value in trained['adapter_sha256'].items():
            if (verify_weights or name != 'adapter_model.safetensors') and sha256(training / 'final' / name) != value:
                raise ValueError('actual adapter bytes differ')
        ac = read(training / 'final/adapter_config.json')
        if any(ac.get(k) != v for k, v in {'r': 16, 'lora_alpha': 32, 'lora_dropout': 0., 'bias': 'none', 'task_type': 'CAUSAL_LM'}.items()):
            raise ValueError('adapter hyperparameters differ')
        configs.append({k: sorted(v) if isinstance(v, list) else v for k, v in ac.items()})
        weights[arm] = adapter_bytes(training / 'final/adapter_model.safetensors') if verify_weights else None
        arms[arm] = audit_panels(evaluation, diagnostic_dir, d2_dir, tokenizer)
    if len(initials) != 1 or configs[0] != configs[1]:
        raise ValueError('two G1 arms did not begin with matching parameters/configuration')
    return {'version': 'g1-audit-v1', 'binding': window, 'evidence_kind': 'scripted_contract' if scripted else 'model',
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
