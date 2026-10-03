"""Post-hoc G2 stopping/repair boundary audit; no inference or changed scoring."""
import argparse
from collections import Counter
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))
from analyze_g1_contexts import canonical, episode_chain
from analyze_g2_results import publication_integrity
from d2_execution import read
from liftcut_agent.benchmark import read_jsonl
from prepare_g2 import ARMS, coverage, schedules
from server_workspace import dump_new, sha256


def continuation_chain(episode):
    events = [e for e in episode['trace']['events'] if e['actor'] == 'agent']
    prefix = episode['scripted_prefix_calls']
    if not isinstance(prefix, int) or isinstance(prefix, bool) or not 0 <= prefix <= len(events):
        raise ValueError('invalid scripted prefix length')
    autonomous = events[prefix:]
    if len(autonomous) != episode['decision']['autonomous_actions']:
        raise ValueError('autonomous action count differs from frozen evaluation')
    invalid = Counter()
    issues = Counter()
    tools = []
    for event in autonomous:
        action, result = event['action'], event['observation'].get('result', {})
        tools.append(action['tool'])
        if action['tool'] == 'validate_plan' and result.get('valid') is False:
            invalid[canonical(action)] += 1
            issues.update(result['issues'])
    return {'case_id': episode['case_id'], 'correct': episode['decision']['correct'],
            'scripted_prefix_excluded': prefix, 'autonomous_tools': tools,
            'invalid_validation_attempts': sum(invalid.values()),
            'maximum_repeats_of_same_invalid_validation': max(invalid.values(), default=0),
            'validation_issue_counts': dict(issues), 'stop_reason': episode['stop_reason'],
            'policy_failure': episode['policy_failure'],
            'terminal_outcome': episode['trace']['score']['outcome']}


def analyze(public, prepared):
    publication_integrity(public)
    execution = ROOT / 'reports/g2-execution-v1.json'
    plan = read(execution)
    for name, checksum in plan['preparation']['files'].items():
        if sha256(prepared / name) != checksum:
            raise ValueError('training file differs from frozen preparation')
    schedule, _, decisions = schedules(prepared)
    observed = {a: coverage(schedule[a], decisions) for a in ARMS}
    if observed != plan['preparation']['coverage']:
        raise ValueError('actual scheduled state coverage differs from frozen design')
    arms = {}
    for arm in ARMS:
        folder = public / 'run/evaluation' / arm
        normal = [episode_chain(e) for e in read_jsonl(folder / 'normal/episodes.jsonl')]
        d2 = read_jsonl(folder / 'd2/episodes.jsonl')
        boundary = [continuation_chain(e) for e in d2
                    if e['case_id'].startswith(('d2-repair-', 'd2-infeasible-'))]
        if len(boundary) != 8 or len({r['case_id'] for r in boundary}) != 8:
            raise ValueError('all eight repair and infeasible cases required')
        generations = [r for panel in ('normal', 'diagnostic', 'd2')
                       for r in read_jsonl(folder / panel / 'generations.jsonl')]
        arms[arm] = {'scheduled_state_targets': observed[arm]['state_targets'],
            'continuation_cases': boundary,
            'normal_failures': [{k: e[k] for k in ('scenario_id', 'outcome', 'validation_attempts',
                'maximum_repeats_of_same_invalid_validation', 'local_refusals', 'policy_failure')}
                for e in normal if not e['passed']],
            'actual_model_generations': sum(r['model_called'] for r in generations),
            'local_non_generation_records': sum(not r['model_called'] for r in generations)}
    return {'version': 'g2-posthoc-boundary-audit-v1', 'arms': arms,
        'source_sha256': {'publication': sha256(public / 'publication.json'),
                          'execution': sha256(execution)},
        'new_model_calls': 0, 'new_training': False, 'test_episodes': 0,
        'scope': 'Post-hoc training coverage and observed failure chains. No changed G2 gates, causal proof, or independent evaluation.'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--public-dir', required=True, type=Path)
    p.add_argument('--prepared-dir', required=True, type=Path)
    p.add_argument('--check', action='store_true')
    a = p.parse_args()
    result = analyze(a.public_dir, a.prepared_dir)
    target = a.public_dir / 'boundary-review.json'
    if a.check:
        if result != read(target):
            raise ValueError('boundary review differs from original evidence')
    else:
        dump_new(target, result)
    print({arm: {'state_targets': r['scheduled_state_targets'],
        'model_generations': r['actual_model_generations'],
        'local_guards': r['local_non_generation_records']} for arm, r in result['arms'].items()})
