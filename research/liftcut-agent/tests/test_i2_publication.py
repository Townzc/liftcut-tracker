import hashlib
import json
import os
from pathlib import Path
import sys
import subprocess
import shutil
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from analyze_i2_results import factorial,decoded_actions
from publish_i2_results import inventory,WEIGHT,EXECUTION,verify_complete,verify_handoff
from plot_i2_results import plot
from analyze_i2_failures import classify,generation_pair


class I2PublicationTests(unittest.TestCase):
    def test_actual_late_receipt_keeps_original_missed_consumption_visible(self):
        public=Path(__file__).resolve().parents[1]/'reports/i2-seed42-2026-10-13'
        result=verify_handoff(public)
        self.assertFalse(result['original_controller_consumed'])
        verified=result['separate_server_verification']
        self.assertTrue(verified['actual_remote_weights_verified'])
        self.assertEqual(verified['receipt']['episodes_replayed'],444)
        self.assertEqual(verified['new_receipts_created'],0)
        self.assertEqual(verified['remote_files_modified'],0)

    def test_late_receipt_cannot_hide_missing_inspection_wrong_hash_or_expired_window(self):
        public=Path(__file__).resolve().parents[1]/'reports/i2-seed42-2026-10-13'
        for mutation in ('missing','hash','deadline','rewrite_old_status'):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d)
                for name in ('operations.jsonl','backup-copy-status.json','restore-receipt.json','backup-index.json','window-close.json'):
                    shutil.copyfile(public/name,root/name)
                shutil.copytree(public/'receipt-inspection',root/'receipt-inspection')
                folder=root/'receipt-inspection'
                if mutation=='missing':
                    (folder/'verified.json').unlink()
                elif mutation=='rewrite_old_status':
                    path=root/'backup-copy-status.json';row=json.loads(path.read_text());row['off_instance_acknowledged']=True
                    path.write_text(json.dumps(row))
                else:
                    row=json.loads((folder/'verified.json').read_text())
                    if mutation=='hash':row['receipt_sha256']='0'*64
                    if mutation=='deadline':row['at_utc']='2026-10-13T07:05:00+00:00'
                    for name in ('verified.json','stdout.json'):(folder/name).write_text(json.dumps(row))
                with self.assertRaises((ValueError,FileNotFoundError)):verify_handoff(root)

    def test_equal_decoded_text_does_not_hide_different_tokens_or_skipped_generation(self):
        first={'model_called':True,'prompt_tokens':100,'output_ids':[1,2],'raw_text':'same'}
        second={**first,'output_ids':[3,2]}
        result=generation_pair(first,second)
        self.assertTrue(result['native_raw_text_identical'])
        self.assertFalse(result['actual_output_ids_identical'])
        self.assertEqual(result['generated_token_counts'],[2,2])
        skipped={'model_called':False,'prompt_tokens':0,'output_ids':[],'raw_text':None}
        self.assertIsNone(generation_pair(skipped,skipped)['actual_output_ids_identical'])

    def test_entrypoints_work_without_inherited_pythonpath(self):
        root=Path(__file__).resolve().parents[1];env=dict(os.environ);env.pop('PYTHONPATH',None)
        for name in ('publish_i2_results.py','analyze_i2_results.py','analyze_i2_failures.py','plot_i2_results.py'):
            result=subprocess.run([sys.executable,str(root/name),'--help'],env=env,capture_output=True,text=True,check=True)
            self.assertIn('usage:',result.stdout)

    def test_partial_scripted_or_wrong_execution_never_reaches_actual_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            for status,kind,commit in [('partial','model',EXECUTION),('complete','scripted_contract',EXECUTION),('complete','model','a'*40)]:
                index={'version':'i2-backup-v1','binding':{'code_commit':commit},'evidence_kind':kind,'status':status,
                       'archives':[{'archive':'evidence.tar.gz','path':'evidence.tar.gz','bytes':1,'sha256':'a'*64}]}
                (p/'index.json').write_text(json.dumps(index),encoding='utf-8')
                with patch('publish_i2_results.audit') as auditor:
                    with self.assertRaises(ValueError):verify_complete(p,p/'index.json',p/'missing',p,p,p)
                    auditor.assert_not_called()

    def test_failure_labels_do_not_treat_right_value_or_missing_action_as_source_error(self):
        self.assertEqual(classify(['machine'],['dumbbell'],['machine'],['machine'],1),
                         'effective_value_selected_but_other_requirement_failed')
        self.assertEqual(classify(['machine'],['dumbbell'],['machine'],None,1),
                         'latest_memory_value_selected_but_other_requirement_failed')
        self.assertEqual(classify(['dumbbell'],['dumbbell'],['machine'],['machine'],1),
                         'raw_context_value_selected')
        self.assertEqual(classify(None,[],['machine'],None,0),'no_single_valid_plan_member')

    def test_native_invalid_arguments_are_retained_for_failure_analysis(self):
        body={'choices':[{'message':{'tool_calls':[{'function':{'name':'validate_plan','arguments':'malformed'}}]}}]}
        self.assertEqual(decoded_actions({'body':json.dumps(body)}),[{'tool':'validate_plan','arguments':'malformed'}])
        body['choices'][0]['message']['tool_calls'][0]['function']['arguments']='{"plan":{"evidence_ids":["ev_x"]}}'
        self.assertEqual(decoded_actions({'body':json.dumps(body)})[0]['arguments']['plan']['evidence_ids'],['ev_x'])

    def test_factorial_edges_and_interaction_are_not_conflated(self):
        r=factorial({'A':60,'B':65,'C':80,'D':92})
        self.assertEqual(r['N_without_R'],5);self.assertEqual(r['N_with_R'],12)
        self.assertEqual(r['average_N_gain_cases'],8.5);self.assertEqual(r['average_R_gain_cases'],23.5)
        self.assertEqual(r['interaction_gain_cases'],7)
        self.assertEqual(factorial({'A':100,'B':95,'C':90,'D':80})['interaction_gain_cases'],-5)

    def test_incomplete_or_fractional_counts_rejected(self):
        for counts in ({'A':1},{'A':0,'B':0,'C':0,'D':112},{'A':1.,'B':0,'C':0,'D':0}):
            with self.assertRaises(ValueError):factorial(counts)

    def test_inventory_allows_only_the_declared_private_weight_omission(self):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d);data=b'scripted metadata';p=r/'safe.json';p.write_bytes(data)
            rows=[{'path':'safe.json','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()},
                  {'path':WEIGHT,'bytes':1,'sha256':'a'*64}]
            (r/'backup-inventory.json').write_text(json.dumps({'files':rows}))
            inventory(r,metadata_only=True)
            with self.assertRaises(ValueError):inventory(r)
            p.write_bytes(b'changed')
            with self.assertRaises(ValueError):inventory(r,metadata_only=True)

    def test_unsafe_inventory_path_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d);(r/'backup-inventory.json').write_text(json.dumps({'files':[{'path':'../escape','bytes':1,'sha256':'a'*64}]}))
            with self.assertRaises(ValueError):inventory(r,metadata_only=True)

    def test_scripted_report_cannot_be_plotted_as_real_result(self):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d);p=r/'report.json'
            p.write_text(json.dumps({'version':'i2-results-review-v1','model_result':False}))
            with self.assertRaises(ValueError):plot(p,r/'figures')


if __name__=='__main__':unittest.main()
