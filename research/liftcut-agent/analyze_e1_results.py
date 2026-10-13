"""Reconstruct all 48 E1 pairs, terminal failures and measured standalone resources."""
import argparse
from collections import Counter
import csv
import hashlib
from datetime import timedelta
import io
import json
import math
from pathlib import Path
import statistics

from d2_execution import read, aware
from e1_protocol import decide
from e1_execution import verify_plan
from liftcut_agent.benchmark import read_jsonl
from publish_e1_results import publication_integrity, verify_complete
from server_workspace import dump_new


def trajectory_detail(episode, native):
    """Keep observable feedback separate from an interpretation of the root cause."""
    events = episode['trace']['events']; feedback = []
    for e in events:
        o = e.get('observation', {}); result = o.get('result', {})
        if o.get('ok') is False or (isinstance(result, dict) and result.get('valid') is False):
            feedback.append({'event_index': e['index'], 'action': e.get('action'), 'observation': o})
    calls = episode['calls']; score = episode['trace']['score']
    latencies = [c['response']['elapsed_seconds'] for c in calls if c.get('response') is not None]
    return {'score': score, 'policy_failure': episode['policy_failure'],
            'requests': len(calls), 'actual_prompt_tokens': native['tokens']['generated_prompt_tokens'],
            'actual_completion_tokens': native['tokens']['completion_tokens'],
            'actual_model_generations': native['tokens']['actual_model_generations'],
            'context_guards': native['tokens']['local_context_guards'],
            'same_state_counterfactual_raw_prompt_tokens': native['raw_prompt_tokens_at_same_visited_states'],
            'changed_requests': native['changed_requests'], 'unknown_alias_rejections': native['unknown_alias_rejections'],
            'request_wall_seconds_sum': sum(latencies),
            'terminal_action': calls[-1].get('action') if calls else None,
            'action_sequence': [c.get('action') for c in calls],
            'first_observed_invalid_feedback': feedback[0] if feedback else None,
            'all_invalid_feedback': feedback,
            'external_user_events': [e for e in events if e.get('actor') == 'user'],
            'feedback_is_not_automatically_the_root_cause': True}


def describe(result, run):
    pairs = []; arms = {}
    for a in ('A', 'D'):
        r = result['arms'][a]; folder = run / 'evaluation' / a
        episodes = read_jsonl(folder / 'episodes/episodes.jsonl')
        inputs = read_jsonl(folder / 'episodes/inputs.jsonl')
        responses = read_jsonl(folder / 'episodes/responses.jsonl')
        details = {}; offset = 0
        for line, (row, native, episode) in enumerate(zip(r['rows'], r['case_details'], episodes), 1):
            if row['case_id'] != native['case_id'] or row['case_id'] != episode['scenario_id']:
                raise ValueError('E1 row/trajectory order differs')
            d = trajectory_detail(episode, native['native']); end = offset + len(episode['calls'])
            d['evidence'] = {'episode_file': f'run/evaluation/{a}/episodes/episodes.jsonl', 'episode_line_1based': line,
                             'request_file_first_line_1based': offset+1, 'request_file_last_line_1based': end}
            d['request_decisions'] = []
            for n, (inp, response) in enumerate(zip(inputs[offset:end], responses[offset:end]), 1):
                try:
                    body = json.loads(response['native_response']['body'])
                    native_calls = body.get('choices', [{}])[0].get('message', {}).get('tool_calls')
                except (ValueError, TypeError, IndexError):
                    native_calls = None
                d['request_decisions'].append({'request_in_task_1based': n, 'raw_line_1based': offset+n,
                    'native_tool_calls': native_calls, 'environment_action': episode['calls'][n-1].get('action'),
                    'inverse_mapping': response['mapping'],
                    'source_resolution': inp['projection'].get('source_resolution'),
                    'memory_projection_changes': inp['projection']['memory_projection']['changes'],
                    'projected_input_changed': inp['projection']['changed']})
            details[row['case_id']] = d; offset = end
        strata = {factor: {} for factor in ('category', 'bundle')}
        for row in r['rows']:
            for factor in strata:
                v = strata[factor].setdefault(row[factor], {'n': 0, 'passed': 0, 'failed_cases': []})
                v['n'] += 1; v['passed'] += int(row['passed'])
                if not row['passed']:
                    v['failed_cases'].append(row['case_id'])
        finished = read(folder / 'finished.json')
        latencies = sorted(c['response']['elapsed_seconds'] for e in episodes for c in e['calls'] if c.get('response'))
        arms[a] = {'n': len(r['rows']), 'passed': sum(x['passed'] for x in r['rows']), 'strata': strata,
                   'details': details, 'requests': r['requests'], 'actual_model_calls': r['actual_model_calls'],
                   'recorded_prompt_tokens': r['recorded_prompt_tokens'],
                   'recorded_completion_tokens': r['recorded_completion_tokens'],
                   'context_guards': sum(d['context_guards'] for d in details.values()),
                   'same_state_counterfactual_raw_prompt_tokens': sum(d['same_state_counterfactual_raw_prompt_tokens'] for d in details.values()),
                   'counterfactual_is_not_fresh_A_measurement': True,
                   'changed_requests': sum(d['changed_requests'] for d in details.values()),
                   'committed_writes': sum(d['score']['writes'] for d in details.values()),
                   'blocked_write_attempts': sum(x['blocked_write_attempts'] for x in r['rows']),
                   'unexpected_committed_writes': sum(x['unexpected_committed_writes'] for x in r['rows']),
                   'unknown_alias_rejections': sum(x['unknown_alias_rejections'] for x in r['rows']),
                   'inference_wall_seconds': finished['inference_wall_seconds'],
                   'total_wall_seconds_including_load': finished['total_wall_seconds_including_load'],
                   'request_elapsed_seconds': {'n': len(latencies), 'sum': sum(latencies),
                       'median': statistics.median(latencies) if latencies else None,
                       'p95_nearest_rank': latencies[math.ceil(.95 * len(latencies)) - 1] if latencies else None},
                   'ttft_seconds': None, 'failure_issue_counts': dict(Counter(issue for d in details.values() for issue in d['score']['issues']))}
    for left, right in zip(result['arms']['A']['rows'], result['arms']['D']['rows']):
        if left['case_id'] != right['case_id']:
            raise ValueError('fresh A/D pairing differs')
        delta = int(right['passed']) - int(left['passed'])
        pairs.append({'case_id': left['case_id'], 'category': left['category'], 'bundle': left['bundle'],
                      'A_passed': left['passed'], 'D_passed': right['passed'], 'delta': delta,
                      'change': 'gain' if delta > 0 else 'loss' if delta < 0 else 'both_pass' if right['passed'] else 'both_fail'})
    return {'arms': arms, 'pairs': pairs, 'decision': decide({a: result['arms'][a]['rows'] for a in ('A', 'D')},
                complete=True, actual_model_result=True), 'new_training': False,
            'unique_tasks': 48, 'full_task_episodes': 96, 'independent_generalization': False,
            'scope': 'Shared-template combination transfer; prior structural access; full closed-loop tasks, no scripted prefix.'}


