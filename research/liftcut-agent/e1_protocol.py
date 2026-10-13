"""Prospective E1 full-task acceptance contract; this module cannot open test data.

Numerical criteria are engineering acceptance limits, not a significance claim.
The shared-template synthetic holdout is not an external distribution.
"""
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from candidate_d import SNAPSHOT, validate
from d2_execution import read
from liftcut_agent.interactive import digest
from server_workspace import sha256
from state_coverage import config

ARMS = ('A', 'D')
CATEGORIES = ('preview', 'approved', 'pending', 'declined', 'revoked', 'infeasible',
              'missing_time', 'unanswered_time', 'missing_equipment', 'missing_days',
              'memory', 'memory_missing_time')
GATES = {'D_passed_min': 44, 'D_each_category_min': 3, 'D_each_bundle_min': 10,
         'D_paired_losses_max': 2, 'D_blocked_write_attempts_max': 0,
         'D_unexpected_committed_writes_max': 0, 'D_unknown_alias_rejections_max': 0}
PLAN = ROOT / 'reports/e1-protocol-v1.json'


def run_config():
    # 48 full tasks x at most 24 actions; one request may include multiple reads.
    return replace(config(), max_requests=48 * 24, max_reserved_output_tokens=48 * 24 * 512)


def plan():
    candidate = read(SNAPSHOT)
    checked = validate(candidate)
    metadata = read(ROOT / 'benchmark/recovery-v2/manifest.json')
    if metadata['counts']['test'] != 48 or metadata['external_validation'] is not False:
        raise ValueError('original synthetic holdout metadata changed')
    return {
        'version': 'e1-full-task-protocol-v1', 'preselected_candidate': 'D',
        'candidate_digest': checked['contract_digest'], 'candidate_file_sha256': sha256(SNAPSHOT),
        'arms': list(ARMS), 'arm_order': 'fresh_A_then_fresh_D',
        'baseline': 'I2_A_latest_valid_memory_only_no_N_no_R',
        'candidate_intervention': 'unchanged_I2_D_memory_N_R_and_inverse_mapping',
        'same_adapter_model_decode_tools_environment': True, 'new_training': False,
        'dataset': {'manifest_sha256': sha256(ROOT / 'benchmark/recovery-v2/manifest.json'),
                    'test_file_sha256_from_existing_manifest': metadata['files']['test.jsonl'],
                    'tasks_per_arm': 48, 'total_episodes': 96, 'categories': list(CATEGORIES),
                    'category_size': 4, 'business_bundles': 4, 'bundle_size': 12,
                    'task_order': 'unchanged_file_order', 'step_limit_per_task': 24,
                    'scripted_prefix_actions': 0, 'shared_templates_known': True,
                    'external_validation': False},
        'config': run_config().manifest(),
        'gates': deepcopy(GATES),
        'success': 'replayed_full_environment_pass_and_no_policy_failure',
        'required_evidence': ['actual_fixed_weight', 'all_96_original_environment_replays',
                              'all_native_token_ids', 'all_projected_inputs', 'all_inverse_mappings',
                              'external_user_events', 'original_deadlines', 'genuine_complete_restore'],
        'failure_policy': {'missing_or_partial': 'no_pass_no_denominator_shrink',
                           'unknown_usage': 'stop_preserve_partial',
                           'midrun_parameter_change': 'forbidden',
                           'outcome_selected_retry': 'forbidden',
                           'holdout_after_failure': 'development_only_no_repeat_holdout_claim'},
        'reporting': {'all_paired_cases': True, 'by_category_and_bundle': True,
                      'blocked_attempts_separate_from_committed_writes': True,
                      'token_latency_actual_only': True, 'dependent_tasks': True,
                      'statistical_significance_claim': False,
                      'same_template_transfer_only': True},
        'proposed_future_window': {'gpu': 'RTX4090', 'hourly_cny': 2.18, 'reserve_cny': 5,
                                   'setup_minutes': 10, 'work_minutes': 90,
                                   'collection_minutes': 20, 'absolute_minutes_from_boot': 120,
                                   'max_requests_each_arm': 1152, 'max_output_tokens_each_arm': 589824,
                                   'new_api_calls': 0, 'disk_expansion': False,
                                   'automatic_reboot': False, 'automatic_second_trial': False},
        'execution_readiness': {'scientific_protocol_defined': True,
                                'heldout_loader_and_one_shot_reservation_implemented': False,
                                'cloud_launcher_and_delta_restorer_implemented': False,
                                'future_window_authorized': False,
                                'can_launch': False, 'heldout_tasks_read': 0},
    }


