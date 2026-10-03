from copy import deepcopy
from itertools import permutations
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from memory_view import latest_valid,project


def memory(identity,revision,**kw):
    return {'id':identity,'field':'equipment','value':[identity],'revision':revision,'confirmed':True,'expires_on':None,**kw}


class MemoryViewTests(unittest.TestCase):
    def test_every_order_selects_latest_confirmed_unexpired(self):
        good=memory('latest',4);rows=[memory('old',2),good,memory('unconfirmed',8,confirmed=False),memory('expired',9,expires_on='2026-10-03')]
        for order in permutations(rows):self.assertEqual(latest_valid(list(order),'2026-10-03'),[good])

    def test_multiple_fields_copy_values_and_fail_closed_on_ambiguity(self):
        rows=[memory('a',2),memory('b',1,field='sessions_per_week',value=2)]
        selected=latest_valid(rows,'2026-10-03');selected[0]['value'].append('mutation')
        self.assertEqual(rows[0]['value'],['a'])
        for extra in (memory('c',2),memory('a',3)):
            with self.assertRaises(ValueError):latest_valid(rows+[extra],'2026-10-03')

    def test_projection_uses_public_date_and_changes_only_memory_tool_content(self):
        rows=[memory('old',1),memory('latest',2),memory('invalid',3,confirmed=False)]
        payload={'messages':[{'role':'system','content':'rules'},
                            {'role':'user','content':json.dumps({'as_of':'2026-10-03','request':'task'})},
                            {'role':'assistant','tool_calls':[{'id':'c','function':{'name':'get_memories','arguments':'{}'}}]},
                            {'role':'tool','tool_call_id':'c','content':json.dumps({'ok':True,'result':{'memories':rows},'steps_remaining':4})}],
                 'model':'unchanged','tools':[{'original':'schema'}],'max_completion_tokens':512}
        original=deepcopy(payload);out,proof=project(payload)
        self.assertEqual(payload,original);self.assertEqual(out['messages'][:-1],original['messages'][:-1])
        self.assertEqual(out['tools'],original['tools']);self.assertEqual(json.loads(out['messages'][-1]['content'])['result']['memories'],[rows[1]])
        self.assertFalse(proof['hidden_state_read']);self.assertEqual(proof['changes'][0]['selected_ids'],['latest'])
        again,_=project(out);self.assertEqual(out,again)
        payload['messages'][-2]['tool_calls'][0]['function']['name']='get_context'
        self.assertEqual(project(payload)[0],payload)


if __name__=='__main__':unittest.main()
