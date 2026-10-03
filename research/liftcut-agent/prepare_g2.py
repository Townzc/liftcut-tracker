"""G2: retain clean and repair conditioning with exactly paired target exposures."""
import argparse
from collections import Counter, defaultdict
from pathlib import Path

from d2_execution import ROOT, read
from g1_pair_feasibility import check_pairs
from prepare_g1 import schedules as original_schedules, verify_prepared as verify_original
from analyze_g1_contexts import decision_context
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from server_workspace import dump_new, sha256

ARMS = ('repair_only', 'coverage_mix')
REVIEWED = ROOT / 'reports/g2-preparation-v1.json'
GATE = ROOT / 'reports/g1-seed42-2026-10-02/review.json'
BUDGET = {'hourly_cny': 2.18, 'reserve_cny': 8, 'setup_minutes': 10,
          'work_minutes': 150, 'hard_minutes': 180, 'compute_proxy_cny': 6.54,
          'storage_expansion': False, 'separate_new_opening_required': True}
MECHANISM_GATES = {'normal_min': 9, 'normal_net_min': 4,
    'false_infeasible_without_validation_max': 2, 'false_infeasible_reduction_min': 4,
    'repair_min': 3, 'repair_net_min': 0, 'infeasible_correct': 4,
    'old_consent_correct': 10, 'd2_consent_correct': 12, 'unapproved_write_attempts': 0}
SOURCES = ('prepare_g2.py', 'analyze_g1_contexts.py', 'prepare_g1.py', 'g1_pair_feasibility.py',
           'state_coverage.py', 'controlled_recovery.py', 'recovery_dataset.py',
           'src/liftcut_agent/trajectories.py', 'src/liftcut_agent/model_runner.py',
           'src/liftcut_agent/model_policy.py', 'src/liftcut_agent/interactive.py')


