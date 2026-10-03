"""Publication must retain complete paired data and distinguish receipts from billing."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from analyze_g4_results import compare,paired_normal,operations
from liftcut_agent.benchmark import read_jsonl
from plot_g4_results import plot
from publish_g4_results import ARMS,EXECUTION,WEIGHTS,verify_complete,verify_inventory
from server_workspace import sha256


def save(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(obj),encoding='utf-8')


class G4PublicationTests(unittest.TestCase):
    def test_entrypoints_bootstrap(self):
        env=dict(os.environ);env.pop('PYTHONPATH',None)
        for name in ('publish','analyze','plot'):
            result=subprocess.run([sys.executable,str(ROOT/(name+'_g4_results.py')),'--help'],env=env,capture_output=True,text=True,check=True)
            self.assertIn('usage:',result.stdout)

    def test_scripted_partial_old_execution_cannot_become_model_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            for status,kind,commit in [('partial','model',EXECUTION),('complete','scripted_contract',EXECUTION),('complete','model','a'*40)]:
                save(p/'index.json',{'status':status,'evidence_kind':kind,'binding':{'code_commit':commit}})
                with self.assertRaisesRegex(ValueError,'complete real-model'):verify_complete(p,p/'index.json',p/'missing',p,p,p,p)

    def test_only_actual_two_weights_can_be_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            for prefix in ('',*(f'training/{a}/' for a in ARMS)):
                rows=[]
                for name in (['data.json'] if not prefix else ['report.json','final/adapter_model.safetensors']):
                    path=p/prefix/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'unit-container-only')
                    rows.append({'path':name,'bytes':path.stat().st_size,'sha256':sha256(path)})
                save(p/prefix/'backup-inventory.json',{'files':rows})
            self.assertEqual(verify_inventory(p),5)
            for name in WEIGHTS:(p/name).unlink()
            self.assertEqual(verify_inventory(p,metadata_only=True),5)
            (p/'data.json').write_text('changed')
            with self.assertRaises(ValueError):verify_inventory(p,metadata_only=True)

    def test_all111_comparisons_preserve_losses_and_new_control_names(self):
        source=ROOT/'reports/g3-seed42-2026-10-03/run/evaluation/stop_half'
        before={p:read_jsonl(source/p/'episodes.jsonl') for p in ('normal','diagnostic','d2')}
        after=deepcopy(before)
        for panel in before:
            outcome=after[panel][0]['trace']['score'] if panel=='normal' else after[panel][0]['decision']
            key='passed' if panel=='normal' else 'correct';outcome[key]=not outcome[key]
        result=compare(before,after);self.assertEqual(len(result['rows']),111)
        self.assertEqual(len(result['gained'])+len(result['lost']),3)
        self.assertTrue(all('first_different_control_action' in r for r in result['rows']))
        normal=paired_normal(before['normal'],after['normal'])
        self.assertEqual(set(normal['arms']),{'control','permuted'})
        with self.assertRaises(ValueError):compare(before,{**after,'d2':after['d2'][:-1]})

    def test_real_server_consumption_is_separate_from_power_and_cumulative_cost(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);receipt={'unit':'not-model-evidence'};save(p/'restore-receipt.json',receipt)
            status={'off_instance_acknowledged':True};save(p/'backup-copy-status.json',status)
            end='2026-10-03T10:00:00+00:00'
            rows=[{'event':'off_instance_verified','receipt':receipt},
                  {'event':'receipt_atomic_published','receipt_sha256':sha256(p/'restore-receipt.json')},
                  {'event':'server_receipt_observed','value':status},
                  {'event':'collector_finished','at_utc':end}]
            (p/'operations.jsonl').write_text('\n'.join(json.dumps(x) for x in rows));(p/'server-events.jsonl').write_text('')
            bind={'trial_started_at_utc':'2026-10-03T08:00:00+00:00','booted_at_proxy':'2026-10-03T05:35:00.409447+00:00','collection_cutoff':'2026-10-03T10:45:00+00:00'}
            actual=operations(p,bind)
            self.assertFalse(actual['provider_billing_stopped']);self.assertFalse(actual['final_overnight_cost'])
            self.assertTrue(actual['do_not_add_trial_and_cumulative_costs'])
            self.assertAlmostEqual(actual['trial_start_to_collection_cost_proxy_cny'],4.36)
            self.assertIsNone(actual['server_consumption']['event'])
            self.assertGreater(actual['cumulative_cost_proxy_cny_including_prior_failed_opening'],4.36)
            rows[1]['receipt_sha256']='a'*64
            (p/'operations.jsonl').write_text('\n'.join(json.dumps(x) for x in rows))
            with self.assertRaises(ValueError):operations(p,bind)

    def test_plot_rejects_scripted_partial_or_no_fresh_control(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            for model,count,fresh in [(False,222,True),(True,111,True),(True,222,False)]:
                save(p/'review.json',{'version':'g4-results-review-v1','model_result':model,'episodes_replayed':count,'gates':{'fresh_control_used':fresh}})
                with self.assertRaises(ValueError):plot(p/'review.json',p/'figures')
            self.assertFalse((p/'figures').exists())


if __name__=='__main__':unittest.main()
