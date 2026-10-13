"""Mutations must fail dual native/original audits; expected tokens are unit stubs."""
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from i2_rollout import ProjectedTransport, audit_projected_calls
from i2_view import project
from liftcut_agent.model_policy import encode
from test_i1_rollout import NativeStub, TestTokenizer
from test_i2_view import payload


class Tokens(TestTokenizer):
    def __init__(self,raw):self.raw=raw
    def decode(self,ids,**kw):return self.raw
    def apply_chat_template(self,messages,**kw):return list(range(len(json.dumps(messages,sort_keys=True))//5))


class DualAuditTests(unittest.TestCase):
    def sample(self,unknown=False):
        p=payload();_,proof=project(p,'D')
        alias='unknown' if unknown else proof['evidence_mapping']['forward']['latest']
        raw='<tool_call>'+encode({'name':'validate_plan','arguments':{'plan':{'evidence_ids':[alias]}}})+'</tool_call><|im_end|>'
        tokenizer=Tokens(raw);inner=NativeStub(tokenizer);inputs=[];responses=[]
        transport=ProjectedTransport(inner,'D',inputs.append,responses.append)
        reply=transport.complete(p);transport.advance();self.assertEqual(inner.advanced,1)
        call={'request':p,'response':asdict(reply)}
        return [call],inner.generations,inputs,responses,tokenizer

    def test_native_alias_and_environment_original_id_are_both_verified(self):
        calls,gens,inputs,responses,tok=self.sample()
        result=audit_projected_calls(calls,gens,inputs,responses,tok,'D')
        self.assertEqual(result['input_records'],1);self.assertEqual(result['unknown_alias_rejections'],0)
        self.assertNotEqual(responses[0]['native_response'],responses[0]['environment_response'])
        bad=deepcopy(responses);bad[0]['environment_response']=bad[0]['native_response']
        with self.assertRaises(ValueError):audit_projected_calls(calls,gens,inputs,bad,tok,'D')

    def test_unknown_new_alias_is_counted_as_rejection_with_raw_output_retained(self):
        calls,gens,inputs,responses,tok=self.sample(True)
        result=audit_projected_calls(calls,gens,inputs,responses,tok,'D')
        self.assertEqual(result['unknown_alias_rejections'],1)
        self.assertIn('unknown',gens[0]['raw_text'])
        self.assertEqual(json.loads(calls[0]['response']['body'])['choices'][0]['message']['tool_calls'],[])

    def test_tampered_projection_native_tokens_counts_and_mappings_are_rejected(self):
        calls,gens,inputs,responses,tok=self.sample()
        for field in ('original_request','model_request'):
            bad=deepcopy(inputs);bad[0][field]['messages'][0]['content']='changed'
            with self.assertRaises(ValueError):audit_projected_calls(calls,gens,bad,responses,tok,'D')
        bad=deepcopy(inputs);bad[0]['projection']['evidence_mapping']['inverse']={}
        with self.assertRaises(ValueError):audit_projected_calls(calls,gens,bad,responses,tok,'D')
        bad=deepcopy(gens);bad[0]['prompt_tokens']+=1
        with self.assertRaises(ValueError):audit_projected_calls(calls,bad,inputs,responses,tok,'D')
        with self.assertRaises(ValueError):audit_projected_calls(calls,gens,inputs,[],tok,'D')
        with self.assertRaises(ValueError):audit_projected_calls(calls,gens,inputs,responses,tok,'B')


if __name__=='__main__':unittest.main()
