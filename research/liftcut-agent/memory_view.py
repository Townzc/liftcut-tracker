"""Draft system-side memory projection, using only facts already visible to the policy.

This does not alter the simulator, labels, tool schema, actions, or model weights.
It is an explicit system intervention, not evidence the model learned selection.
No production/training runner imports this draft by default.
"""
from copy import deepcopy
from datetime import date
import json
from liftcut_agent.interactive import digest


def latest_valid(memories,as_of):
    if not isinstance(memories,list) or date.fromisoformat(as_of).isoformat()!=as_of:
        raise ValueError('canonical public date and memory list required')
    fields={};identities=set();revisions=set()
    for row in memories:
        if (set(row)!={'id','field','value','revision','confirmed','expires_on'}
                or not isinstance(row['id'],str) or not row['id'] or row['id'] in identities
                or not isinstance(row['field'],str) or not row['field']
                or type(row['revision']) is not int or row['revision']<=0
                or type(row['confirmed']) is not bool
                or (row['field'],row['revision']) in revisions):
            raise ValueError('ambiguous or malformed memory record')
        identities.add(row['id']);revisions.add((row['field'],row['revision']))
        expiry=row['expires_on']
        if expiry is not None and (not isinstance(expiry,str) or date.fromisoformat(expiry).isoformat()!=expiry):
            raise ValueError('noncanonical expiry')
        if not row['confirmed'] or (expiry is not None and expiry<=as_of):continue
        if row['field'] not in fields or row['revision']>fields[row['field']]['revision']:fields[row['field']]=row
    return [deepcopy(fields[k]) for k in sorted(fields)]


def project(payload):
    """Project only successful get_memories results; keep the original payload intact."""
    result=deepcopy(payload);messages=result['messages'];calls={};changes=[]
    if len(messages)<2 or messages[1]['role']!='user':raise ValueError('public reset observation required')
    initial=json.loads(messages[1]['content']);as_of=initial['as_of']
    if date.fromisoformat(as_of).isoformat()!=as_of:raise ValueError('canonical as_of required')
    for index,message in enumerate(messages):
        for call in message.get('tool_calls',[]):calls[call['id']]=call['function']['name']
        if message.get('role')!='tool' or calls.get(message.get('tool_call_id'))!='get_memories':continue
        content=json.loads(message['content'])
        if not content.get('ok'):continue
        original=content['result']['memories'];selected=latest_valid(original,as_of)
        if original!=selected:
            content['result']['memories']=selected
            message['content']=json.dumps(content,ensure_ascii=False,separators=(',',':'),allow_nan=False)
            changes.append({'message_index':index,'before_count':len(original),'after_count':len(selected),
                            'selected_ids':[m['id'] for m in selected]})
    return result,{'version':'latest-valid-memory-view-v1','original_request_digest':digest(payload),
                   'projected_request_digest':digest(result),'changes':changes,
                   'public_as_of':as_of,'hidden_state_read':False}