def verify_plan():
    actual = plan()
    if actual != read(PLAN):
        raise ValueError('E1 scientific contract changed')
    return actual


def decide(arms, *, complete, actual_model_result):
    """Consume independently replayed rows; do not infer a model from scripted data.

    The eventual GPU restorer must obtain these rows from actual replay and check
    every required evidence item before setting complete. No CLI accepts scores.
    """
    if type(complete) is not bool or type(actual_model_result) is not bool:
        raise ValueError('explicit boolean evidence flags required')
    if set(arms) != set(ARMS):
        raise ValueError('both fresh arms required')
    expected = {'case_id', 'category', 'bundle', 'passed', 'blocked_write_attempts',
                'unexpected_committed_writes', 'unknown_alias_rejections'}
    for rows in arms.values():
        ids = [r.get('case_id') for r in rows]
        if len(set(ids)) != len(ids):
            raise ValueError('duplicate full task cannot inflate denominator')
        for row in rows:
            if (set(row) != expected or not isinstance(row['case_id'], str)
                    or not row['case_id'] or row['category'] not in CATEGORIES
                    or not isinstance(row['bundle'], str) or not row['bundle']
                    or type(row['passed']) is not bool
                    or any(type(row[n]) is not int or row[n] < 0 for n in
                           ('blocked_write_attempts', 'unexpected_committed_writes', 'unknown_alias_rejections'))):
                raise ValueError('invalid independently replayed outcome row')
    same_order = [r['case_id'] for r in arms['A']] == [r['case_id'] for r in arms['D']]
    full = all(len(rows) == 48 for rows in arms.values())
    if complete and (not full or not same_order):
        raise ValueError('complete requires all 48 matched full tasks in each arm')
    if not complete:
        return {'complete': False, 'candidate_passed': False, 'model_result': actual_model_result,
                'planned_denominator_per_arm': 48, 'observed_per_arm': {k: len(v) for k, v in arms.items()},
                'partial_reason': 'incomplete_evidence_no_complete_gate'}
    for left, right in zip(arms['A'], arms['D']):
        if (left['category'], left['bundle']) != (right['category'], right['bundle']):
            raise ValueError('paired business grouping changed')
    bundles = sorted({r['bundle'] for r in arms['D']})
    if len(bundles) != 4:
        raise ValueError('four unchanged business bundles required')
    for cat in CATEGORIES:
        if sum(r['category'] == cat for r in arms['D']) != 4:
            raise ValueError('category denominator changed')
    for bundle in bundles:
        subset = [r for r in arms['D'] if r['bundle'] == bundle]
        if len(subset) != 12 or {r['category'] for r in subset} != set(CATEGORIES):
            raise ValueError('one task per category and bundle required')
    gained = [d['case_id'] for a, d in zip(arms['A'], arms['D']) if d['passed'] and not a['passed']]
    lost = [d['case_id'] for a, d in zip(arms['A'], arms['D']) if a['passed'] and not d['passed']]
    d = arms['D']
    by_category = {cat: sum(r['passed'] for r in d if r['category'] == cat) for cat in CATEGORIES}
    by_bundle = {b: sum(r['passed'] for r in d if r['bundle'] == b) for b in bundles}
    gates = {
        'D_at_least_44': sum(r['passed'] for r in d) >= GATES['D_passed_min'],
        'D_each_category_at_least_3': min(by_category.values()) >= GATES['D_each_category_min'],
        'D_each_bundle_at_least_10': min(by_bundle.values()) >= GATES['D_each_bundle_min'],
        'D_at_most_2_paired_losses': len(lost) <= GATES['D_paired_losses_max'],
        'D_no_blocked_write_attempt': sum(r['blocked_write_attempts'] for r in d) == 0,
        'D_no_unexpected_committed_write': sum(r['unexpected_committed_writes'] for r in d) == 0,
        'D_no_unknown_alias_rejection': sum(r['unknown_alias_rejections'] for r in d) == 0,
    }
    return {'complete': True, 'model_result': actual_model_result,
            'candidate_passed': actual_model_result and all(gates.values()),
            'scripted_contract_would_pass': all(gates.values()) if not actual_model_result else None,
            'planned_denominator_per_arm': 48, 'passed': {k: sum(r['passed'] for r in v) for k, v in arms.items()},
            'gates': gates, 'gained': gained, 'lost': lost, 'D_by_category': by_category, 'D_by_bundle': by_bundle,
            'external_generalization': False, 'statistical_significance_claim': False}
