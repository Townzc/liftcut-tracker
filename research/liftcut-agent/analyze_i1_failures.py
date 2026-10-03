"""Post-hoc I1 failure localization from actual model inputs, with no new calls."""
import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path

from d2_execution import read
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from publish_i1_results import publication_integrity
from server_workspace import dump_new, sha256


def tool_results(payload):
    names, result = {}, {}
    for message in payload['messages']:
        for call in message.get('tool_calls', []):
            names[call['id']] = call['function']['name']
        if message['role'] == 'tool':
            body = json.loads(message['content'])
            if body.get('ok'):
                result[names[message['tool_call_id']]] = body['result']
    return result


def without_source_ids(payload):
    """Normalize only opaque record IDs, retaining all values and other semantics."""
    result = deepcopy(payload)
    names = {}
    for message in result['messages']:
        for call in message.get('tool_calls', []):
            names[call['id']] = call['function']['name']
        if message['role'] != 'tool':
            continue
        body = json.loads(message['content'])
        name = names[message['tool_call_id']]
        if body.get('ok') and name in ('get_context', 'get_memories'):
            records = (body['result']['input']['records'] if name == 'get_context'
                       else body['result']['memories'])
            for index, record in enumerate(records):
                if 'id' in record:
                    record['id'] = f'{name}-opaque-{index}'
        message['content'] = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    return result


def build(public):
    publication_integrity(public)
    review = read(public / 'review.json')
    if (not review['model_result'] or review['episodes_replayed'] != 222
            or not review['projection_inputs_verified'] or review['new_training']):
        raise ValueError('complete actual I1 review required')
    directory = public / 'run/evaluation/view/d2'
    episodes = read_jsonl(directory / 'episodes.jsonl')
    calls = read_jsonl(directory / 'calls.jsonl')
    inputs = read_jsonl(directory / 'inputs.jsonl')
    if len(calls) != len(inputs):
        raise ValueError('input/call alignment missing')
    by_case = {}
    for call, row in zip(calls, inputs):
        if call['call']['request'] != row['original_request']:
            raise ValueError('original request does not match input log')
        by_case.setdefault(call['case_id'], []).append(row)
    failures = []
    for episode in episodes:
        case = episode['case_id']
        if not case.startswith(('d2-memory-', 'd2-identity-')):
            continue
        if len(by_case[case]) != 1:
            raise ValueError('memory decision probe must contain one model request')
        if episode['decision']['correct']:
            continue
        row = by_case[case][0]
        original, visible = tool_results(row['original_request']), tool_results(row['model_request'])
        context = visible['get_context']
        memories = visible['get_memories']['memories']
        values = [m['value'] for m in memories if m['field'] == 'equipment']
        members = episode['decision']['member_scores']
        if len(members) != 1 or len(values) != 1:
            raise ValueError('one decision and one visible equipment memory required')
        selected = members[0]['selected_equipment']
        raw = context['input']['constraints']['equipment']
        removed = [m for m in original['get_memories']['memories'] if m not in memories]
        classification = ('raw_context_override' if selected == raw else
                          'matches_removed_value' if selected in [m['value'] for m in removed] else
                          'other_wrong_value')
        failures.append({'case_id': case, 'selected_equipment': selected, 'raw_context_equipment': raw,
                         'visible_memory_equipment': values[0], 'user_corrections': context['user_corrections'],
                         'visible_memory_ids': [m['id'] for m in memories],
                         'selected_matches_pruned_memory_value': selected in [m['value'] for m in removed],
                         'selected_present_in_visible_context_or_memory': selected == raw or selected in values,
                         'classification': classification,
                         'actual_input_digest': digest(row['model_request'])})
    pairs = []
    for pair in review['arms']['view']['identity_pairs']:
        left, right = (by_case[pair[k]][0]['model_request'] for k in ('original', 'renamed'))
        if without_source_ids(left) != without_source_ids(right):
            raise ValueError('identity pair changes more than opaque source IDs')
        pairs.append({**pair, 'actual_projected_inputs_equal_except_source_ids': True,
                      'original_input_digest': digest(left), 'renamed_input_digest': digest(right)})
    return {'version': 'i1-failure-localization-v1', 'post_hoc': True, 'new_model_calls': 0,
            'reserved_test_reads': 0, 'review_sha256': sha256(public / 'review.json'),
            'failures': failures, 'failure_classes': dict(Counter(r['classification'] for r in failures)),
            'identity_pairs': pairs, 'identity_score_flips': sum(p['score_flip'] for p in pairs),
            'identity_action_changes': sum(p['normalized_action_sequence_changed'] for p in pairs),
            'caution': 'Matching a pruned value does not establish retrieval of that record. Joint record/memory ID changes cannot isolate which ID caused sensitivity. Reused dev states are not independent samples.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--public-dir', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = build(args.public_dir)
    path = args.public_dir / 'failure-localization.json'
    if args.check:
        if result != read(path):
            raise ValueError('I1 failure localization differs')
    else:
        dump_new(path, result)
    print({k: result[k] for k in ('failure_classes', 'identity_score_flips', 'identity_action_changes')})