def resource_interval(samples, start, end):
    start, end = aware(start), aware(end)
    if start >= end:
        raise ValueError('positive resource interval required')
    metrics = {k: [] for k in ('utilization.gpu', 'utilization.memory', 'memory.used', 'memory.total', 'power.draw')}
    covered = 0.0; measured = 0; probe = 0.0; previous = None
    for i, s in enumerate(samples):
        t = aware(s['at_utc'])
        if previous is not None and t <= previous:
            raise ValueError('GPU observations must be strictly chronological')
        previous = t
        nxt = aware(samples[i+1]['at_utc']) if i+1 < len(samples) else end
        stop = min(nxt, t + timedelta(seconds=5), end)
        seconds = max(0.0, (stop - max(t, start)).total_seconds())
        if seconds == 0 or s['status'] != 'observed':
            continue
        if len(s['gpus']) != 1:
            raise ValueError('E1 expects one observed GPU')
        measured += 1; covered += seconds
        probe += s['probe_wall_seconds']
        for key, rows in metrics.items():
            value = s['gpus'][0][key]
            if value is None:
                continue
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or ('utilization.' in key and value > 100):
                raise ValueError('invalid measured GPU value')
            rows.append((value, seconds))
    duration = (end-start).total_seconds()
    return {'duration_seconds': duration, 'covered_seconds': covered, 'coverage_fraction': covered/duration,
            'overlapping_observed_samples': measured, 'probe_seconds_sum': probe,
            'metrics': {k: {'time_weighted_mean_over_covered_seconds': sum(v*w for v,w in rows)/sum(w for _,w in rows) if rows else None,
                            'known_seconds': sum(w for _,w in rows),
                            'min_observed': min(v for v,_ in rows) if rows else None,
                            'max_observed': max(v for v,_ in rows) if rows else None} for k,rows in metrics.items()},
            'missing_is_unknown_not_idle': True, 'max_hold_seconds': 5, 'max_is_observed_not_true_peak': True,
            'whole_card_metrics_not_model_exclusive': True}


