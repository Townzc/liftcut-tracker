"""Native serialization and audits. Scripted token IDs are never model-generated tokens."""
import json
from pathlib import Path
import sys
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
LEGACY = ROOT / 'research/liftcut-agent'
sys.path[:0] = [str(LEGACY), str(LEGACY / 'src')]
from liftcut_agent.qwen_transport import QwenTransport, parse_tool_message
from liftcut_agent.trajectories import normalize_messages

LIMITS = {'cases': 24, 'requestsPerCase': 12, 'outputTokens': 512, 'contextTokens': 4096}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def prompt_ids(tokenizer, payload):
    return tokenizer.apply_chat_template(normalize_messages(payload['messages']), tools=payload['tools'],
                                         tokenize=True, add_generation_prompt=True)


def scripted_action(payload):
    name, args = 'read_state', {}
    message = payload['messages'][-1]
    if message['role'] == 'tool':
        value = json.loads(message['content']).get('value', {})
        if 'version' in value:
            if value['status'] == 'planning':
                name, args = 'propose_draft', {'draft': 'draft-1', 'revision': value['revision']}
            elif value['status'] == 'approved':
                name, args = 'execute_plan', {'proposal': value['proposal']['handle'],
                                             'approval': value['approval'], 'key': value['executionKey']}
            else:
                name, args = 'finish', {'status': 'blocked' if value['status'] in ('stale', 'budget_exhausted') else value['status']}
    return {'name': name, 'arguments': args}


class Native:
    def __init__(self, tokenizer, model=None):
        self.tokenizer, self.model, self.number = tokenizer, model, 0
        self.generated = []
        self.transport = QwenTransport(model, tokenizer,
            SimpleNamespace(max_output_tokens=512, model='p1-fixed-g4-parent'), self.generated.append, max_context=4096) if model is not None else None

    def complete(self, payload):
        self.number += 1
        ids = prompt_ids(self.tokenizer, payload)
        if self.model is not None:
            body = json.loads(self.transport.complete(payload).body)
            generation = self.generated[-1]
        else:
            if len(ids) + 512 > 4096:
                raise ValueError('scripted preparation exceeds original context budget')
            start = time.monotonic()
            text = '<tool_call>\n' + encode(scripted_action(payload)) + '\n</tool_call>' + self.tokenizer.eos_token
            output = self.tokenizer.encode(text, add_special_tokens=False)
            raw = self.tokenizer.decode(output, skip_special_tokens=False)
            if len(output) > 512 or output[-1] != self.tokenizer.eos_token_id:
                raise ValueError('scripted serialization violates original decode limits')
            body = {'model': 'p1-fixed-g4-parent', 'choices': [{'index': 0, 'message': parse_tool_message(raw, self.number), 'finish_reason': 'tool_calls'}],
                    'usage': {'prompt_tokens': len(ids), 'completion_tokens': len(output), 'total_tokens': len(ids) + len(output)}}
            generation = {'request_number': self.number, 'raw_text': raw, 'output_ids': output, 'prompt_tokens': len(ids),
                          'model_called': False, 'scripted_serialization': True, 'parse_error': None,
                          'eos_reached': True, 'elapsed_seconds': time.monotonic() - start}
        return {'number': self.number, 'body': body, 'native': {'input_ids': ids, **generation},
                'evidenceKind': 'model' if self.model is not None else 'scripted'}


def audit(tokenizer, request, reply, number, kind):
    if reply['evidenceKind'] != kind or reply['number'] != number:
        raise ValueError('native identity/kind differs')
    row = reply['native']
    ids = prompt_ids(tokenizer, request)
    if row['input_ids'] != ids or row['request_number'] != number:
        raise ValueError('native prompt IDs/sequence differ')
    usage = reply['body']['usage']
    if reply['body']['model'] != 'p1-fixed-g4-parent':
        raise ValueError('native model identity differs')
    if len(ids) + 512 > 4096:
        if kind != 'model' or row.get('parse_error') != 'context_limit' or row['model_called'] or row['output_ids'] or row['raw_text'] is not None:
            raise ValueError('invalid context guard record')
        if usage != {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0} or row['requested_prompt_tokens'] != len(ids):
            raise ValueError('context rejection usage differs')
        expected = {'role': 'assistant', 'content': None, 'tool_calls': []}
        finish = 'local_context_limit'
        if set(reply['body']) != {'model', 'local_guard', 'choices', 'usage'} or reply['body']['local_guard'] != 'context_limit':
            raise ValueError('context guard envelope differs')
    else:
        if set(reply['body']) != {'model', 'choices', 'usage'}:
            raise ValueError('native response envelope differs')
        if bool(row['model_called']) != (kind == 'model') or bool(row.get('scripted_serialization')) != (kind == 'scripted'):
            raise ValueError('scripted evidence cannot be promoted to model evidence')
        raw = tokenizer.decode(row['output_ids'], skip_special_tokens=False)
        ended = bool(row['output_ids']) and row['output_ids'][-1] == tokenizer.eos_token_id
        if raw != row['raw_text'] or ended != row['eos_reached'] or len(row['output_ids']) > 512 or row['prompt_tokens'] != len(ids):
            raise ValueError('native output tokens/text/budget differ')
        if usage != {'prompt_tokens': len(ids), 'completion_tokens': len(row['output_ids']), 'total_tokens': len(ids) + len(row['output_ids'])}:
            raise ValueError('actual native usage differs')
        error, message = None, None
        if ended:
            try: message = parse_tool_message(raw, number)
            except ValueError as exc: error = str(exc)
        expected = message or {'role': 'assistant', 'content': raw, 'tool_calls': []}
        finish = 'tool_calls' if expected['tool_calls'] else 'stop' if ended else 'length'
        if row['parse_error'] != error:
            raise ValueError('native parse error differs')
    if reply['body']['choices'] != [{'index': 0, 'message': expected, 'finish_reason': finish}]:
        raise ValueError('native parsed response differs')
    return {'prompt_tokens': usage['prompt_tokens'], 'completion_tokens': usage['completion_tokens'],
            'model_called': row['model_called'], 'requested_prompt_tokens': len(ids)}
