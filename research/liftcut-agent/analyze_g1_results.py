"""Reconstruct G1 paired gains, regressions, repair behavior and operating evidence."""
import argparse
from collections import Counter
from pathlib import Path
from statistics import mean

from analyze_d2_partial import describe
from analyze_d2_results import operational_evidence, timing
from counterfactual_diagnostics import load_prepared
from d2_execution import ordered_cases, read
from liftcut_agent.benchmark import read_jsonl
from prepare_g1 import ARMS, BUDGET
from publish_g1_results import WEIGHTS, inventory, verify_complete
from server_workspace import dump_new, sha256


def publication_integrity(public):
    record = read(public / 'publication.json')
    if (record['version'] != 'g1-publication-v1' or record['episodes_replayed'] != 222
            or record['new_receipts_created'] != 0 or record['new_model_calls'] != 0
            or not record['actual_weights_checked_before_publication']):
        raise ValueError('publication is not a complete actual G1 record')
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


def training_description(directory):
    report = read(directory / 'report.json')
    logs = read_jsonl(directory / 'training.jsonl')
    def weighted(rows):
        prev, numerator, denominator = 0, 0., 0
        for row in rows:
            count = row['supervised_tokens'] - prev
            numerator += count * row['loss']
            denominator += count
            prev = row['supervised_tokens']
        return numerator / denominator
    return {'optimizer_steps': report['steps'], 'processed': report['processed'],
            'optimization_seconds': report['optimization_seconds'],
            'supervised_tokens_per_second': report['processed']['supervised_tokens'] / report['optimization_seconds'],
            'target_weighted_mean_loss': weighted(logs),
            'first_10_step_mean_loss': mean(r['loss'] for r in logs[:10]),
            'last_10_step_mean_loss': mean(r['loss'] for r in logs[-10:]),
            'step_curve': [{'step': r['step'], 'loss': r['loss'], 'elapsed_seconds': r['elapsed_seconds']} for r in logs],
            'peak_allocated_bytes': report['peak_allocated_bytes'], 'peak_reserved_bytes': report['peak_reserved_bytes'],
            'longest_example_probe': read(directory / 'memory-probe.json'),
            'reload_max_logit_difference': report['reload_max_logit_difference'],
            'scope': 'Different conditioning contexts; training loss alone is not evidence of better repair'}


def d2_case_details(cases, episodes):
    if len(cases) != 80 or [c['id'] for c in cases] != [e['case_id'] for e in episodes]:
        raise ValueError('all ordered D2 cases are required')
    detailed = {'case_results': [{'case_id': e['case_id'], 'panel': c['panel'], 'factors': c['factors'],
        'policy_failure': e['policy_failure'],
        'interface_errors': [x for x in e['trace']['score']['tool_errors'] if x in {'invalid_arguments', 'unknown_tool'}],
        **e['decision']} for c, e in zip(cases, episodes)]}
    details = describe(detailed, cases, episodes)
    keys = ('memory_by_factor', 'memory_member_selection_roles', 'identity_pairs', 'consent_cases', 'continuation_cases')
    return {key: details[key] for key in keys}


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
    # Reuse observation interpretation only; G1's frozen reserve is CNY8.
    operations = operational_evidence(public, result['binding'])
    operations['reserve_cny'] = BUDGET['reserve_cny']
    # G1 names an observed pre-existing final receipt differently from D2.
    observed = [r for r in read_jsonl(public / 'operations.jsonl') if r['event'] == 'receipt_final_observed']
    for row in observed:
        if row['receipt_sha256'] != sha256(public / 'restore-receipt.json'):
            raise ValueError('observed final receipt hash differs')
    if observed and operations['receipt_publication'] == 'unobserved':
        operations['receipt_publication'] = 'receipt_final_observed'
    return {'version': 'g1-results-review-v1', 'binding': result['binding'], 'model_result': True,
            'episodes_replayed': 222, 'unrun_cases': 0, 'actual_weights_rechecked_by_this_review': actual_weights,
            'token_ids_verified': True, 'arms': arms, 'gates': result['gates'],
            'matched_initial_adapter_sha256': result['initial_adapter_sha256'], 'operations': operations,
            'source_sha256': {'publication': sha256(public / 'publication.json'),
                              'comparison': sha256(public / 'run/comparison.json')},
            'new_model_calls_in_review': 0, 'test_episodes': 0, 'additional_seeds_authorized': False,
            'scope': 'Fixed seed42 paired pilot on reused development cases; no independent generalization or three-seed G1 claim'}


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
            raise ValueError('published G1 review differs from independent reconstruction')
    else:
        dump_new(a.public_dir / 'review.json', result)
    print(result['gates']['pilot_checks'])
    print(result['operations'])
