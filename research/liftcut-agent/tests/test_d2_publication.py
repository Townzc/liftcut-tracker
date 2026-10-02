"""Keep partial/scripted evidence, repeated cases and operational claims honest."""
from copy import deepcopy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT/'src')]
from analyze_d2_results import compare_repeated_s0, operational_evidence, timing
from publish_d2_results import verify_complete, verify_inventory

OLD = ROOT/'reports/d2-partial-s0-2026-10-02'


class PublicationTests(unittest.TestCase):
    def test_actual_partial_archive_cannot_become_complete_publication(self):
        with self.assertRaisesRegex(ValueError, 'complete real-model'):
            verify_complete(OLD/'run', OLD/'backup-index.json', OLD/'partial-receipt.json',
                            Path('not-used'), Path('not-used'), metadata_only=True)

    def test_inventory_rejects_extra_file_or_byte_change(self):
        with tempfile.TemporaryDirectory() as temp:
            run=Path(temp)/'run'
            shutil.copytree(OLD/'run',run)
            self.assertEqual(verify_inventory(run),15)
            extra=run/'untracked-result.json'
            extra.write_text('{}',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'exact run'):
                verify_inventory(run)
            extra.unlink()
            (run/'window-status.json').write_text('{}',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'integrity'):
                verify_inventory(run)

    def test_zero_net_repeat_still_reports_opposing_case_changes(self):
        old=[{'case_id':str(i),'decision':{'correct':i % 2 == 0}} for i in range(80)]
        current=deepcopy(old)
        current[0]['decision']['correct']=False
        current[1]['decision']['correct']=True
        result=compare_repeated_s0(current,old)
        self.assertEqual(result['changed_decision_cases'],['0','1'])
        self.assertEqual(result['gains'],['1'])
        self.assertEqual(result['losses'],['0'])
        with self.assertRaisesRegex(ValueError,'same ordered'):
            compare_repeated_s0(current[::-1],old)

    def test_client_disconnect_does_not_confirm_provider_shutdown(self):
        with tempfile.TemporaryDirectory() as temp:
            public=Path(temp)
            for src,dest in (('operations.jsonl','operations.jsonl'),('partial-receipt.json','restore-receipt.json')):
                shutil.copyfile(OLD/src,public/dest)
            shutil.copyfile(OLD/'run/events.jsonl',public/'server-events.jsonl')
            binding=json.loads((OLD/'partial-receipt.json').read_text(encoding='utf-8'))['binding']
            result=operational_evidence(public,binding)
            self.assertEqual(result['provider_billing_stopped'],'unconfirmed')
            self.assertEqual(result['shutdown_return'],'unobserved')
            self.assertEqual(result['server_receipt_consumption'],'unobserved')
            self.assertAlmostEqual(result['compute_proxy_cny'],0.2619853440666667)
            self.assertIsNone(result['actual_provider_cost_cny'])

    def test_latency_excludes_local_guards_from_generation_distribution(self):
        result=timing([{'model_called':True,'elapsed_seconds':x} for x in (1.,2.,3.)]
                      +[{'model_called':False,'elapsed_seconds':0.}])
        self.assertEqual(result['actual_generations'],3)
        self.assertEqual(result['median_generation_seconds'],2.)
        self.assertEqual(result['nearest_rank_p95_generation_seconds'],3.)


if __name__=='__main__':
    unittest.main()
