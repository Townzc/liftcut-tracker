"""I1 publication boundaries: genuine model evidence, one weight omission, raw/view provenance."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from publish_i1_results import EXECUTION,WEIGHT,inventory,verify_complete,publication_integrity,publish
from plot_i1_results import plot
from server_workspace import sha256


def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value),encoding='utf-8')


def index(status='complete',kind='model',commit=EXECUTION):
    return {'version':'i1-backup-v1','binding':{'code_commit':commit},'evidence_kind':kind,'status':status,
            'archives':[{'archive':'evidence.tar.gz','path':'evidence.tar.gz','bytes':1,'sha256':'a'*64}]}


def sample_inventory(run):
    rows=[]
    for name in ('evidence.json',WEIGHT):
        path=run/name;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(b'SYNTHETIC UNIT BYTES, NOT MODEL WEIGHTS')
        rows.append({'path':name,'bytes':path.stat().st_size,'sha256':sha256(path)})
    save(run/'backup-inventory.json',{'files':rows})
    return rows


class I1PublicationTests(unittest.TestCase):
    def test_entrypoints_are_independent_of_inherited_pythonpath(self):
        env=dict(os.environ);env.pop('PYTHONPATH',None)
        for name in ('publish','analyze','plot'):
            result=subprocess.run([sys.executable,str(ROOT/(name+'_i1_results.py')),'--help'],
                                  env=env,capture_output=True,text=True,check=True)
            self.assertIn('usage:',result.stdout)

    def test_partial_scripted_or_wrong_execution_never_reaches_actual_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            for status,kind,commit in [('partial','model',EXECUTION),('complete','scripted_contract',EXECUTION),('complete','model','a'*40)]:
                save(p/'index.json',index(status,kind,commit))
                with patch('publish_i1_results.audit') as auditor:
                    with self.assertRaises(ValueError):verify_complete(p,p/'index.json',p/'missing',p,p,p)
                    auditor.assert_not_called()

    def test_inventory_can_omit_only_the_single_preselected_weight(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);sample_inventory(p)
            self.assertEqual(len(inventory(p)),2)
            (p/WEIGHT).unlink()
            self.assertEqual(len(inventory(p,metadata_only=True)),2)
            with self.assertRaises(ValueError):inventory(p)
            (p/'untracked.json').write_text('unexpected')
            with self.assertRaises(ValueError):inventory(p,metadata_only=True)
            (p/'untracked.json').unlink();(p/'evidence.json').write_text('tampered')
            with self.assertRaises(ValueError):inventory(p,metadata_only=True)

    def test_duplicate_or_unsafe_inventory_names_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);rows=sample_inventory(p)
            for bad in ('../escape','/absolute','reference\\bad','evidence.json'):
                save(p/'backup-inventory.json',{'files':rows+[dict(rows[0],path=bad)]})
                with self.assertRaises(ValueError):inventory(p)

    def test_public_provenance_cannot_omit_original_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);run=p/'run';rows=sample_inventory(run);(run/WEIGHT).unlink()
            save(p/'restore-receipt.json',{'unit_only':True});save(p/'backup-index.json',index())
            rec={'version':'i1-publication-v1','episodes_replayed':222,'actual_weights_checked_before_publication':True,
                 'projection_inputs_verified':True,'new_receipts_created':0,'new_model_calls':0,'test_episodes':0,
                 'public_files_sha256':{'run/evidence.json':sha256(run/'evidence.json')},
                 'omitted_weight_file':{WEIGHT:{k:rows[1][k] for k in ('bytes','sha256')}},
                 'original_receipt_sha256':sha256(p/'restore-receipt.json'),'binding':index()['binding']}
            save(p/'publication.json',rec)
            with self.assertRaisesRegex(ValueError,'provenance'):publication_integrity(p)
            with patch('publish_i1_results.verify_complete') as auditor:
                with self.assertRaisesRegex(ValueError,'new publication'):publish(p,p,p,p,p,p,p)
                auditor.assert_not_called()

    def test_plot_rejects_scripted_partial_and_new_training_claims(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            for model,count,training,system in [(False,222,False,True),(True,111,False,True),(True,222,True,True),(True,222,False,False)]:
                save(p/'review.json',{'version':'i1-results-review-v1','model_result':model,
                    'episodes_replayed':count,'new_training':training,'system_intervention':system})
                with self.assertRaises(ValueError):plot(p/'review.json',p/'figures')
            self.assertFalse((p/'figures').exists())


if __name__=='__main__':unittest.main()
