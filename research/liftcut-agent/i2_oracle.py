"""CPU oracle ONLY. Reads scripted expected actions, never used by GPU workers.
Native text is tokenized, but none of these scripted actions is a model result.
"""
from copy import deepcopy
import json
from i2_view import map_plan
from liftcut_agent.interactive import digest
from liftcut_agent.model_transport import MockWorkflowTransport
from liftcut_agent.model_policy import Reply, encode
from liftcut_agent.qwen_transport import parse_tool_message
from liftcut_agent.trajectories import normalize_messages
from state_coverage import config

class ScriptedNative:
    def __init__(self, panel, cases, tokenizer, record, arm):
        self.arm = arm
        self.panel, self.cases, self.tokenizer, self.record = panel, cases, tokenizer, record
        self.case_index, self.action_index, self.number = 0, 0, 0
        self.mock = MockWorkflowTransport()

    def advance(self):
        self.case_index += 1
        self.action_index = 0
        self.mock = MockWorkflowTransport()

    def complete(self, payload):
        self.number += 1
        if self.panel == 'normal':
            data = json.loads(self.mock.complete(payload).body)
            functions = [c['function'] for c in data['choices'][0]['message']['tool_calls']]
            selected = [{'name': f['name'], 'arguments': json.loads(f['arguments'])} for f in functions]
        else:
            expected = self.cases[self.case_index]['expected']
            choices = expected.get('reference_actions', [expected.get('reference_action')])
            action = choices[self.action_index]
            self.action_index += 1
            selected = [{'name': action['tool'], 'arguments': action['arguments']}]
        if self.panel != 'normal' and self.arm in ('B', 'D'):
            scenario = self.cases[self.case_index]['scenario']
            table = {}
            for kind, rows in [('record', scenario['input']['records']), ('memory', scenario['memories'])]:
                for row in rows:
                    table[row['id']] = 'ev_' + digest({'kind': kind, **{k:v for k,v in row.items() if k != 'id'}})[:12]
            for item in selected:
                if item['name'] in ('validate_plan', 'propose_plan'):
                    item['arguments'] = deepcopy(item['arguments'])
                    item['arguments']['plan'] = map_plan(item['arguments']['plan'], table)
        text = ''.join('<tool_call>' + encode(action) + '</tool_call>' for action in selected) + '<|im_end|>'
        ids = self.tokenizer.encode(text, add_special_tokens=False)
        prompt = self.tokenizer.apply_chat_template(normalize_messages(payload['messages']), tools=payload['tools'],
                                                    tokenize=True, add_generation_prompt=True)
        if len(prompt) + 512 > 4096 or len(ids) > 512 or ids[-1] != self.tokenizer.eos_token_id:
            raise ValueError('scripted oracle exceeds original native context/output limits')
        raw = self.tokenizer.decode(ids, skip_special_tokens=False)
        message = parse_tool_message(raw, self.number)
        self.record({'request_number': self.number, 'raw_text': raw, 'output_ids': ids, 'prompt_tokens': len(prompt),
            'model_called': True, 'parse_error': None, 'eos_reached': True, 'elapsed_seconds': 1.0})
        body = {'model': config().model, 'choices': [{'index': 0, 'message': message, 'finish_reason': 'tool_calls'}],
                'usage': {'prompt_tokens': len(prompt), 'completion_tokens': len(ids), 'total_tokens': len(prompt) + len(ids)}}
        return Reply(encode(body), 200, None, 1.0)