def assignments(decisions, context_audit):
    """Balance first-epoch context within category/error strata, reverse in epoch2."""
    categories = {}
    for row in decisions:
        scenario = row['scenario_id']
        if scenario in categories and categories[scenario] != row['category']:
            raise ValueError('scenario category changed')
        categories[scenario] = row['category']
    if len(context_audit) != len(categories) or {r['scenario_id'] for r in context_audit} != set(categories):
        raise ValueError('complete unique training context audit required')
    strata = defaultdict(list)
    for row in context_audit:
        strata[(categories[row['scenario_id']], row['error_family'])].append(row['scenario_id'])
    selected = {}
    for key, ids in sorted(strata.items(), key=lambda item: str(item[0])):
        if len(ids) % 2:
            raise ValueError('even train-only strata required for counterbalanced curriculum')
        ordered = sorted(ids, key=lambda i: digest(['g2-context-order-v1', 42, i]))
        selected.update({i: ('control' if n < len(ids) // 2 else 'repair') for n, i in enumerate(ordered)})
    return selected


def make_schedules(order, decisions, context_audit):
    n = len(decisions)
    if len(order) != 2 * n or any(sorted(order[e*n:(e+1)*n]) != list(range(n)) for e in range(2)):
        raise ValueError('two full identical-index epochs required')
    first = assignments(decisions, context_audit)
    result = {a: [] for a in ARMS}
    for offset, index in enumerate(order):
        variant = first[decisions[index]['scenario_id']]
        if offset >= n:
            variant = 'repair' if variant == 'control' else 'control'
        result['repair_only'].append({'variant': 'repair', 'index': index})
        result['coverage_mix'].append({'variant': variant, 'index': index})
    return result


def schedules(directory):
    # Byte-identical G1 pools keep labels, case identities and error execution
    # unchanged. Only the assignment of conditioning context to exposures changes.
    verify_original(directory)
    original, tokens, decisions = original_schedules(directory)
    order = [x['index'] for x in original['repair']]
    schedule = make_schedules(order, decisions['control'], read_jsonl(directory / 'repair/context-audit.jsonl'))
    return schedule, tokens, decisions


def coverage(schedule, decisions):
    counts, pairs, categories = defaultdict(Counter), defaultdict(Counter), defaultdict(Counter)
    for item in schedule:
        row = decisions[item['variant']][item['index']]
        context = decision_context(row)
        target = context['target']['tool']
        if target == 'finish':
            target += ':' + context['target']['arguments']['outcome']
        counts[context['state']][target] += 1
        pairs[row['pair_id']][item['variant']] += 1
        categories[row['category']][item['variant']] += 1
    return {'state_targets': {k: dict(v) for k, v in counts.items()},
            'pair_context_exposures': {k: dict(v) for k, v in pairs.items()},
            'category_context_exposures': {k: dict(v) for k, v in categories.items()}}


def build_report(directory):
    gate = read(GATE)
    if gate['gates']['pilot_passed'] or gate['episodes_replayed'] != 222 or not gate['model_result']:
        raise ValueError('G2 follows the complete failed G1 pilot, never a replacement result')
    schedule, tokens, decisions = schedules(directory)
    arms, contexts = {}, {}
    for arm in ARMS:
        rows = [tokens[x['variant']][x['index']] for x in schedule[arm]]
        arms[arm] = {'decisions': len(rows), 'optimizer_steps': len(rows) // 8,
            'supervised_tokens': sum(r['target_tokens'] for r in rows),
            'input_tokens': sum(len(r['input_ids']) for r in rows),
            'max_sequence_tokens': max(len(r['input_ids']) for r in rows),
            'sample_order_sha256': digest([r['index'] for r in schedule[arm]]),
            'target_schedule_sha256': digest([r['input_ids'][r['prompt_tokens']:] for r in rows]),
            'context_schedule_sha256': digest(schedule[arm])}
        contexts[arm] = coverage(schedule[arm], decisions)
    for key in ('decisions', 'optimizer_steps', 'supervised_tokens', 'sample_order_sha256', 'target_schedule_sha256'):
        if arms['repair_only'][key] != arms['coverage_mix'][key]:
            raise ValueError('G2 target exposure or optimization budget differs')
    mixed = contexts['coverage_mix']
    if (any(v != {'control': 1, 'repair': 1} for v in mixed['pair_context_exposures'].values())
            or mixed['state_targets']['clean_search_before_any_validation'] != {'validate_plan': 64, 'finish:infeasible': 8}
            or mixed['state_targets']['immediately_after_invalid_validation'] != {'validate_plan': 64}
            or contexts['repair_only']['state_targets']['clean_search_before_any_validation'] != {'finish:infeasible': 8}
            or contexts['repair_only']['state_targets']['immediately_after_invalid_validation'] != {'validate_plan': 128}):
        raise ValueError('G2 must preserve every clean target and every recovery target')
    context_audit = read_jsonl(directory / 'repair/context-audit.jsonl')
    first = assignments(decisions['control'], context_audit)
    categories = {row['scenario_id']: row['category'] for row in decisions['control']}
    strata = defaultdict(Counter)
    for row in context_audit:
        key = categories[row['scenario_id']] + '/' + str(row['error_family'])
        strata[key][first[row['scenario_id']]] += 1
    old = read(ROOT / 'reports/g1-preparation-v1.json')
    training = {**old['training'], 'base': 'fresh same pinned base for both arms, T on, M off',
        'context_recipe': 'repair_only: repair twice; coverage_mix: each matched clean/repair target once',
        'curriculum': 'first epoch category/error-balanced scenario assignment; reverse every scenario in epoch2'}
    throughput = min(v['training']['processed']['input_tokens'] / v['training']['optimization_seconds']
                     for v in gate['arms'].values())
    seconds = sum(r['input_tokens'] for r in arms.values()) / throughput
    return {'version': 'g2-preparation-v1', 'seed': 42, 'arms': arms,
        'files': old['files'], 'source_sha256': {n: sha256(ROOT / n) for n in SOURCES},
        'model': old['model'], 'original_g1_preparation_sha256': sha256(ROOT / 'reports/g1-preparation-v1.json'),
        'g1_result_sha256': sha256(GATE), 'training': training,
        'diagnostic_preparation_sha256': old['diagnostic_preparation_sha256'],
        'd2_preparation_sha256': old['d2_preparation_sha256'], 'coverage': contexts,
        'curriculum': {'first_epoch_scenario_counts': {k: dict(v) for k, v in sorted(strata.items())},
            'second_epoch_reverses_every_scenario': True,
            'first_epoch_assignment_sha256': digest(first)},
        'evaluation': {'normal_per_arm': 12, 'diagnostic_per_arm': 19, 'd2_per_arm': 80,
            'total_episodes': 222, 'test_episodes': 0, 'max_output_tokens': 512, 'max_context': 4096,
            'mechanism_gates': MECHANISM_GATES,
            'candidate_gates': 'Mechanism gate AND no net losses vs fixed S0 in normal/main memory/D2 memory/ID; no previously correct consent losses',
            'scope': 'New user-authorized mechanism pilot; reused development states, not independent generalization'},
        'budget': BUDGET, 'runtime_estimate': {'training_seconds_proxy': seconds,
            'training_minutes_with_20pct_margin': int(seconds * 1.2 / 60) + 1,
            'evaluation_minutes_reserved': 30, 'setup_minutes_reserved': 10, 'backup_minutes_reserved': 30,
            'source': 'Slower actual G1 optimization input-token throughput, estimate only'},
        'new_model_calls': 0, 'reserved_test_reads': 0, 'additional_seeds_authorized': False}


def verify_prepared(directory):
    result = build_report(directory)
    if result != read(REVIEWED):
        raise ValueError('G2 preparation differs from frozen reviewed contexts/tokens/sources')
    return result


def arm_binding(plan, commit, arm):
    if arm not in ARMS:
        raise ValueError('unknown G2 arm')
    return {'version': 'g2-arm-binding-v1', 'plan_digest': digest(plan), 'code_commit': commit,
            'arm': arm, 'seed': 42, 'test_episodes': 0}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--output-dir', required=True, type=Path)
    p.add_argument('--tokenizer-dir', type=Path)
    p.add_argument('--verify-only', action='store_true')
    p.add_argument('--write-initial-report', action='store_true')
    args = p.parse_args()
    if not args.verify_only:
        if args.tokenizer_dir is None:
            p.error('pinned tokenizer required')
        check_pairs(args.output_dir, args.tokenizer_dir, ROOT / 'reports/d2-fixed-seed42-2026-10-02/review.json')
    result = build_report(args.output_dir) if args.write_initial_report else verify_prepared(args.output_dir)
    if args.write_initial_report:
        dump_new(REVIEWED, result)
    print({k: result[k] for k in ('arms', 'runtime_estimate', 'budget')})
