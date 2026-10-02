"""Describe all fixed-seed D2 contrasts after an independent complete replay."""
import argparse
from collections import Counter
import math
from pathlib import Path
from statistics import median

from analyze_d2_partial import describe
from counterfactual_diagnostics import load_prepared
from d2_execution import ARMS, ROOT, aware, ordered_cases, read
from liftcut_agent.benchmark import read_jsonl
from publish_d2_results import verify_complete
from server_workspace import dump_new, sha256


def timing(rows):
    seconds = sorted(row['elapsed_seconds'] for row in rows if row['model_called'])
    return {'actual_generations': len(seconds), 'sum_generation_seconds': sum(seconds),
            'median_generation_seconds': median(seconds),
            'nearest_rank_p95_generation_seconds': seconds[math.ceil(len(seconds) * .95) - 1]}


def compare_repeated_s0(current, previous):
    old = {row['case_id']: row for row in previous}
    if len(old) != 80 or [row['case_id'] for row in current] != [row['case_id'] for row in previous]:
        raise ValueError('repeat comparison needs the same ordered 80 cases')
    changed = [row['case_id'] for row in current if row['decision'] != old[row['case_id']]['decision']]
    gains = [row['case_id'] for row in current if row['decision']['correct'] and not old[row['case_id']]['decision']['correct']]
    losses = [row['case_id'] for row in current if not row['decision']['correct'] and old[row['case_id']]['decision']['correct']]
    return {'changed_decision_cases': changed, 'gains': gains, 'losses': losses,
            'scope': 'Same S0 weights and repeated development inputs in two operational windows; not independent replication or a second seed'}


def operational_evidence(public, binding):
    rows = read_jsonl(public / 'operations.jsonl')
    terminal = [r for r in rows if r['event'] in {'launcher_or_collector_stopped', 'monitor_finished'}]
    if len(terminal) != 1 or terminal[0] != rows[-1]:
        raise ValueError('publish operations only after the sole collector ends')
    receipt = read(public / 'restore-receipt.json')
    verified = [r for r in rows if r['event'] == 'off_instance_verified']
    if len(verified) != 1 or verified[0]['receipt'] != receipt:
        raise ValueError('operation evidence must contain the actual restored receipt')
    transferred = [r for r in rows if r['event'] in {'receipt_atomic_published', 'receipt_already_present'}]
    for event in transferred:
        if event['receipt_sha256'] != sha256(public / 'restore-receipt.json'):
            raise ValueError('published receipt bytes differ from transport observation')
    server = read_jsonl(public / 'server-events.jsonl')
    consumed = [r for r in server if r['event'] == 'server_receipt_consumed']
    requests = [r for r in server if r['event'] == 'shutdown_requested']
    observations = {r['file']: r['value'] for r in rows if r['event'] == 'server_observation'}
    start, end = aware(binding['booted_at_proxy']), aware(terminal[0]['at_utc'])
    elapsed = (end - start).total_seconds()
    if elapsed <= 0:
        raise ValueError('terminal observation predates the opening')
    return {'booted_at_proxy': start.isoformat(), 'last_client_observation_at_utc': end.isoformat(),
            'last_client_event': terminal[0]['event'], 'elapsed_seconds_to_client_end': elapsed,
            'client_ended_after_original_hard_cutoff': end > aware(binding['hard_cutoff']),
            'hourly_cny_assumed': 2.18, 'compute_proxy_cny': elapsed * 2.18 / 3600, 'reserve_cny': 5,
            'storage_included': False, 'actual_provider_cost_cny': None,
            'receipt_sha256': sha256(public / 'restore-receipt.json'),
            'receipt_publication': transferred[-1]['event'] if transferred else 'unobserved',
            'server_receipt_consumption': consumed or observations.get('backup-copy-status.json', 'unobserved'),
            'shutdown_request': requests or 'unobserved',
            'shutdown_return': observations.get('shutdown-request.json', 'unobserved'),
            'provider_billing_stopped': 'unconfirmed',
            'scope': 'Client/server observations and cost proxy are not proof of platform power state or its invoice'}


