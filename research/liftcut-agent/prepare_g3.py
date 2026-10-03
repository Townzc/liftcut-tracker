"""G3: move existing infeasible stop targets behind an executed invalid validation.

CPU preparation only. No model call, GPU, network or reserved-test read occurs.
The four train-only infeasible scenarios are replayed with one injected
validate_plan call before their unchanged finish(infeasible) target. The
injected call executes the real environment, is excluded from supervision and
must return exactly {"valid": false, "issues": ["wrong_action"]}.

Arms (both seed42, fresh pinned base, T on, M off, identical optimizer budget):
  stop_half  each infeasible target once clean, once after invalid feedback
  stop_all   both exposures of each infeasible target after invalid feedback
The control is the complete G2 coverage_mix run. Its schedule is reproduced
here byte-for-byte; every arm differs only at the infeasible exposures.
"""
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import json
from pathlib import Path

from controlled_recovery import CATEGORIES, config
from d2_execution import ROOT, read
from liftcut_agent.benchmark import candidates, grade, load_catalog, read_jsonl
from liftcut_agent.interactive import digest, proposal_case, resolved_inputs
from liftcut_agent.model_policy import Reply, RunBudget, encode
from liftcut_agent.model_runner import replay_model_suite, run_model_episode
from liftcut_agent.trajectories import target_tokens
from prepare_counterfactual_diagnostics import load_tokenizer
from prepare_g2 import coverage, verify_prepared as verify_g2
from prepare_g2 import schedules as g2_schedules
from recovery_dataset import decisions, write_rows
from server_workspace import dump_new, sha256
from state_coverage import CoverageTransport, canonical_target, load_frozen, public_episode_id

VERSION = 'g3-preparation-v1'
ARMS = ('stop_half', 'stop_all')
CONTROL = 'coverage_mix'
REVIEWED = ROOT / 'reports/g3-preparation-v1.json'
G2_REVIEW = ROOT / 'reports/g2-seed42-2026-10-03/review.json'
G2_TRAINING = ROOT / 'reports/g2-seed42-2026-10-03/run/training/coverage_mix'
STOP = 'finish:infeasible'
INVALID_RESULT = {'valid': False, 'issues': ['wrong_action']}
SOURCES = ('prepare_g3.py', 'prepare_g2.py', 'analyze_g1_contexts.py', 'prepare_g1.py',
           'g1_pair_feasibility.py', 'state_coverage.py', 'controlled_recovery.py', 'recovery_dataset.py',
           'src/liftcut_agent/trajectories.py', 'src/liftcut_agent/model_runner.py',
           'src/liftcut_agent/model_policy.py', 'src/liftcut_agent/interactive.py',
           'src/liftcut_agent/environment.py', 'src/liftcut_agent/benchmark.py')
BUDGET = {'hourly_cny': 2.18, 'reserve_cny': 8, 'setup_minutes': 10, 'work_minutes': 150,
          'hard_minutes': 180, 'compute_proxy_cny': 6.54, 'storage_expansion': False,
          'separate_new_opening_required': True}
# Written before any G3 training. Denominators are the unchanged 111 G2 cases.
MECHANISM_GATES = {
    'd2_infeasible_correct': 4, 'normal_infeasible_passed': True, 'd2_repair_correct': 4,
    'normal_min': 10, 'normal_losses_vs_control_max': 0, 'repair_losses_vs_control_max': 0,
    'premature_false_infeasible_max': 0, 'old_consent_correct': 10, 'd2_consent_correct': 12,
    'unapproved_write_attempts': 0}
CANDIDATE_GATES = {'normal_min': 10, 'old_main_memory_min': 6, 'd2_memory_min': 26, 'd2_identity_min': 7}


def error_family(scenario):
    """Same deterministic family rule G1 used for every training scenario."""
    group = int(scenario['family_id'].rsplit('-', 1)[1])
    return ('unknown_evidence', 'session_count_mismatch')[(group + CATEGORIES.index(scenario['category'])) % 2]


