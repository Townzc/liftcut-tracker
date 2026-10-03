"""Reconstruct G2 paired gains, regressions, repair behavior and operating evidence."""
import argparse
from collections import Counter
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))
from analyze_g1_results import training_description, d2_case_details
from analyze_g1_contexts import normal_pairs as frozen_normal_pairs

from analyze_d2_results import timing
from counterfactual_diagnostics import load_prepared
from d2_execution import aware, ordered_cases, read
from liftcut_agent.benchmark import read_jsonl
from prepare_g2 import ARMS, BUDGET
from publish_g2_results import WEIGHTS, inventory, verify_complete
from server_workspace import dump_new, sha256


def publication_integrity(public):
    record = read(public / 'publication.json')
    if (record['version'] != 'g2-publication-v1' or record['episodes_replayed'] != 222
            or record['new_receipts_created'] != 0 or record['new_model_calls'] != 0
            or not record['actual_weights_checked_before_publication']):
        raise ValueError('publication is not a complete actual G2 record')
    for name, checksum in record['public_files_sha256'].items():
        path = public / name
        if not path.resolve().is_relative_to(public.resolve()) or path.is_symlink() or sha256(path) != checksum:
            raise ValueError('public evidence differs from copied original bytes')
    files, inventories = inventory(public / 'run')
    required = {'run/' + n for n in (set(files) - WEIGHTS) | inventories}
    required |= {'backup-index.json', 'restore-receipt.json', 'operations.jsonl', 'server-events.jsonl'}
    if set(record['public_files_sha256']) != required:
        raise ValueError('publication provenance must cover all original public files')
    if (record['omitted_weight_files'] != {n: files[n] for n in sorted(WEIGHTS)}
            or record['original_receipt_sha256'] != sha256(public / 'restore-receipt.json')
            or record['binding'] != read(public / 'backup-index.json')['binding']):
        raise ValueError('original receipt/weight inventory binding differs')


def normal_pairs(before, after):
    if len(before) != 12 or len(after) != 12:
        raise ValueError('all twelve ordered full tasks required')
    result = frozen_normal_pairs(before, after)
    result['arms'] = dict(zip(ARMS, (result['arms']['control'], result['arms']['repair'])))
    result['counts'] = dict(zip(ARMS, (result['counts']['control'], result['counts']['repair'])))
    for row in result['paired']:
        row['first_different_repair_only_action'] = row.pop('first_different_control_action')
        row['first_different_coverage_mix_action'] = row.pop('first_different_repair_action')
    return result


def compare_repeat(previous, current, panel):
    expected = {'normal': 12, 'diagnostic': 19, 'd2': 80}[panel]
    key = 'scenario_id' if panel == 'normal' else 'case_id'
    ids = [e[key] for e in previous]
    if len(ids) != expected or len(set(ids)) != expected or ids != [e[key] for e in current]:
        raise ValueError('complete ordered historical-repeat cases required')
    def outcome(e):
        return e['trace']['score'] if panel == 'normal' else e['decision']
    def correct(e):
        return outcome(e)['passed' if panel == 'normal' else 'correct']
    return {'cases': expected,
        'changed_outcome_cases': [a[key] for a, b in zip(previous, current) if outcome(a) != outcome(b)],
        'gained': [a[key] for a, b in zip(previous, current) if not correct(a) and correct(b)],
        'lost': [a[key] for a, b in zip(previous, current) if correct(a) and not correct(b)]}


def historical_repeat(public):
    previous = ROOT / 'reports/g1-seed42-2026-10-02/run'
    current = public / 'run'
    panels = {}
    for panel in ('normal', 'diagnostic', 'd2'):
        old, new = previous / 'evaluation/repair' / panel, current / 'evaluation/repair_only' / panel
        panels[panel] = compare_repeat(read_jsonl(old / 'episodes.jsonl'), read_jsonl(new / 'episodes.jsonl'), panel)
        def generations(directory):
            keys = ('model_called', 'prompt_tokens', 'output_ids', 'raw_text', 'parse_error', 'eos_reached')
            return [tuple(row.get(k) for k in keys) for row in read_jsonl(directory / 'generations.jsonl')]
        panels[panel]['ordered_generation_tokens_and_text_identical'] = generations(old) == generations(new)
    old_weights = read(previous / 'training/repair/report.json')['adapter_sha256']
    new_weights = read(current / 'training/repair_only/report.json')['adapter_sha256']
    return {'panels': panels, 'adapter_weight_sha256_identical':
            old_weights['adapter_model.safetensors'] == new_weights['adapter_model.safetensors'],
            'scope': 'Fresh seed42 repair-only repeat of G1; neither an additional seed nor a replacement for the current paired control.'}


