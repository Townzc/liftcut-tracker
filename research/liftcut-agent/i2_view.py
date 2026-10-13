"""Public-observation-only evidence aliases and explicit constraint resolution.

No case, score, simulator, catalogue or reference action enters this module.
Only evidence ID fields are rewritten; approval/proposal/call/retry IDs are opaque.
"""
from copy import deepcopy
import json

from liftcut_agent.benchmark import DAYS, EQUIPMENT, FIELDS
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import Reply, encode
from memory_view import latest_valid, project as memory_project

ARMS = ('A', 'B', 'C', 'D')
FLAGS = {'A': (False, False), 'B': (True, False), 'C': (False, True), 'D': (True, True)}
INSTRUCTION = ('\nApplication constraint view: when get_context includes effective_constraints, '
               'use that resolved constraint object for planning. Its source precedence is explicit '
               'user correction or clarification, then latest confirmed unexpired memory, then '
               'context fallback. Null remains missing; clarify it. This view grants no approval '
               'and does not change proposal versions, retry keys, or tool permissions.\n')


def tool_results(payload):
    calls = {}
    for index, message in enumerate(payload['messages']):
        for call in message.get('tool_calls', []):
            calls[call['id']] = call['function']['name']
        if message.get('role') == 'tool':
            name = calls.get(message.get('tool_call_id'))
            if name is None:
                raise ValueError('tool response without a public call')
            yield index, name, json.loads(message['content'])


def aliases(payload):
    """Content-addressed names are stable across reordering, renaming and turns.

    Equal semantic evidence with different IDs is ambiguous: reject, do not choose
    using source IDs or list position. Repeated identical observations are allowed.
    """
    forward, inverse, meanings = {}, {}, {}
    for _, name, data in tool_results(payload):
        if not data.get('ok'):
            continue
        if name == 'get_context':
            rows, kind = data['result']['input']['records'], 'record'
        elif name == 'get_memories':
            rows, kind = data['result']['memories'], 'memory'
        else:
            continue
        seen = set()
        for row in rows:
            expected = {'id', 'summary'} if kind == 'record' else {
                'id', 'field', 'value', 'revision', 'confirmed', 'expires_on'}
            if set(row) != expected or not isinstance(row['id'], str) or not row['id'] or row['id'] in seen:
                raise ValueError('malformed public evidence')
            seen.add(row['id'])
            original = row['id']
            semantic = {'kind': kind, **{k: v for k, v in row.items() if k != 'id'}}
            identity = 'ev_' + digest(semantic)[:12]
            if original in meanings and meanings[original] != semantic:
                raise ValueError('evidence identity reused with different content')
            if identity in inverse and inverse[identity] != original:
                raise ValueError('ambiguous semantic duplicate or alias collision')
            forward[original], inverse[identity], meanings[original] = identity, original, semantic
    if any(name in forward and forward[name] != name for name in inverse):
        raise ValueError('source IDs collide with the alias namespace')
    return {'forward': forward, 'inverse': inverse}


def map_plan(plan, table, *, strict=True):
    result = deepcopy(plan)
    if not isinstance(result, dict) or 'evidence_ids' not in result:
        return result
    ids = result['evidence_ids']
    if not isinstance(ids, list) or any(not isinstance(x, str) or (strict and x not in table) for x in ids):
        raise ValueError('unknown evidence reference')
    result['evidence_ids'] = [table.get(x, x) for x in ids]
    return result


def map_message(message, table, *, strict=True):
    out = deepcopy(message)
    for call in out.get('tool_calls', []):
        if call['function']['name'] not in ('validate_plan', 'propose_plan'):
            continue
        arguments = json.loads(call['function']['arguments'])
        if 'plan' in arguments:
            arguments['plan'] = map_plan(arguments['plan'], table, strict=strict)
            call['function']['arguments'] = encode(arguments)
    return out


def alias_payload(payload, mapping):
    out = deepcopy(payload)
    forward = mapping['forward']
    for index, name, data in tool_results(out):
        if not data.get('ok'):
            continue
        result = data['result']
        if name == 'get_context':
            for row in result['input']['records']:
                row['id'] = forward[row['id']]
            if result.get('active_plan') is not None:
                result['active_plan'] = map_plan(result['active_plan'], forward, strict=False)
            for source in result.get('effective_sources', {}).values():
                if 'evidence_id' in source:
                    source['evidence_id'] = forward[source['evidence_id']]
        elif name == 'get_memories':
            for row in result['memories']:
                row['id'] = forward[row['id']]
        elif name == 'propose_plan' and 'proposal' in result:
            result['proposal']['plan'] = map_plan(result['proposal']['plan'], forward, strict=False)
        else:
            continue
        out['messages'][index]['content'] = encode(data)
    # Invalid references in an already-observed failed action must remain visible
    # for repair. Only NEW model references are rejected at the inverse boundary.
    out['messages'] = [map_message(m, forward, strict=False) for m in out['messages']]
    return out


def validate_values(values):
    if not isinstance(values, dict) or not set(values) <= FIELDS:
        raise ValueError('unknown constraint fields')
    for field, value in values.items():
        if value is None:
            if field == 'excluded_exercise_ids':
                raise ValueError('exclusions must be an explicit list')
            continue
        if field in ('available_days', 'equipment', 'excluded_exercise_ids'):
            if not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value) or len(set(value)) != len(value):
                raise ValueError('constraint list malformed')
            allowed = DAYS if field == 'available_days' else EQUIPMENT if field == 'equipment' else None
            if allowed is not None and not set(value) <= allowed:
                raise ValueError('constraint enum outside public schema')
        elif type(value) is not int or not 1 <= value <= {'sessions_per_week': 7, 'max_minutes': 180, 'min_exercises': 10}[field]:
            raise ValueError('constraint integer outside public schema')


