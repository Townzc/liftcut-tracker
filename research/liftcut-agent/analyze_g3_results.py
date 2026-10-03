"""Reconstruct G3 results against the explicit historical G2 control, without inference calls."""
import argparse
from collections import Counter
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))

from analyze_d2_results import timing
from analyze_g1_contexts import normal_pairs as frozen_normal_pairs
from analyze_g1_results import training_description, d2_case_details
from analyze_g2_results import operational_evidence
from audit_g3 import G2_EVALUATION
from counterfactual_diagnostics import load_prepared
from d2_execution import ordered_cases, read
from liftcut_agent.benchmark import read_jsonl
from prepare_g3 import ARMS, BUDGET, published_maps
from publish_g3_results import publication_integrity, verify_complete
from server_workspace import dump_new, sha256

PANELS = {'normal': 12, 'diagnostic': 19, 'd2': 80}


def case_comparison(before, after, panel):
    """Keep all111 cases, including the diagnostic memory negative control outside gate panels."""
    if panel not in PANELS:
        raise ValueError('unknown G3 panel')
    key = 'scenario_id' if panel == 'normal' else 'case_id'
    ids = [e[key] for e in before]
    if (len(ids) != PANELS[panel] or len(set(ids)) != len(ids)
            or ids != [e[key] for e in after]):
        raise ValueError('complete unique ordered historical-control cases required')
    def correct(e):
        return e['trace']['score']['passed'] if panel == 'normal' else e['decision']['correct']
    def actions(e):
        agent = [x['action'] for x in e['trace']['events'] if x['actor'] == 'agent']
        return agent if panel == 'normal' else agent[e['scripted_prefix_calls']:]
    rows = []
    for a, b in zip(before, after):
        aa, bb = actions(a), actions(b)
        prefix = next((i for i in range(min(len(aa), len(bb))) if aa[i] != bb[i]), min(len(aa), len(bb)))
        rows.append({'panel': panel, 'case_id': a[key], 'before_correct': correct(a),
                     'after_correct': correct(b), 'gained': not correct(a) and correct(b),
                     'lost': correct(a) and not correct(b), 'common_action_prefix_length': prefix,
                     'first_different_historical_control_action': aa[prefix] if prefix < len(aa) else None,
                     'first_different_candidate_action': bb[prefix] if prefix < len(bb) else None,
                     'before_policy_failure': a['policy_failure'], 'after_policy_failure': b['policy_failure']})
    return rows


def normal_comparison(before, after, arm):
    if arm not in ARMS or len(before) != 12 or len(after) != 12:
        raise ValueError('named G3 arm and all twelve full tasks required')
    result = frozen_normal_pairs(before, after)
    for key in ('arms', 'counts'):
        result[key] = {'g2_coverage_mix_historical': result[key]['control'], arm: result[key]['repair']}
    for row in result['paired']:
        row['first_different_historical_control_action'] = row.pop('first_different_control_action')
        row['first_different_candidate_action'] = row.pop('first_different_repair_action')
    return result


def control_scope(control):
    return {'evaluation_source': 'reports/g2-seed42-2026-10-03/run/evaluation/coverage_mix',
            'retrained_in_this_window': False, 'shared_prefix': control['reproduction'],
            'frozen_audit_paired_claim_allowed': control['paired_claim_allowed'],
            'interpretation': 'Historical G2 control reused. Matching initialization and first12 steps '
                              'only establish shared-prefix consistency; no complete fresh control rerun.',
            'independent_generalization': False}


def overnight_observations(public):
    """Keep the old controller's unobserved ACK distinct from the new consumer."""
    rows = read_jsonl(public / 'operations.jsonl')
    armed = [r for r in rows if r['event'] == 'new_user_overnight_lease_armed']
    if not armed:
        return None
    install = read(public / 'overnight-lease-install.json')
    handoff = read(public / 'overnight-handoff.json')
    repair = read(public / 'inspected-handoff-repair.json')
    consumed = read(public / 'overnight-receipt-consumption.json')
    observed = [r for r in rows if r['event'] == 'real_receipt_consumed_by_overnight_handoff']
    if (len(armed) != 1 or len(observed) != 1 or repair['result'] != handoff
            or handoff['index'] != read(public / 'backup-index.json')
            or handoff['replacement_guard'] != install['guard']
            or consumed['receipt_sha256'] != sha256(public / 'restore-receipt.json')
            or consumed['receipt'] != read(public / 'restore-receipt.json')
            or any(observed[0].get(k) != v for k, v in consumed.items())
            or consumed['original_controller_consumption'] != 'unobserved'
            or consumed['new_receipts_created'] != 0 or handoff['training_conditions_changed']):
        raise ValueError('overnight handoff or genuine receipt consumption differs')
    return {'authorization': install['lease']['authorization'],
            'deadline_utc': install['lease']['deadline'],
            'cumulative_reserve_cny': install['lease']['reserve_cny'],
            'maximum_compute_proxy_cny_including_prior_failure': install['guard']['maximum_compute_proxy_cny'],
            'old_controller_receipt_consumption': 'unobserved',
            'independent_consumer': consumed,
            'handoff_completed_at_utc': handoff['at_utc'],
            'old_watcher_failure': 'original power guard incorrectly treated as a training worker; inspected repair',
            'g3_conditions_changed': False, 'shutdown_deferred_by_new_user_authorization': True,
            'provider_billing_stopped': False,
            'cost_scope': 'G3 client-end cost is cumulative elapsed compute to collection, not final overnight cost.'}