def review(public, prepared, tokenizer, adapters=None, *, metadata_only=False):
    result = verify_complete(public / 'run', public / 'backup-index.json', public / 'restore-receipt.json',
                             prepared, tokenizer, adapters, metadata_only=metadata_only)
    cases = ordered_cases(load_prepared(prepared))
    arms = {}
    for arm in ARMS:
        directory = public / 'run/evaluation' / arm
        episodes = read_jsonl(directory / 'episodes.jsonl')
        details = describe(result['arms'][arm], cases, episodes)
        # Only reuse descriptive case fields; the old partial-window G1 status
        # is deliberately excluded. The complete fixed-T gate comes from audit.
        fields = ('memory_by_factor', 'memory_member_selection_roles', 'identity_pairs',
                  'consent_cases', 'continuation_cases')
        arms[arm] = {'panels': result['arms'][arm]['panels'], 'tokens': result['arms'][arm]['tokens'],
                     **{name: details[name] for name in fields},
                     'autonomous_blocked_writes': {
                         'attempts': sum(e['decision']['autonomous_blocked_writes'] for e in episodes),
                         'case_ids': [e['case_id'] for e in episodes if e['decision']['autonomous_blocked_writes']],
                         'scope': 'Autonomous apply_plan attempts rejected by the environment; not committed mutations'},
                     'timing': timing(read_jsonl(directory / 'generations.jsonl')),
                     'model_load_seconds': read(directory / 'load.json')['seconds'],
                     'policy_failures': dict(Counter(e['policy_failure'] for e in episodes if e['policy_failure']))}
    interactions = {}
    for panel in result['arms']['s0']['panels']:
        score = {arm: result['arms'][arm]['panels'][panel]['correct'] for arm in ARMS}
        interactions[panel] = {'t_effect_without_m': score['t'] - score['s0'],
                               't_effect_with_m': score['tm'] - score['m'],
                               'difference_of_differences': score['tm'] - score['m'] - score['t'] + score['s0'],
                               'scope': 'Descriptive count contrast on repeated cases, not an independent statistical effect estimate'}
    old = ROOT / 'reports/d2-partial-s0-2026-10-02/run/evaluation/s0'
    current = public / 'run/evaluation/s0'
    repeated = compare_repeated_s0(read_jsonl(current / 'episodes.jsonl'), read_jsonl(old / 'episodes.jsonl'))
    outputs = lambda path: [(r['prompt_tokens'], r['output_ids'], r['raw_text']) for r in read_jsonl(path / 'generations.jsonl')]
    repeated['ordered_generation_tokens_and_text_identical'] = outputs(current) == outputs(old)
    return {'version': 'd2-results-review-v1', 'binding': result['binding'], 'model_result': True,
            'episodes_replayed': 320, 'registered_study_cases': 320, 'unrun_cases': 0,
            'adapter_bytes_rechecked_by_this_review': not metadata_only, 'token_ids_verified': True,
            'arms': arms, 'paired': result['paired'], 'descriptive_interactions': interactions,
            'g1': result['g1'], 'historical_s0_repeat': repeated,
            'operations': operational_evidence(public, result['binding']),
            'source_sha256': {'inventory': sha256(public / 'run/backup-inventory.json'),
                              'comparison': sha256(public / 'run/comparison.json'),
                              'receipt': sha256(public / 'restore-receipt.json'),
                              'client_events': sha256(public / 'operations.jsonl'),
                              'server_events': sha256(public / 'server-events.jsonl')},
            'new_model_calls_in_review': 0, 'training_steps': 0, 'test_episodes': 0,
            'scope': 'Fixed representative seed42; repeated development diagnosis. No independent generalization, three-seed D2 result or automatic G1 training.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('public-dir', 'prepared-dir', 'tokenizer-dir'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--adapters-root', type=Path)
    parser.add_argument('--metadata-only', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = review(args.public_dir, args.prepared_dir, args.tokenizer_dir, args.adapters_root, metadata_only=args.metadata_only)
    if args.check:
        expected = read(args.public_dir / 'review.json')
        if args.metadata_only:
            expected['adapter_bytes_rechecked_by_this_review'] = False
        if expected != result:
            raise ValueError('published review differs from independent replay')
    else:
        dump_new(args.public_dir / 'review.json', result)
    print({arm: data['panels'] for arm, data in result['arms'].items()})
    print(result['g1'])
