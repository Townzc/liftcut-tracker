"""Input provenance failures must not become complete model evidence."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from i1_rollout import ProjectedTransport, audit_projected_calls, projected_record
from liftcut_agent.model_policy import Reply, encode
from liftcut_agent.qwen_transport import parse_tool_message
from liftcut_agent.trajectories import normalize_messages


class TestTokenizer:
    eos_token_id = 1000

    def apply_chat_template(self, messages, **kw):
        return list(range(len(json.dumps(messages, sort_keys=True))))

    def decode(self, ids, **kw):
        return '<tool_call>{"name":"finish","arguments":{}}</tool_call><|im_end|>'


def payload():
    rows = [{'id': identity, 'field': 'equipment', 'value': [identity], 'revision': revision,
             'confirmed': True, 'expires_on': None} for identity, revision in [('old', 1), ('new', 2)]]
    return {'messages': [{'role': 'system', 'content': 'rules'},
        {'role': 'user', 'content': json.dumps({'as_of': '2026-10-03'})},
        {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'c', 'type': 'function',
         'function': {'name': 'get_memories', 'arguments': '{}'}}]},
        {'role': 'tool', 'tool_call_id': 'c', 'content': json.dumps({'ok': True, 'result': {'memories': rows}})}],
        'tools': [], 'max_completion_tokens': 512}


class NativeStub:
    """Scripted unit response; no model call or real tokenizer evidence."""
    def __init__(self, tokenizer):
        self.tokenizer, self.inputs, self.generations, self.advanced = tokenizer, [], [], 0

    def advance(self):
        self.advanced += 1

    def complete(self, request):
        self.inputs.append(deepcopy(request))
        number = len(self.inputs)
        raw = self.tokenizer.decode([1000])
        tokens = len(self.tokenizer.apply_chat_template(normalize_messages(request['messages'])))
        self.generations.append({'request_number': number, 'raw_text': raw, 'output_ids': [1000],
            'prompt_tokens': tokens, 'model_called': True, 'parse_error': None, 'eos_reached': True,
            'elapsed_seconds': 1.})
        return Reply(encode({'choices': [{'message': parse_tool_message(raw, number), 'finish_reason': 'tool_calls'}],
            'usage': {'prompt_tokens': tokens, 'completion_tokens': 1}}), 200, None, 1.)


class ProjectionAuditTests(unittest.TestCase):
    def run_call(self, arm):
        tokenizer = TestTokenizer()
        inner, records = NativeStub(tokenizer), []
        transport = ProjectedTransport(inner, arm, records.append)
        original = payload()
        saved = deepcopy(original)
        reply = transport.complete(original)
        self.assertEqual(original, saved)
        transport.advance()
        self.assertEqual(inner.advanced, 1)
        call = {'request': original, 'response': {'body': reply.body, 'elapsed_seconds': reply.elapsed_seconds}}
        self.assertEqual(records[0]['model_request'], inner.inputs[0])
        return call, inner.generations, records, tokenizer

    def test_original_trace_and_actual_input_are_separately_audited(self):
        for arm, changed in [('raw', 0), ('view', 1)]:
            call, generations, records, tokenizer = self.run_call(arm)
            result = audit_projected_calls([call], generations, records, tokenizer, arm)
            self.assertEqual(result['changed_requests'], changed)
            self.assertEqual(result['tokens']['actual_model_generations'], 1)
            if arm == 'view':
                self.assertLess(result['tokens']['generated_prompt_tokens'], result['raw_prompt_tokens_at_same_visited_states'])

    def test_input_evidence_tampering_missing_and_wrong_arm_are_rejected(self):
        call, generations, records, tokenizer = self.run_call('view')
        variants = [[], records * 2]
        for field in ('original_request', 'model_request'):
            row = deepcopy(records)
            row[0][field]['messages'][0]['content'] = 'edited'
            variants.append(row)
        row = deepcopy(records)
        row[0]['projection']['changes'] = []
        variants.append(row)
        row = deepcopy(records)
        row[0]['request_number'] = 2
        variants.append(row)
        for bad in variants:
            with self.assertRaises(ValueError):
                audit_projected_calls([call], generations, bad, tokenizer, 'view')
        with self.assertRaises(ValueError):
            audit_projected_calls([call], generations, records, tokenizer, 'raw')

    def test_raw_token_accounting_cannot_masquerade_as_view_input(self):
        call, generations, records, tokenizer = self.run_call('view')
        wrong = deepcopy(generations)
        wrong[0]['prompt_tokens'] += 1
        wrong_call = deepcopy(call)
        body = json.loads(wrong_call['response']['body'])
        body['usage']['prompt_tokens'] += 1
        wrong_call['response']['body'] = encode(body)
        with self.assertRaises(ValueError):
            audit_projected_calls([wrong_call], wrong, records, tokenizer, 'view')
        with self.assertRaises(ValueError):
            projected_record(payload(), 'best-scoring', 1)


if __name__ == '__main__':
    unittest.main()