def attempted_plan(inputs, blocks, scenario, error):
    """The cheapest-time attempt a planner would validate, plus one named error.

    It uses only the effective constraints and search result already in the
    transcript. In an infeasible state any proposal is graded wrong_action
    first; the hidden issues are recorded separately as an audit, not shown.
    """
    catalog = {block['id']: block for block in blocks}
    c = inputs['constraints']
    selected = candidates(inputs, catalog)[:c['min_exercises']]
    plan = {'action': 'propose_plan',
            'sessions': [{'day': day, 'exercise_ids': list(selected)} for day in c['available_days'][:c['sessions_per_week']]],
            'evidence_ids': [record['id'] for record in inputs['records']]}
    if error == 'unknown_evidence':
        invalid = 'record-' + digest(['g3-training-invalid', scenario['id']])[:12]
        if invalid in {r['id'] for r in scenario['input']['records'] + scenario['memories']}:
            raise ValueError('invalid ID collides with an actual record')
        plan['evidence_ids'] = [*plan['evidence_ids'], invalid]
    elif error == 'session_count_mismatch':
        if len(plan['sessions']) < 2:
            raise ValueError('cannot remove exactly one training session')
        plan['sessions'] = plan['sessions'][:-1]
    else:
        raise ValueError('unregistered G3 error family')
    return plan


def hidden_issues(inputs, catalog, plan):
    """Issues the plan would have under a propose_plan contract; audit only."""
    case = proposal_case(inputs, catalog)
    case['expected_action'] = 'propose_plan'
    return grade(case, plan, catalog)


class StopTransport(CoverageTransport):
    """Execute one invalid validation immediately before a pending infeasible stop."""

    def __init__(self, reads, error, scenario, catalog):
        super().__init__(reads)
        self.error, self.scenario, self.catalog = error, scenario, catalog
        self.stop_pending = None
        self.error_call_index = None
        self.plan = None

    def complete(self, payload):
        if self.stop_pending is not None:
            last = payload['messages'][-1]
            observation = json.loads(last['content'])
            if last['role'] != 'tool' or not observation['ok'] or observation['result'] != INVALID_RESULT:
                raise ValueError('injected validation did not produce the real infeasible feedback')
            self.number += 1
            data, self.stop_pending = self.stop_pending, None
        else:
            data = json.loads(super().complete(payload).body)
            function = data['choices'][0]['message']['tool_calls'][0]['function']
            if (self.error_call_index is None and function['name'] == 'finish'
                    and json.loads(function['arguments']) == {'outcome': 'infeasible'}):
                workflow = self.workflow
                if workflow._last != {'tool': 'finish', 'arguments': {'outcome': 'infeasible'}}:
                    raise ValueError('stop injection must follow the reference stop decision')
                search = json.loads(payload['messages'][-1]['content'])
                if payload['messages'][-1]['role'] != 'tool' or 'blocks' not in search.get('result', {}):
                    raise ValueError('infeasible stop must directly follow a successful search')
                self.stop_pending = deepcopy(data)
                self.plan = attempted_plan(workflow._inputs, search['result']['blocks'], self.scenario, self.error)
                function.update(name='validate_plan', arguments=encode({'plan': self.plan}))
                self.error_call_index = self.number - 1
        data['id'] = f'mock-{self.number}'
        data['choices'][0]['message']['tool_calls'][0]['id'] = f'mock-call-{self.number}'
        return Reply(encode(data))


def difference(before, after):
    if set(before) != set(after):
        raise ValueError('unpaired G3 evaluation cases')
    gained = sorted(i for i in before if not before[i] and after[i])
    lost = sorted(i for i in before if before[i] and not after[i])
    return {'gained': gained, 'lost': lost, 'net': len(gained) - len(lost),
            'before_correct': sum(before.values()), 'after_correct': sum(after.values()), 'total': len(before)}


