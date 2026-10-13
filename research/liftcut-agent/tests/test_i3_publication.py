"""Publication faults and descriptive pairing only; no model or cloud connection."""
from copy import deepcopy
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
if ROOT.name=='i3-publication-drafts':ROOT=ROOT.parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from publish_i3_results import inventory,verify_handoff,publication_integrity,EXECUTION,CAPTURES
from analyze_i3_results import describe
from server_workspace import dump_new,sha256
from test_research_lease import lease


class I3PublicationTests(unittest.TestCase):
    def test_all_inventoried_bytes_required_and_weights_must_stay_external(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'sample.json';p.write_bytes(b'{}')
            row={'path':'sample.json','bytes':2,'sha256':sha256(p)}
            dump_new(root/'backup-inventory.json',{'files':[row]})
            self.assertEqual(len(inventory(root)),1)
            p.write_bytes(b'[]')
            with self.assertRaises(ValueError):inventory(root)
            p.write_bytes(b'{}');(root/'unexpected.safetensors').write_bytes(b'private')
            with self.assertRaises(ValueError):inventory(root)

    def fixture(self,root):
        b={'trial_started_at_utc':'2026-10-13T08:00:00+00:00','collection_cutoff':'2026-10-13T08:40:00+00:00','power_lease':lease()}
        dump_new(root/'backup-index.json',{'binding':b});receipt={'SCRIPTED_UNIT_ONLY':True};dump_new(root/'restore-receipt.json',receipt)
        h=sha256(root/'restore-receipt.json');status={'off_instance_acknowledged':True}
        close={'at_utc':'2026-10-13T08:10:03+00:00','off_instance_acknowledged':True,
            'power_action':'retain_under_original_overnight_guard','shutdown_at_utc':lease()['shutdown_at_utc']}
        dump_new(root/'backup-copy-status.json',status);dump_new(root/'window-close.json',close)
        events=[{'event':'off_instance_verified','at_utc':'2026-10-13T08:10:00+00:00','receipt':receipt},
            {'event':'receipt_atomic_published','at_utc':'2026-10-13T08:10:01+00:00','receipt_sha256':h},
            {'event':'collector_finished','at_utc':'2026-10-13T08:10:04+00:00',
             'result':{'server_consumed':True,'receipt_transfer':{'receipt_sha256':h},'window_close':close}}]
        server=[{'event':'server_receipt_consumed','at_utc':'2026-10-13T08:10:02+00:00','receipt_sha256':h,'status':'complete'}]
        return events,server

    def test_consumption_requires_server_hash_evidence_and_original_cutoff(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);events,server=self.fixture(root)
            def write():
                for name,rows in [('operations.jsonl',events),('server-events-latest.jsonl',server)]:
                    (root/name).write_text('\n'.join(json.dumps(r) for r in rows)+'\n')
            write();self.assertTrue(verify_handoff(root)['original_server_consumed'])
            server[0]['receipt_sha256']='wrong';write()
            with self.assertRaises(ValueError):verify_handoff(root)
            server[0]['receipt_sha256']=sha256(root/'restore-receipt.json');server[0]['at_utc']='2026-10-13T08:41:00+00:00';write()
            with self.assertRaises(ValueError):verify_handoff(root)

    def test_missed_server_consumption_cannot_be_summarized_as_success(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);events,server=self.fixture(root)
            events[-1]['result']['server_consumed']=False
            for name,rows in [('operations.jsonl',events),('server-events-latest.jsonl',server)]:
                (root/name).write_text('\n'.join(json.dumps(r) for r in rows)+'\n')
            with self.assertRaises(ValueError):verify_handoff(root)

    def test_published_receipt_cannot_be_removed_from_hash_contract(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);run=root/'run';run.mkdir()
            dump_new(run/'backup-inventory.json',{'files':[]})
            for name in {'backup-index.json','restore-receipt.json','independent-audit.json','operations.jsonl',*CAPTURES}:
                (root/name).write_bytes(b'{}')
            value={'version':'i3-publication-v1','execution_commit':EXECUTION,'archive_is_self_contained':False,
                'actual_parent_weight_verified_at_publication':True,'model_result':True,'episodes_replayed':64,
                'business_anchors':8,'heldout_tasks':0,'independent_generalization':False,
                'raw_sha256':{p.relative_to(root).as_posix():sha256(p) for p in root.rglob('*') if p.is_file()}}
            dump_new(root/'publication-manifest.json',value)
            publication_integrity(root)
            del value['raw_sha256']['restore-receipt.json']
            (root/'publication-manifest.json').write_text(json.dumps(value))
            with self.assertRaises(ValueError):publication_integrity(root)

    def test_descriptive_report_keeps_group_dependency_and_candidate_failure(self):
        row={'case_id':'unit','anchor_case_id':'anchor','factors':{'codebook':'test','rotation':0,'clarification':False,'anchor_index':0},
             'decision':{'correct':False},'policy_failure':None,'actual_input_digest':'a','actual_output_token_digest':'b',
             'native_response':{},'environment_response':{},'inverse_mapping_status':'mapped'}
        arm={'rows':[row],'correct':0,'unique_projected_inputs':1,'identity_score_flip_groups':0,
             'codebook_groups':[{'all_generated':True,'distinct_actual_inputs':1,'distinct_actual_output_tokens':1}],
             'autonomous_blocked_writes':0,'native':{'tokens':{},'raw_prompt_tokens_at_same_visited_states':100,'unknown_alias_rejections':0}}
        result={'arms':{'C':deepcopy(arm),'D':deepcopy(arm)},'comparison':{'diagnostic_passed':False,'preselected_candidate':'D'}}
        r=describe(result)
        self.assertFalse(r['paired']['diagnostic_passed']);self.assertFalse(r['independent_generalization'])
        self.assertEqual(r['business_anchors'],8);self.assertEqual(r['arms']['D']['failures'][0]['case_id'],'unit')
        self.assertEqual(r['arms']['D']['strata']['clarification']['False']['n'],1)


if __name__=='__main__':unittest.main()
