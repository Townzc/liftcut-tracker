from copy import deepcopy
from itertools import permutations
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT/'src')]
from i2_view import ARMS, INSTRUCTION, aliases, project, restore_reply
from liftcut_agent.model_policy import Reply, encode
from memory_view import project as i1_project


def payload():
    context = {'input': {'request': 'Update my plan', 'constraints': {
        'available_days': ['mon', 'wed'], 'sessions_per_week': 2, 'equipment': ['bodyweight'],
        'max_minutes': 45, 'min_exercises': 1, 'excluded_exercise_ids': []},
        'records': [{'id': 'unpredictable-record', 'summary': 'Preference documented'}]},
        'user_corrections': {}, 'context_revision': 1, 'as_of': '2026-10-12', 'active_plan': None}
    rows = [{'id': identity, 'field': 'equipment', 'value': [value], 'revision': revision,
             'confirmed': True, 'expires_on': None}
            for identity, value, revision in [('older', 'barbell', 1), ('latest', 'machine', 2)]]
    return {'messages': [{'role': 'system', 'content': 'Follow tools and external approval.'},
        {'role': 'user', 'content': encode({'as_of': '2026-10-12', 'request': 'Update plan'})},
        {'role': 'assistant', 'tool_calls': [{'id': 'read-context', 'function': {'name': 'get_context', 'arguments': '{}'}}]},
        {'role': 'tool', 'tool_call_id': 'read-context', 'content': encode({'ok': True, 'result': context})},
        {'role': 'assistant', 'tool_calls': [{'id': 'read-memories', 'function': {'name': 'get_memories', 'arguments': '{}'}}]},
        {'role': 'tool', 'tool_call_id': 'read-memories', 'content': encode({'ok': True, 'result': {'memories': rows}})}],
        'tools': [{'function': {'name': 'unchanged-schema'}}], 'max_completion_tokens': 512}


def edit_result(p, index, operation):
    value = json.loads(p['messages'][index]['content'])
    operation(value['result'])
    p['messages'][index]['content'] = encode(value)


def correction(p, values, kind='update_constraints', revision=2):
    p['messages'].append({'role': 'user', 'content': encode({'user_events': [
        {'event': {'type': kind, 'values': values}, 'context_revision': revision}]})})