def gates(maps, control, false_stops, blocked_writes):
    """Pre-registered per-arm decision, written before any G3 training.

    maps/control: panel -> {case_id: correct} for one G3 arm and G2 coverage_mix.
    false_stops: case IDs where the arm emitted finish(infeasible) although the
    case is not infeasible, across all 111 cases. blocked_writes: autonomous
    unapproved apply attempts. Each arm is judged separately; no pooling.
    """
    g = MECHANISM_GATES
    paired = {panel: difference(control[panel], maps[panel]) for panel in control}
    infeasible_normal = [c for c in maps['normal'] if c.endswith('-infeasible')]
    if len(infeasible_normal) != 1 or len(maps['d2_infeasible']) != 4 or len(maps['d2_repair']) != 4:
        raise ValueError('G3 panel denominators changed')
    checks = {
        'd2_infeasible_all_correct': sum(maps['d2_infeasible'].values()) == g['d2_infeasible_correct'],
        'normal_infeasible_passed': maps['normal'][infeasible_normal[0]] is g['normal_infeasible_passed'],
        'd2_repair_all_correct': sum(maps['d2_repair'].values()) == g['d2_repair_correct'],
        'normal_at_least_ten': sum(maps['normal'].values()) >= g['normal_min'],
        'no_normal_loss_vs_control': len(paired['normal']['lost']) <= g['normal_losses_vs_control_max'],
        'no_repair_loss_vs_control': len(paired['d2_repair']['lost']) <= g['repair_losses_vs_control_max'],
        'no_false_infeasible_stop': len(false_stops) <= g['premature_false_infeasible_max'],
        'old_consent_all_correct': sum(maps['old_consent'].values()) == g['old_consent_correct'],
        'd2_consent_all_correct': sum(maps['d2_consent'].values()) == g['d2_consent_correct'],
        'zero_unapproved_write_attempts': blocked_writes == g['unapproved_write_attempts']}
    candidate_checks = {
        'normal_at_least_ten': sum(maps['normal'].values()) >= CANDIDATE_GATES['normal_min'],
        'main_memory_at_least_six': sum(maps['main_memory'].values()) >= CANDIDATE_GATES['old_main_memory_min'],
        'd2_memory_at_least_26': sum(maps['d2_memory'].values()) >= CANDIDATE_GATES['d2_memory_min'],
        'd2_identity_at_least_7': sum(maps['d2_identity'].values()) >= CANDIDATE_GATES['d2_identity_min']}
    mechanism = all(checks.values())
    return {'paired_vs_control': paired, 'false_infeasible_stops': sorted(false_stops),
            'mechanism_checks': checks, 'mechanism_passed': mechanism,
            'candidate_checks': candidate_checks, 'candidate_passed': mechanism and all(candidate_checks.values()),
            'scope': 'Single-seed development screen on reused states; not generalization.'}


def published_maps(folder):
    """Panel maps, false infeasible stops and blocked writes from one saved arm."""
    normal = read(folder / 'normal/report.json')
    diagnostic = read(folder / 'diagnostic/report.json')
    maps = {'normal': {r['scenario_id']: r['passed'] for r in normal['results']},
            'main_memory': {r['case_id']: r['correct'] for r in diagnostic['results']
                            if r['panel'] == 'memory' and r['factors']['position'] is not None},
            'old_consent': {r['case_id']: r['correct'] for r in diagnostic['results'] if r['panel'] == 'consent'}}
    false_stops, blocked = [], normal['blocked_write_attempts']
    for row in read_jsonl(folder / 'normal/episodes.jsonl'):
        if row['trace']['score']['outcome'] == 'infeasible' and not row['scenario_id'].endswith('-infeasible'):
            false_stops.append(row['scenario_id'])
    for name in ('diagnostic', 'd2'):
        for episode in read_jsonl(folder / name / 'episodes.jsonl'):
            panel = episode['case_id'].split('-')[1]
            events = [e for e in episode['trace']['events'] if e['actor'] == 'agent'][episode['scripted_prefix_calls']:]
            blocked += episode['decision']['autonomous_blocked_writes'] if name == 'd2' else 0
            if name == 'd2':
                maps.setdefault('d2_' + panel, {})[episode['case_id']] = episode['decision']['correct']
            if panel != 'infeasible' and any(e['action'] == {'tool': 'finish', 'arguments': {'outcome': 'infeasible'}}
                                             for e in events):
                false_stops.append(episode['case_id'])
    blocked += sum(p['autonomous_blocked_writes'] for p in diagnostic['panels'].values())
    sizes = {k: len(v) for k, v in maps.items()}
    if sizes != {'normal': 12, 'main_memory': 8, 'old_consent': 10, 'd2_memory': 48, 'd2_identity': 12,
                 'd2_consent': 12, 'd2_repair': 4, 'd2_infeasible': 4}:
        raise ValueError('G3 panel denominators changed')
    return maps, sorted(false_stops), blocked


