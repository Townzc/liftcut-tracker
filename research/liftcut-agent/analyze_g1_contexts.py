"""Post-hoc G1 conditioning coverage and full-task failure chains; no inference."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))
from liftcut_agent.benchmark import read_jsonl
from analyze_g1_results import publication_integrity
from server_workspace import dump_new, sha256


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def decision_context(row):
    messages = row['messages']
    if row['split'] != 'train' or row['assistant_target_index'] != len(messages) - 1:
        raise ValueError('only final-assistant training targets may enter this audit')
    target = messages[-1]
    if target['role'] != 'assistant' or len(target.get('tool_calls', [])) != 1:
        raise ValueError('one target call required')
    function = target['tool_calls'][0]['function']
    arguments = function['arguments']
    if isinstance(arguments, str):
        arguments = json.loads(arguments)
    label = {'tool': function['name'], 'arguments': arguments}
    calls, responses = {}, []
    for message in messages[:-1]:
        for call in message.get('tool_calls', []):
            if call['id'] in calls:
                raise ValueError('duplicate tool call identity')
            calls[call['id']] = call['function']['name']
        if message['role'] == 'tool':
            if message['tool_call_id'] not in calls:
                raise ValueError('unbound tool response')
            responses.append((calls[message['tool_call_id']], json.loads(message['content'])))
    last_tool, last_result = responses[-1] if responses else (None, {})
    prior_validations = sum(name == 'validate_plan' for name, _ in responses)
    if last_tool == 'search_exercises' and prior_validations == 0:
        state = 'clean_search_before_any_validation'
    elif last_tool == 'validate_plan' and last_result.get('result', {}).get('valid') is False:
        state = 'immediately_after_invalid_validation'
    else:
        state = 'other'
    return {'target': label, 'state': state, 'last_tool': last_tool,
            'prior_validations': prior_validations}


def paired_contexts(control, repair):
    ids = [r['pair_id'] for r in control]
    if len(ids) != len(set(ids)) or ids != [r['pair_id'] for r in repair]:
        raise ValueError('unique ordered pairs required')
    summaries = {arm: defaultdict(Counter) for arm in ('control', 'repair')}
    transitions, moved, scenarios = Counter(), [], set()
    for before, after in zip(control, repair):
        if any(before[k] != after[k] for k in ('scenario_id', 'family_id', 'category')):
            raise ValueError('paired training identities differ')
        a, b = decision_context(before), decision_context(after)
        if a['target'] != b['target']:
            raise ValueError('paired correct target differs')
        scenarios.add(before['scenario_id'])
        target = a['target']['tool']
        if target == 'finish':
            target += ':' + a['target']['arguments']['outcome']
        for arm, detail in (('control', a), ('repair', b)):
            summaries[arm][detail['state']][target] += 1
        transitions[a['state'] + ' -> ' + b['state']] += 1
        if a['state'] != b['state']:
            moved.append({'pair_id': before['pair_id'], 'scenario_id': before['scenario_id'],
                          'category': before['category'], 'target': target,
                          'before': a['state'], 'after': b['state']})
    return {'paired_targets': len(ids), 'training_scenarios': len(scenarios),
            'state_targets': {a: {s: dict(c) for s, c in states.items()} for a, states in summaries.items()},
            'state_transitions': dict(transitions), 'changed_state_pairs': moved}


def episode_chain(episode):
    trace, invalid = episode['trace'], Counter()
    events = [e for e in trace['events'] if e['actor'] == 'agent']
    actions = [e['action'] for e in events]
    for event in events:
        if (event['action']['tool'] == 'validate_plan'
                and event['observation'].get('result', {}).get('valid') is False):
            invalid[canonical(event['action'])] += 1
    guards = Counter()
    for call in episode['calls']:
        body = call['response'].get('body')
        if body:
            guard = json.loads(body).get('local_guard')
            if guard:
                guards[guard] += 1
    score = trace['score']
    validations = [e for e in events if e['action']['tool'] == 'validate_plan']
    return {'scenario_id': episode['scenario_id'], 'passed': score['passed'],
            'outcome': score['outcome'], 'score_issues': score['issues'],
            'actions': actions, 'validation_responses': [e['observation'] for e in validations],
            'validation_attempts': len(validations), 'writes': score['writes'],
            'maximum_repeats_of_same_invalid_validation': max(invalid.values(), default=0),
            'false_infeasible': score['outcome'] == 'infeasible' and 'terminal_outcome_mismatch' in score['issues'],
            'infeasible_without_validation': score['outcome'] == 'infeasible' and not validations,
            'policy_failure': episode['policy_failure'], 'local_refusals': dict(guards)}


def normal_pairs(control, repair):
    if len({e['scenario_id'] for e in control}) != len(control) or [e['scenario_id'] for e in control] != [e['scenario_id'] for e in repair]:
        raise ValueError('unique ordered full-task pairs required')
    arms = {arm: [episode_chain(e) for e in episodes] for arm, episodes in (('control', control), ('repair', repair))}
    comparisons = []
    for a, b in zip(arms['control'], arms['repair']):
        n, m = len(a['actions']), len(b['actions'])
        common = next((i for i in range(min(n, m)) if a['actions'][i] != b['actions'][i]), min(n, m))
        comparisons.append({'scenario_id': a['scenario_id'], 'before': a['passed'], 'after': b['passed'],
                            'common_action_prefix_length': common,
                            'first_different_control_action': a['actions'][common] if common < n else None,
                            'first_different_repair_action': b['actions'][common] if common < m else None})
    return {'arms': arms, 'paired': comparisons,
            'counts': {arm: {'correct': sum(e['passed'] for e in rows),
                            'false_infeasible': sum(e['false_infeasible'] for e in rows),
                            'false_infeasible_without_validation': sum(e['false_infeasible'] and e['infeasible_without_validation'] for e in rows),
                            'writes': sum(e['writes'] for e in rows),
                            'local_refusals': dict(sum((Counter(e['local_refusals']) for e in rows), Counter()))}
                       for arm, rows in arms.items()}}


def analyze(public, prepared):
    publication_integrity(public)
    plan = json.loads((ROOT / 'reports/g1-execution-v1.json').read_text(encoding='utf8'))
    for name, checksum in plan['preparation']['files'].items():
        if sha256(prepared / name) != checksum:
            raise ValueError('training inputs differ from frozen execution')
    decisions = [read_jsonl(prepared / arm / 'decisions.jsonl') for arm in ('control', 'repair')]
    episodes = [read_jsonl(public / 'run/evaluation' / arm / 'normal/episodes.jsonl') for arm in ('control', 'repair')]
    normal = normal_pairs(*episodes)
    return {'version': 'g1-posthoc-context-audit-v1', 'training': paired_contexts(*decisions), 'normal': normal,
            'source_sha256': {'publication': sha256(public / 'publication.json'),
                              'execution': sha256(ROOT / 'reports/g1-execution-v1.json')},
            'new_model_calls': 0, 'new_training': False, 'test_episodes': 0,
            'scope': 'Post-hoc coverage association, not an intervention proving causality; no frozen targets, scoring or gates changed.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--public-dir', required=True, type=Path)
    parser.add_argument('--prepared-dir', required=True, type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = analyze(args.public_dir, args.prepared_dir)
    target = args.public_dir / 'context-review.json'
    if args.check:
        if result != json.loads(target.read_text(encoding='utf8')):
            raise ValueError('post-hoc context review differs from raw inputs')
    else:
        dump_new(target, result)
    print(result['training']['state_targets'])
    print(result['normal']['counts'])