def review(public, prepared, diagnostic, d2, tokenizer, *, restored_run=None):
    publication_integrity(public)
    result = verify_complete(public / 'run', public / 'backup-index.json', public / 'restore-receipt.json',
                             prepared, diagnostic, d2, tokenizer, metadata_only=True)
    if restored_run is not None:
        full = verify_complete(restored_run, public / 'backup-index.json', public / 'restore-receipt.json',
                               prepared, diagnostic, d2, tokenizer)
        if full != read(public / 'run/comparison.json'):
            raise ValueError('actual weights differ from public frozen comparison')
    cases = ordered_cases(load_prepared(d2))
    historical = {p: read_jsonl(G2_EVALUATION / p / 'episodes.jsonl') for p in PANELS}
    arms = {}
    for arm in ARMS:
        directory = public / 'run/evaluation' / arm
        episodes = {p: read_jsonl(directory / p / 'episodes.jsonl') for p in PANELS}
        changes = [row for p in PANELS for row in case_comparison(historical[p], episodes[p], p)]
        maps, false_stops, blocked = published_maps(directory)
        if false_stops != result['gates'][arm]['false_infeasible_stops']:
            raise ValueError('false-stop interpretation differs from frozen audit')
        resources = {p: {'tokens': result['arms'][arm][p]['tokens'],
                         'timing': timing(read_jsonl(directory / p / 'generations.jsonl')),
                         'policy_failures': dict(Counter(e['policy_failure'] for e in episodes[p] if e['policy_failure']))}
                     for p in PANELS}
        arms[arm] = {'panels': result['arms'][arm]['d2']['report']['panels'],
                     'normal': result['arms'][arm]['normal']['report'],
                     'diagnostic': result['arms'][arm]['diagnostic']['report'],
                     **d2_case_details(cases, episodes['d2']),
                     'evaluation_resources': resources,
                     'training': training_description(public / 'run/training' / arm),
                     'autonomous_blocked_writes': blocked,
                     'false_infeasible_stops': false_stops,
                     'all_case_comparisons': changes,
                     'all111_summary': {'before_correct': sum(r['before_correct'] for r in changes),
                                        'after_correct': sum(r['after_correct'] for r in changes),
                                        'gained': [r['case_id'] for r in changes if r['gained']],
                                        'lost': [r['case_id'] for r in changes if r['lost']]},
                     'normal_behavior': normal_comparison(historical['normal'], episodes['normal'], arm),
                     'gate_panel_cases': sum(len(m) for m in maps.values())}
    operations = operational_evidence(public, result['binding'])
    operations['reserve_cny'] = BUDGET['reserve_cny']
    operations['overnight_power_lease'] = overnight_observations(public)
    observed = [r for r in read_jsonl(public / 'operations.jsonl') if r['event'] == 'receipt_final_observed']
    for row in observed:
        if row['receipt_sha256'] != sha256(public / 'restore-receipt.json'):
            raise ValueError('observed final receipt hash differs')
    if observed and operations['receipt_publication'] == 'unobserved':
        operations['receipt_publication'] = 'receipt_final_observed'
    return {'version': 'g3-results-review-v1', 'binding': result['binding'], 'model_result': True,
            'episodes_replayed': 222, 'unrun_cases': 0, 'actual_weights_rechecked_by_this_review': restored_run is not None,
            'token_ids_verified': True, 'arms': arms, 'gates': result['gates'],
            'carried_forward': result['carried_forward'], 'control': control_scope(result['control']),
            'matched_initial_adapter_sha256': result['initial_adapter_sha256'], 'operations': operations,
            'source_sha256': {'publication': sha256(public / 'publication.json'),
                              'comparison': sha256(public / 'run/comparison.json'),
                              'historical_g2_episodes': {p: sha256(G2_EVALUATION / p / 'episodes.jsonl') for p in PANELS}},
            'new_model_calls_in_review': 0, 'test_episodes': 0, 'additional_seeds_authorized': False,
            'scope': 'Two new seed42 arms on111 reused development cases vs historical G2; '
                     'gate panels cover110 cases, full paired rows retain the extra diagnostic control; '
                     'no independent generalization, fresh complete control rerun or extra seeds.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('public-dir', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--restored-run', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = review(args.public_dir, args.prepared_dir, args.diagnostic_dir, args.d2_dir,
                    args.tokenizer_dir, restored_run=args.restored_run)
    if args.check:
        expected = read(args.public_dir / 'review.json')
        expected['actual_weights_rechecked_by_this_review'] = args.restored_run is not None
        if result != expected:
            raise ValueError('published G3 review differs from independent reconstruction')
    else:
        dump_new(args.public_dir / 'review.json', result)
    print({a: {k: result['gates'][a][k] for k in ('mechanism_passed', 'candidate_passed')} for a in ARMS})
    print(result['operations'])