def resource_review(public, binding, end):
    rows = read_jsonl(public / 'resources/server-stream.jsonl')
    headers = [r for r in rows if r['kind'] == 'verified_read_only_observer']
    if len(headers) != 1 or headers[0]['binding'] != binding:
        raise ValueError('read-only resource observer binding differs')
    header = headers[0]; launch = read(public / 'launch.json'); guard = read(public / 'guard.json')
    local = read_jsonl(public / 'resources/local-events.jsonl')
    dispatched = [e for e in local if e['event'] == 'read_only_observer_dispatched']
    # The local source file uses Windows newlines; decoded text is the exact LF
    # string sent to remote stdin. The manifest also preserves original file bytes.
    source = (public / 'resources/remote-read-only-source.py').read_text(encoding='utf-8')
    if (header['guard'] != guard or header['controller_pid'] != launch['controller_pid']
            or header['gpu_sample_source_sha256'] != verify_plan()['source_sha256']['gpu_telemetry.py']
            or len(dispatched) != 1
            or hashlib.sha256(source.encode()).hexdigest() != dispatched[0]['remote_source_sha256']):
        raise ValueError('resource probe source/controller/guard differs')
    samples = [r for r in rows if r['kind'] == 'actual_nvidia_smi_observation']
    intervals = {'observed_rental': resource_interval(samples, binding['booted_at_proxy'], end)}
    events = read_jsonl(public / 'run/events.jsonl')
    for arm in ('A', 'D'):
        phases = [r for r in events if r.get('event') == 'phase_started' and r.get('phase') == 'evaluate-' + arm]
        if len(phases) != 1:
            raise ValueError('actual phase timing missing')
        finish = read(public / 'run/evaluation' / arm / 'finished.json')
        intervals['evaluate-' + arm] = resource_interval(samples, phases[0]['at_utc'], finish['at_utc'])
    snapshots = [r for r in rows if r['kind'] == 'read_only_power_snapshot']
    for s in snapshots:
        if hashlib.sha256(s['text'].encode()).hexdigest() != s['sha256']:
            raise ValueError('captured power snapshot hash differs')
    return {'sample_count': len(samples), 'intervals': intervals,
            'first_sample_utc': samples[0]['at_utc'] if samples else None,
            'last_sample_utc': samples[-1]['at_utc'] if samples else None,
            'observed_power_files': snapshots, 'no_remote_write_or_model_call': True,
            'collector_and_power_observer_are_distinct': True}


def review(public, tokenizer):
    manifest = publication_integrity(public)
    actual = verify_complete(public / 'run', public / 'backup-index.json', public / 'restore-receipt.json',
                             tokenizer, metadata_only=True)
    report = describe(actual, public / 'run'); b = actual['binding']; handoff = manifest['handoff']
    local = read_jsonl(public / 'resources/local-events.jsonl')
    disconnections = [e for e in local if e['event'] == 'transport_inactive'
                     or (e['event'] == 'channel_ended' and e.get('transport_active') is False)]
    end = disconnections[0]['at_utc'] if disconnections else handoff['collector_finished_at_utc']
    seconds = (aware(end) - aware(b['booted_at_proxy'])).total_seconds()
    evaluation = sum(a['total_wall_seconds_including_load'] for a in report['arms'].values())
    report.update(version='e1-review-v1', model_result=True, binding=b, handoff=handoff,
                  this_review_reloads_private_parent_weight=False,
                  actual_parent_weight_verified_at_publication=True, archive_is_self_contained=False,
                  resources=resource_review(public, b, end),
                  observer_disconnect_event=disconnections[0] if disconnections else None,
                  cost={'hourly_cny': b['authorization']['hourly_cny'], 'original_opening': b['booted_at_proxy'],
                        'observed_end': end, 'end_evidence': 'observer_disconnect' if disconnections else 'collector_finished',
                        'rental_seconds_proxy': seconds,
                        'rental_cny_proxy': seconds/3600*b['authorization']['hourly_cny'],
                        'evaluation_process_seconds_including_load': evaluation,
                        'evaluation_process_wall_fraction': evaluation/seconds,
                        'process_wall_fraction_is_not_gpu_utilization': True,
                        'reserve_cny': b['authorization']['reserve_cny'], 'not_provider_invoice': True,
                        'subwindows_are_included_do_not_add': True, 'platform_billing_end_unknown': True})
    return report


def pairs_csv(report):
    f = io.StringIO(newline=''); fields = ('case_id', 'category', 'bundle', 'A_passed', 'D_passed', 'delta', 'change')
    w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n'); w.writeheader(); w.writerows(report['pairs'])
    return f.getvalue()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--public-dir', type=Path, required=True); p.add_argument('--tokenizer-dir', type=Path, required=True)
    p.add_argument('--check', action='store_true'); a = p.parse_args(); r = review(a.public_dir, a.tokenizer_dir)
    if a.check:
        if read(a.public_dir / 'review.json') != r or (a.public_dir / 'paired-cases.csv').read_text(encoding='utf-8') != pairs_csv(r):
            raise ValueError('E1 analysis differs')
    else:
        dump_new(a.public_dir / 'review.json', r)
        (a.public_dir / 'paired-cases.csv').write_text(pairs_csv(r), encoding='utf-8', newline='\n')
    print({'passed': r['decision']['passed'], 'candidate_passed': r['decision']['candidate_passed'],
           'rental_cny_proxy': r['cost']['rental_cny_proxy']})