def resolve(payload):
    """Expose effective values without deleting raw context or inventing user facts.

    Only the last successful context observation gets an explicit effective view.
    Trusted user event messages retain all original bytes and authorization IDs.
    Projection errors stop the trial; they never become default equipment choices.
    """
    result = deepcopy(payload)
    messages = result['messages']
    initial = json.loads(messages[1]['content'])
    context, context_index, memories, corrections, revision = None, None, None, {}, 0
    tools = {i: (name, data) for i, name, data in tool_results(payload)}
    for index, message in enumerate(messages):
        if index in tools:
            name, data = tools[index]
            if not data.get('ok'):
                continue
            value = data['result']
            if name == 'get_context':
                if value['as_of'] != initial['as_of'] or type(value['context_revision']) is not int:
                    raise ValueError('context date/revision mismatch')
                if value['context_revision'] < revision or value['context_revision'] < 1:
                    raise ValueError('stale public context snapshot')
                if set(value['input']['constraints']) != FIELDS or not set(value['user_corrections']) <= FIELDS:
                    raise ValueError('unknown or missing constraint fields')
                validate_values(value['input']['constraints'])
                validate_values(value['user_corrections'])
                context, context_index = deepcopy(value), index
                corrections, revision = deepcopy(value['user_corrections']), value['context_revision']
            elif name == 'get_memories':
                memories = latest_valid(value['memories'], initial['as_of'])
                if any(m['field'] not in FIELDS for m in memories):
                    raise ValueError('unknown public memory field')
                for memory in memories:
                    validate_values({memory['field']: memory['value']})
        elif index > 1 and message.get('role') == 'user':
            for observation in json.loads(message['content']).get('user_events', []):
                event = observation['event']
                if type(observation['context_revision']) is not int or observation['context_revision'] < revision:
                    raise ValueError('stale user event')
                revision = observation['context_revision']
                if event['type'] in ('clarification', 'update_constraints'):
                    if not event['values'] or not set(event['values']) <= FIELDS:
                        raise ValueError('unknown correction fields')
                    validate_values(event['values'])
                    if event['type'] == 'clarification' and any(v is None for v in event['values'].values()):
                        raise ValueError('clarification cannot supply an unknown value')
                    corrections.update(deepcopy(event['values']))
    if context is None or memories is None:
        return result, {'status': 'awaiting_public_reads', 'fields': {}}
    values = deepcopy(context['input']['constraints'])
    sources = {field: {'kind': 'context_fallback'} for field in sorted(FIELDS)}
    for memory in memories:
        values[memory['field']] = deepcopy(memory['value'])
        sources[memory['field']] = {'kind': 'latest_valid_memory', 'evidence_id': memory['id'],
                                    'revision': memory['revision'], 'expires_on': memory['expires_on']}
    for field, value in corrections.items():
        values[field] = deepcopy(value)
        sources[field] = {'kind': 'explicit_user', 'context_revision': revision}
    data = json.loads(messages[context_index]['content'])
    data['result'].update(effective_constraints=values, effective_sources=sources,
                          effective_context_revision=revision,
                          effective_status='missing' if any(v is None for v in values.values()) else 'resolved')
    messages[context_index]['content'] = encode(data)
    if INSTRUCTION not in messages[0]['content']:
        messages[0]['content'] += INSTRUCTION
    return result, {'status': data['result']['effective_status'], 'fields': sources,
                    'context_message_index': context_index, 'as_of': initial['as_of'],
                    'observed_context_revision': revision, 'effective_constraints': values}


def project(payload, arm):
    if arm not in FLAGS:
        raise ValueError('unregistered I2 arm')
    use_aliases, use_sources = FLAGS[arm]
    selected, memory_proof = memory_project(payload)
    resolved, resolution = resolve(selected) if use_sources else (selected, None)
    # Mapping includes public raw evidence observed before filtering, retaining stable
    # references from earlier turns. The simulator still validates admissible evidence.
    mapping = aliases(payload) if use_aliases else {'forward': {}, 'inverse': {}}
    actual = alias_payload(resolved, mapping) if use_aliases else resolved
    proof = {'version': 'i2-public-view-v1', 'arm': arm, 'flags': list(FLAGS[arm]),
             'original_request_digest': digest(payload), 'projected_request_digest': digest(actual),
             'memory_projection': memory_proof, 'source_resolution': resolution,
             'evidence_mapping': mapping, 'hidden_state_read': False,
             'changed': actual != payload}
    return actual, proof


def restore_reply(reply, proof):
    """Reverse only plan evidence references; reject unknown aliases before execution."""
    if not FLAGS[proof['arm']][0]:
        return reply, {'status': 'identity', 'changed': False}
    body = json.loads(reply.body)
    original = deepcopy(body)
    try:
        for choice in body['choices']:
            choice['message'] = map_message(choice['message'], proof['evidence_mapping']['inverse'])
    except ValueError:
        body['local_guard'] = 'unknown_evidence_alias'
        body['choices'] = [{'index': 0, 'finish_reason': 'unknown_evidence_alias',
                            'message': {'role': 'assistant', 'content': None, 'tool_calls': []}}]
        status = 'rejected_unknown_evidence_alias'
    else:
        status = 'decoded'
    return Reply(encode(body), reply.status, reply.error, reply.elapsed_seconds), {
        'status': status, 'changed': body != original}