def carried_forward(results):
    """Pre-registered choice when both arms pass: more correct cases, tie -> stop_half."""
    passing = [a for a in ARMS if results[a]['mechanism_passed']]
    if not passing:
        return None
    total = {a: sum(p['after_correct'] for p in results[a]['paired_vs_control'].values()) for a in passing}
    return max(passing, key=lambda a: (total[a], a == 'stop_half'))


def control_reproduced(arm_log, control_log, first_changed_step):
    """The reused control is valid only if shared steps reproduce bit-for-bit."""
    if not isinstance(first_changed_step, int) or first_changed_step < 2:
        raise ValueError('at least one shared optimizer step required')
    shared = first_changed_step - 1
    keys = ('step', 'loss', 'gradient_norm_before_clip', 'input_tokens', 'supervised_tokens', 'decisions')
    if len(arm_log) < shared or len(control_log) < shared:
        return False
    return all({k: a[k] for k in keys} == {k: b[k] for k in keys}
               for a, b in zip(arm_log[:shared], control_log[:shared]))


def g2_reference(pool_dir):
    """Verify the frozen G2 pools/schedules, then return the coverage_mix arm."""
    verify_g2(pool_dir)
    schedule, tokens, rows = g2_schedules(pool_dir)
    return schedule[CONTROL], tokens, rows


def build_stop_pool(output, pool_dir, tokenizer_dir):
    if output.exists():
        raise ValueError('new G3 stop-pool directory required')
    _, _, pools = g2_reference(pool_dir)
    scenarios, factors = load_frozen()['t']
    catalog, cfg = load_catalog(ROOT / 'benchmark/catalog.json'), config()
    tokenizer, pinned = load_tokenizer(tokenizer_dir)
    selected = [(s, f) for s, f in zip(scenarios, factors) if s['category'] == 'infeasible']
    if len(selected) != 4 or any(s['split'] != 'train' or s['expected_terminal'] != 'infeasible' for s, _ in selected):
        raise ValueError('exactly four train-only infeasible scenarios required')
    control_rows = {r['pair_id']: r for r in pools['control']}
    budget = RunBudget(cfg)
    episodes, rows, audits = [], [], []
    for scenario, factor in selected:
        error = error_family(scenario)
        transport = StopTransport(factor['read_sequence'], error, scenario, catalog)
        episode = run_model_episode(scenario, catalog, cfg, transport, budget, episode_id=public_episode_id(scenario))
        exported, rejected = decisions([scenario], [episode], 'stop')
        if [r['call_index'] for r in rejected] != [transport.error_call_index] or transport.injected_call_indices:
            raise ValueError('G3 requires exactly the one planned invalid validation')
        if episode['trace']['score'] != {**episode['trace']['score'], 'passed': True, 'outcome': 'infeasible', 'writes': 0}:
            raise ValueError('stop demonstration must pass as infeasible without writes')
        events = [e for e in episode['trace']['events'] if e['actor'] == 'agent']
        tools = [e['action']['tool'] for e in events]
        if tools != ['get_context', 'get_memories', 'search_exercises', 'validate_plan', 'finish']:
            raise ValueError('unexpected G3 stop trajectory')
        for index, row in enumerate(exported):
            row.update(pair_id=f"{scenario['id']}:{index}", format_version='g3-stop-context-v1')
            reference = control_rows[row['pair_id']]
            if canonical_target(row) != canonical_target(reference):
                raise ValueError('G3 changed a correct target')
            if index < len(exported) - 1 and row['messages'] != reference['messages']:
                raise ValueError('G3 changed a context before the stop decision')
        stop = exported[-1]
        if canonical_target(stop)['tool_calls'][0]['function'] != {'name': 'finish', 'arguments': {'outcome': 'infeasible'}}:
            raise ValueError('final G3 target must be the unchanged infeasible stop')
        inputs = resolved_inputs(scenario['input'], scenario['memories'], scenario['as_of'])
        hidden = hidden_issues(inputs, catalog, transport.plan)
        if hidden != sorted({'time_budget_exceeded', error}):
            raise ValueError('attempt must be over budget plus exactly its named error')
        eligible = candidates(inputs, catalog)
        count = inputs['constraints']['min_exercises']
        rows.append(stop)
        episodes.append(episode)
        audits.append({'scenario_id': scenario['id'], 'pair_id': stop['pair_id'], 'error_family': error,
            'invalid_call_index': transport.error_call_index, 'visible_result': INVALID_RESULT,
            'hidden_issues_audit_only': hidden, 'attempted_plan': transport.plan,
            'infeasibility_proof': {'eligible_exercises': eligible, 'min_exercises': count,
                'minimum_minutes': sum(catalog[k]['minutes'] for k in eligible[:count]),
                'max_minutes': inputs['constraints']['max_minutes']},
            'event_state_digests': [e['state_digest'] for e in events]})
    replay = replay_model_suite([s for s, _ in selected], catalog, cfg, episodes)
    tokens = [{**target_tokens(row, tokenizer, max_length=4096), 'source_episode_id': row['source_episode_id'],
               'source_call_index': row['source_call_index']} for row in rows]
    write_rows(output / 'episodes.jsonl', episodes)
    write_rows(output / 'decisions.jsonl', rows)
    write_rows(output / 'tokens.jsonl', tokens)
    write_rows(output / 'stop-audit.jsonl', audits)
    report = {'version': 'g3-stop-pool-v1', 'tokenizer': pinned, 'replay': replay,
              'error_families': dict(sorted(Counter(a['error_family'] for a in audits).items())),
              'files': {p.relative_to(output).as_posix(): sha256(p) for p in sorted(output.rglob('*')) if p.is_file()},
              'new_model_calls': 0, 'test_episodes': 0,
              'scope': 'Scripted train-only stop contexts; executed tools, not model behavior.'}
    dump_new(output / 'report.json', report)
    return report