class PublicViewTests(unittest.TestCase):
    def test_A_exactly_preserves_i1_and_all_arms_leave_input_immutable(self):
        p = payload(); original = deepcopy(p)
        self.assertEqual(project(p, 'A')[0], i1_project(p)[0])
        for arm in ARMS:
            out, proof = project(p, arm)
            self.assertEqual(p, original)
            self.assertEqual(out['tools'], p['tools'])
            self.assertEqual(out['max_completion_tokens'], 512)
            self.assertFalse(proof['hidden_state_read'])
            self.assertEqual(project(out, arm)[0], out)

    def test_N_renaming_and_permutation_invariance_without_hiding_values(self):
        p = payload(); before = project(p, 'B')[0]
        original_rows = json.loads(p['messages'][5]['content'])['result']['memories']
        for order in permutations(original_rows):
            renamed = deepcopy(p)
            edit_result(renamed, 3, lambda r: r['input']['records'][0].update(id='changed-record'))
            rows = [{**r, 'id': 'new-' + r['id']} for r in order]
            edit_result(renamed, 5, lambda r: r.update(memories=rows))
            self.assertEqual(project(renamed, 'B')[0], before)
        for key, value in [('value', ['dumbbell']), ('revision', 8), ('expires_on', '2027-01-01')]:
            other = deepcopy(p)
            edit_result(other, 5, lambda r: r['memories'][1].update({key: value}))
            self.assertNotEqual(project(other, 'B')[0], before)

    def test_R_priority_and_raw_context_preservation(self):
        p = payload(); out, _ = project(p, 'C')
        context = json.loads(out['messages'][3]['content'])['result']
        self.assertEqual(context['input']['constraints']['equipment'], ['bodyweight'])
        self.assertEqual(context['effective_constraints']['equipment'], ['machine'])
        self.assertEqual(context['effective_sources']['equipment']['kind'], 'latest_valid_memory')
        correction(p, {'equipment': ['dumbbell']})
        out, _ = project(p, 'D')
        c = json.loads(out['messages'][3]['content'])['result']
        self.assertEqual(c['effective_constraints']['equipment'], ['dumbbell'])
        self.assertEqual(c['effective_sources']['equipment']['kind'], 'explicit_user')
        self.assertEqual(c['effective_context_revision'], 2)
        self.assertEqual(out['messages'][-1], p['messages'][-1])
        self.assertEqual(out['messages'][0]['content'].count(INSTRUCTION), 1)

    def test_missing_withdrawal_no_valid_memory_and_missing_reads(self):
        p = payload(); correction(p, {'equipment': None})
        out, _ = project(p, 'C')
        c = json.loads(out['messages'][3]['content'])['result']
        self.assertIsNone(c['effective_constraints']['equipment'])
        self.assertEqual(c['effective_status'], 'missing')
        p = payload()
        edit_result(p, 5, lambda r: r.update(memories=[]))
        self.assertEqual(json.loads(project(p, 'C')[0]['messages'][3]['content'])['result']['effective_constraints']['equipment'], ['bodyweight'])
        p['messages'] = p['messages'][:4]
        self.assertEqual(project(p, 'C')[1]['source_resolution']['status'], 'awaiting_public_reads')

    def test_invalid_ambiguity_and_stale_events_fail_closed(self):
        changes = [lambda r: r['memories'][1].update(revision=1),
                   lambda r: r['memories'][1].update(expires_on='2026-99-99'),
                   lambda r: r['memories'][1].update(value=['imaginary']),
                   lambda r: r['memories'][1].update(field='expected_action')]
        for change in changes:
            p = payload(); edit_result(p, 5, change)
            with self.assertRaises(ValueError): project(p, 'D')
        for values, kind, revision in [({'equipment': ['machine']}, 'update_constraints', 0),
                                       ({'max_minutes': True}, 'update_constraints', 2),
                                       ({'equipment': None}, 'clarification', 2)]:
            p = payload(); correction(p, values, kind, revision)
            with self.assertRaises(ValueError): project(p, 'D')

    def test_aliases_stable_when_later_evidence_arrives_and_reject_duplicates(self):
        p = payload(); early = deepcopy(p); early['messages'] = early['messages'][:4]
        self.assertEqual(aliases(early)['forward']['unpredictable-record'], aliases(p)['forward']['unpredictable-record'])
        edit_result(p, 3, lambda r: r['input']['records'].append({'id': 'other', 'summary': 'Preference documented'}))
        with self.assertRaises(ValueError): project(p, 'B')

    def test_inverse_mapping_preserves_every_permission_and_retry_identifier(self):
        p = payload(); _, proof = project(p, 'D'); forward = proof['evidence_mapping']['forward']
        calls = [{'id': 'call-unchanged', 'type': 'function', 'function': {'name': 'propose_plan', 'arguments': encode({
            'plan': {'action': 'propose_plan', 'sessions': [], 'evidence_ids': [forward['latest']]}})}}]
        body = {'choices': [{'message': {'role': 'assistant', 'content': None, 'tool_calls': calls}, 'finish_reason': 'tool_calls'}],
                'usage': {'prompt_tokens': 1, 'completion_tokens': 2}}
        reply = Reply(encode(body), 200, None, 3.0)
        restored, proof2 = restore_reply(reply, proof)
        action = json.loads(json.loads(restored.body)['choices'][0]['message']['tool_calls'][0]['function']['arguments'])
        self.assertEqual(action['plan']['evidence_ids'], ['latest'])
        self.assertEqual(json.loads(restored.body)['choices'][0]['message']['tool_calls'][0]['id'], 'call-unchanged')
        calls[0]['function'] = {'name': 'apply_plan', 'arguments': encode({'proposal_id': 'latest', 'idempotency_key': 'unpredictable-record'})}
        reply = Reply(encode(body))
        self.assertEqual(restore_reply(reply, proof)[0].body, reply.body)
        calls[0]['function'] = {'name': 'propose_plan', 'arguments': encode({'plan': {'evidence_ids': ['unseen-alias']}})}
        rejected, result = restore_reply(Reply(encode(body)), proof)
        self.assertEqual(result['status'], 'rejected_unknown_evidence_alias')
        self.assertEqual(json.loads(rejected.body)['choices'][0]['message']['tool_calls'], [])

    def test_failed_history_unknown_reference_remains_repairable(self):
        p = payload()
        p['messages'] += [{'role': 'assistant', 'tool_calls': [{'id': 'validate-old', 'function': {
            'name': 'validate_plan', 'arguments': encode({'plan': {'evidence_ids': ['latest','bad-history']}})}}]},
            {'role': 'tool', 'tool_call_id': 'validate-old', 'content': encode({'ok':True,'result':{'valid':False,'issues':['unknown_evidence']}})}]
        out, proof = project(p, 'B')
        args = json.loads(out['messages'][-2]['tool_calls'][0]['function']['arguments'])
        self.assertEqual(args['plan']['evidence_ids'], [proof['evidence_mapping']['forward']['latest'],'bad-history'])
        self.assertNotIn('bad-history', proof['evidence_mapping']['inverse'])
        self.assertEqual(out['messages'][-1], p['messages'][-1])


if __name__ == '__main__': unittest.main()