def operational_evidence(public, binding):
    rows = read_jsonl(public / 'operations.jsonl')
    terminal = [r for r in rows if r['event'] in {'launcher_or_collector_stopped', 'monitor_finished', 'monitor_stopped'}]
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
    server = read_jsonl(public / 'server-events.jsonl', allow_empty=True)
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
            'hourly_cny_assumed': 2.18, 'compute_proxy_cny': elapsed * 2.18 / 3600, 'reserve_cny': BUDGET['reserve_cny'],
            'storage_included': False, 'actual_provider_cost_cny': None,
            'receipt_sha256': sha256(public / 'restore-receipt.json'),
            'receipt_publication': transferred[-1]['event'] if transferred else 'unobserved',
            'server_receipt_consumption': consumed or observations.get('backup-copy-status.json', 'unobserved'),
            'shutdown_request': requests or 'unobserved',
            'shutdown_return': observations.get('shutdown-request.json', 'unobserved'),
            'provider_billing_stopped': 'unconfirmed',
            'scope': 'Client/server observations and cost proxy are not proof of platform power state or its invoice'}



def review(public, prepared, diagnostic, d2, tokenizer, *, restored_run=None):
    publication_integrity(public)
    result = verify_complete(public / 'run', public / 'backup-index.json', public / 'restore-receipt.json',
                             prepared, diagnostic, d2, tokenizer, metadata_only=True)
    actual_weights = restored_run is not None
    if actual_weights:
        full = verify_complete(restored_run, public / 'backup-index.json', public / 'restore-receipt.json',
                               prepared, diagnostic, d2, tokenizer)
        if full != read(public / 'run/comparison.json'):
            raise ValueError('external actual-weight audit differs from public frozen comparison')
    cases = ordered_cases(load_prepared(d2))
    arms = {}
    for arm in ARMS:
        directory = public / 'run/evaluation' / arm
        episodes = read_jsonl(directory / 'd2/episodes.jsonl')
        details = d2_case_details(cases, episodes)
        per_panel = {}
        for panel in ('normal', 'diagnostic', 'd2'):
            panel_episodes = read_jsonl(directory / panel / 'episodes.jsonl')
            per_panel[panel] = {'tokens': result['arms'][arm][panel]['tokens'],
                                'timing': timing(read_jsonl(directory / panel / 'generations.jsonl')),
                                'policy_failures': dict(Counter(e['policy_failure'] for e in panel_episodes if e['policy_failure']))}
        arms[arm] = {'panels': result['arms'][arm]['d2']['report']['panels'],
                     'normal': result['arms'][arm]['normal']['report'],
                     'diagnostic': result['arms'][arm]['diagnostic']['report'],
                     **details, 'evaluation_resources': per_panel,
                     'training': training_description(public / 'run/training' / arm),
                     'autonomous_blocked_writes': result['gates']['protections'][arm]['blocked_writes']}
    # Reuse observation interpretation only; G2's frozen reserve is CNY8.
    operations = operational_evidence(public, result['binding'])
    operations['reserve_cny'] = BUDGET['reserve_cny']
    # G2 names an observed pre-existing final receipt differently from D2.
    observed = [r for r in read_jsonl(public / 'operations.jsonl') if r['event'] == 'receipt_final_observed']
    for row in observed:
        if row['receipt_sha256'] != sha256(public / 'restore-receipt.json'):
            raise ValueError('observed final receipt hash differs')
    if observed and operations['receipt_publication'] == 'unobserved':
        operations['receipt_publication'] = 'receipt_final_observed'
    normal = normal_pairs(*(read_jsonl(public / 'run/evaluation' / arm / 'normal/episodes.jsonl') for arm in ARMS))
    for arm in ARMS:
        actual_flags = [e['scenario_id'] for e in normal['arms'][arm]
                        if e['false_infeasible'] and e['infeasible_without_validation']]
        if actual_flags != result['gates']['behavior_case_ids'][arm]:
            raise ValueError('normal failure chain differs from prespecified G2 behavior gate')
    return {'version': 'g2-results-review-v1', 'binding': result['binding'], 'model_result': True,
            'episodes_replayed': 222, 'unrun_cases': 0, 'actual_weights_rechecked_by_this_review': actual_weights,
            'token_ids_verified': True, 'arms': arms, 'gates': result['gates'],
            'matched_initial_adapter_sha256': result['initial_adapter_sha256'], 'operations': operations,
            'normal_behavior': normal, 'historical_repair_repeat': historical_repeat(public),
            'source_sha256': {'publication': sha256(public / 'publication.json'),
                              'comparison': sha256(public / 'run/comparison.json')},
            'new_model_calls_in_review': 0, 'test_episodes': 0, 'additional_seeds_authorized': False,
            'scope': 'Fixed seed42 paired pilot on reused development cases; no independent generalization or three-seed G2 claim'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('public-dir', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--restored-run', type=Path)
    p.add_argument('--check', action='store_true')
    a = p.parse_args()
    result = review(a.public_dir, a.prepared_dir, a.diagnostic_dir, a.d2_dir, a.tokenizer_dir, restored_run=a.restored_run)
    if a.check:
        expected = read(a.public_dir / 'review.json')
        expected['actual_weights_rechecked_by_this_review'] = a.restored_run is not None
        if result != expected:
            raise ValueError('published G2 review differs from independent reconstruction')
    else:
        dump_new(a.public_dir / 'review.json', result)
    print(result['gates']['mechanism_checks'])
    print({'mechanism_passed': result['gates']['mechanism_passed'], 'candidate_passed': result['gates']['candidate_passed']})
    print(result['operations'])