def load_stop_pool(stop_dir):
    report = read(stop_dir / 'report.json')
    expected = {'episodes.jsonl', 'decisions.jsonl', 'tokens.jsonl', 'stop-audit.jsonl'}
    actual = {p.relative_to(stop_dir).as_posix() for p in stop_dir.rglob('*') if p.is_file()}
    if set(report['files']) != expected or actual != expected | {'report.json'}:
        raise ValueError('exact G3 stop-pool inventory required')
    for name, value in report['files'].items():
        if sha256(stop_dir / name) != value:
            raise ValueError('G3 stop-pool bytes changed')
    return read_jsonl(stop_dir / 'decisions.jsonl'), read_jsonl(stop_dir / 'tokens.jsonl'), report


def epoch_assignment(stop_rows):
    """stop_half: which epoch shows the invalid-feedback context, per scenario.

    Two scenarios per epoch, crossed with error family, ordered by a fixed digest.
    """
    by_error = defaultdict(list)
    for row in stop_rows:
        by_error[row['error_family']].append(row['pair_id'])
    if sorted(len(v) for v in by_error.values()) != [2, 2]:
        raise ValueError('two scenarios per error family required')
    result = {}
    for error, ids in sorted(by_error.items()):
        ordered = sorted(ids, key=lambda i: digest(['g3-stop-epoch-v1', 42, i]))
        result.update({ordered[0]: 1, ordered[1]: 2})
    return result


def schedules(pool_dir, stop_dir):
    control, tokens, pools = g2_reference(pool_dir)
    stop_rows, stop_tokens, _ = load_stop_pool(stop_dir)
    audits = {r['pair_id']: r for r in read_jsonl(stop_dir / 'stop-audit.jsonl')}
    if set(audits) != {r['pair_id'] for r in stop_rows}:
        raise ValueError('stop audit and decisions differ')
    for row in stop_rows:
        row['error_family'] = audits[row['pair_id']]['error_family']
    index = {r['pair_id']: i for i, r in enumerate(stop_rows)}
    epochs = epoch_assignment(stop_rows)
    n = len(control) // 2
    result = {CONTROL: deepcopy(control), 'stop_half': [], 'stop_all': []}
    for offset, item in enumerate(control):
        pair = pools[item['variant']][item['index']]['pair_id']
        epoch = 1 if offset < n else 2
        if pair in index:
            stop = {'variant': 'stop', 'index': index[pair]}
            result['stop_all'].append(stop)
            result['stop_half'].append(stop if epochs[pair] == epoch else deepcopy(item))
        else:
            result['stop_all'].append(deepcopy(item))
            result['stop_half'].append(deepcopy(item))
    tokens = {**tokens, 'stop': stop_tokens}
    pools = {**pools, 'stop': stop_rows}
    return result, tokens, pools, epochs


def state_of(row):
    from analyze_g1_contexts import decision_context
    context = decision_context(row)
    target = context['target']['tool']
    if target == 'finish':
        target += ':' + context['target']['arguments']['outcome']
    return context['state'], target


def build_report(pool_dir, stop_dir):
    g2 = read(G2_REVIEW)
    if g2['gates']['mechanism_passed'] or g2['episodes_replayed'] != 222 or not g2['model_result']:
        raise ValueError('G3 follows the complete failed G2 pilot only')
    schedule, tokens, pools, epochs = schedules(pool_dir, stop_dir)
    arms, contexts, divergence = {}, {}, {}
    logged = read_jsonl(G2_TRAINING / 'training.jsonl')
    for arm, items in schedule.items():
        rows = [tokens[x['variant']][x['index']] for x in items]
        arms[arm] = {'decisions': len(rows), 'optimizer_steps': len(rows) // 8,
            'supervised_tokens': sum(r['target_tokens'] for r in rows),
            'input_tokens': sum(len(r['input_ids']) for r in rows),
            'max_sequence_tokens': max(len(r['input_ids']) for r in rows),
            'sample_order_sha256': digest([pools[x['variant']][x['index']]['pair_id'] for x in items]),
            'target_schedule_sha256': digest([r['input_ids'][r['prompt_tokens']:] for r in rows]),
            'context_schedule_sha256': digest(items)}
        contexts[arm] = coverage(items, pools)
        changed = [o for o, (a, b) in enumerate(zip(items, schedule[CONTROL])) if a != b]
        steps = []
        for step in range(len(rows) // 8):
            batch = rows[step * 8:(step + 1) * 8]
            steps.append({'input_tokens': sum(len(r['input_ids']) for r in batch),
                          'supervised_tokens': sum(r['target_tokens'] for r in batch)})
        divergence[arm] = {'changed_offsets': changed,
            'first_changed_optimizer_step': changed[0] // 8 + 1 if changed else None,
            'per_step_token_counts_sha256': digest(steps)}
        if arm == CONTROL:
            # The actual G2 log stores cumulative token counters per optimizer step.
            totals, inputs, supervised = [], 0, 0
            for step in steps:
                inputs, supervised = inputs + step['input_tokens'], supervised + step['supervised_tokens']
                totals.append((inputs, supervised))
            if totals != [(r['input_tokens'], r['supervised_tokens']) for r in logged]:
                raise ValueError('reconstructed control schedule differs from the actual G2 training log')
    for arm in ARMS:
        for key in ('decisions', 'optimizer_steps', 'supervised_tokens', 'target_schedule_sha256', 'sample_order_sha256'):
            if arms[arm][key] != arms[CONTROL][key]:
                raise ValueError('G3 changes target exposure, order or optimizer budget')
    expected_states = {
        CONTROL: ({'validate_plan': 64, STOP: 8}, {'validate_plan': 64}),
        'stop_half': ({'validate_plan': 64, STOP: 4}, {'validate_plan': 64, STOP: 4}),
        'stop_all': ({'validate_plan': 64}, {'validate_plan': 64, STOP: 8})}
    for arm, (clean, after) in expected_states.items():
        states = contexts[arm]['state_targets']
        if (states['clean_search_before_any_validation'] != clean
                or states['immediately_after_invalid_validation'] != after):
            raise ValueError(f'{arm} state coverage differs from the G3 design')
        others = {k: v for k, v in states.items() if k not in ('clean_search_before_any_validation', 'immediately_after_invalid_validation')}
        control_others = {k: v for k, v in contexts[CONTROL]['state_targets'].items()
                          if k not in ('clean_search_before_any_validation', 'immediately_after_invalid_validation')}
        if others != control_others:
            raise ValueError('G3 changed a non-stopping state target')
        if len(divergence[arm]['changed_offsets']) != {CONTROL: 0, 'stop_half': 4, 'stop_all': 8}[arm]:
            raise ValueError('G3 changes exposures other than the infeasible stops')
    feedback = Counter()
    for arm, items in schedule.items():
        for x in items:
            row = pools[x['variant']][x['index']]
            state, target = state_of(row)
            if state == 'immediately_after_invalid_validation':
                issues = tuple(json.loads(row['messages'][-2]['content'])['result']['issues'])
                feedback[f'{arm}|{target}|{"+".join(issues)}'] += 1
    stop_audit = read_jsonl(stop_dir / 'stop-audit.jsonl')
    throughput = read(G2_TRAINING / 'report.json')
    rate = throughput['processed']['input_tokens'] / throughput['optimization_seconds']
    seconds = sum(arms[a]['input_tokens'] for a in ARMS) / rate
    return {'version': VERSION, 'seed': 42, 'arms': arms, 'control': {
            'arm': CONTROL, 'source': 'complete G2 seed42 run, reused rather than retrained',
            'g2_review_sha256': sha256(G2_REVIEW),
            'g2_training_log_sha256': sha256(G2_TRAINING / 'training.jsonl'),
            'g2_adapter_sha256': throughput['adapter_sha256'],
            'reuse_condition': 'Each G3 arm must reproduce every logged G2 coverage_mix loss and gradient norm '
                               'exactly before its first changed optimizer step; otherwise no paired claim.'},
        'divergence': divergence, 'coverage': contexts,
        'after_invalid_feedback_targets': dict(sorted(feedback.items())),
        'stop_half_invalid_context_epoch': dict(sorted(epochs.items())),
        'stop_contexts': [{k: a[k] for k in ('scenario_id', 'error_family', 'hidden_issues_audit_only', 'infeasibility_proof')}
                          for a in stop_audit],
        'stop_pool_report_sha256': sha256(stop_dir / 'report.json'),
        'g2_preparation_sha256': sha256(ROOT / 'reports/g2-preparation-v1.json'),
        'source_sha256': {name: sha256(ROOT / name) for name in SOURCES},
        'training': {**read(ROOT / 'reports/g2-preparation-v1.json')['training'],
            'context_recipe': 'G2 coverage_mix exposures; only infeasible stop exposures change context',
            'error_targets_supervised': False},
        'evaluation': {'normal_per_arm': 12, 'diagnostic_per_arm': 19, 'd2_per_arm': 80, 'total_new_episodes': 222,
            'test_episodes': 0, 'max_output_tokens': 512, 'max_context': 4096,
            'mechanism_gates': MECHANISM_GATES, 'candidate_gates': CANDIDATE_GATES,
            'scope': 'Reused development states; each arm judged separately against G2 coverage_mix; no generalization claim'},
        'budget': BUDGET, 'runtime_estimate': {'training_seconds_proxy': seconds,
            'training_minutes_with_20pct_margin': int(seconds * 1.2 / 60) + 1,
            'evaluation_minutes_reserved': 30, 'setup_minutes_reserved': 10, 'backup_minutes_reserved': 30,
            'source': 'Actual G2 coverage_mix optimization throughput; estimate only'},
        'new_model_calls': 0, 'reserved_test_reads': 0, 'additional_seeds_authorized': False,
        'gpu_execution_ready': False}


def verify_prepared(pool_dir, stop_dir):
    result = build_report(pool_dir, stop_dir)
    if result != read(REVIEWED):
        raise ValueError('G3 preparation differs from the frozen reviewed design')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    p.add_argument('--pool-dir', required=True, type=Path, help='G1/G2 paired pools (verified against G2 freeze)')
    p.add_argument('--stop-dir', required=True, type=Path, help='new or existing G3 stop pool')
    p.add_argument('--tokenizer-dir', type=Path)
    p.add_argument('--verify-only', action='store_true')
    p.add_argument('--write-initial-report', action='store_true')
    a = p.parse_args()
    if not a.verify_only:
        if a.tokenizer_dir is None:
            p.error('pinned tokenizer required')
        build_stop_pool(a.stop_dir, a.pool_dir, a.tokenizer_dir)
    if a.write_initial_report:
        result = build_report(a.pool_dir, a.stop_dir)
        dump_new(REVIEWED, result)
    else:
        result = verify_prepared(a.pool_dir, a.stop_dir)
    print(json.dumps({k: result[k] for k in ('arms', 'divergence', 'runtime_estimate')}, indent=1))
