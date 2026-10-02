"""Historical partial evidence stays distinct from a complete study or new GPU work."""
from copy import deepcopy
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
import analyze_d2_partial as review
from d2_execution import REVIEWED, ordered_cases, read
from counterfactual_diagnostics import fixtures
from liftcut_agent.benchmark import load_catalog, read_jsonl

PUBLIC = ROOT / 'reports/d2-partial-s0-2026-10-02'


class PartialReviewTests(unittest.TestCase):
    def test_semantic_change_cannot_hide_inside_operational_amendment(self):
        current = read(REVIEWED)
        with patch.object(review, 'verify_plan', return_value=current):
            old = review.verify_amendment(Path('synthetic-unused'))
        self.assertEqual(old['execution_case_ids'], current['execution_case_ids'])
        for field,value in (('max_requests',545),('fixed_adapter_seed',44),('estimate',{})):
            changed=deepcopy(current)
            changed[field]=value
            with patch.object(review,'verify_plan',return_value=changed),self.assertRaises(ValueError):
                review.verify_amendment(Path('synthetic-unused'))

    def test_archived_bytes_and_genuine_partial_receipt_are_not_upgraded(self):
        run=PUBLIC/'run'
        inventory=read(run/'backup-inventory.json')['files']
        for row in inventory:
            raw=(run/row['path']).read_bytes()
            self.assertEqual(len(raw),row['bytes'])
            self.assertEqual(hashlib.sha256(raw).hexdigest(),row['sha256'])
        receipt=read(PUBLIC/'partial-receipt.json')
        derived=read(PUBLIC/'review.json')
        self.assertFalse(receipt['complete_study_replayed'] or receipt['token_ids_verified'] or receipt['model_result'])
        self.assertEqual(receipt['episodes_replayed'],0)
        self.assertEqual(derived['episodes_replayed'],80)
        self.assertEqual(derived['unrun_cases'],240)
        self.assertFalse(derived['partial_receipt_upgraded'] or derived['g1']['evaluated'])

    def test_identity_equal_totals_do_not_erase_opposing_case_flips(self):
        saved=read(PUBLIC/'review.json')
        cases=ordered_cases(fixtures(load_catalog(ROOT/'benchmark/catalog.json')))
        episodes=read_jsonl(PUBLIC/'run/evaluation/s0/episodes.jsonl')
        actual=review.describe({'case_results':saved['case_results']},cases,episodes)
        self.assertEqual(actual['identity_pairs'],saved['identity_pairs'])
        pairs=actual['identity_pairs']
        self.assertEqual(sum(p['original_correct'] for p in pairs),sum(p['renamed_correct'] for p in pairs))
        self.assertEqual(sum(p['score_flip'] for p in pairs),2)
        self.assertIsNone(actual['paired_treatment_effects'])
        self.assertFalse(actual['g1']['evaluated'])

    def test_cost_proxy_and_publication_are_derived_from_raw_events(self):
        ops=read(PUBLIC/'operations-summary.json')
        rows=read_jsonl(PUBLIC/'operations.jsonl')
        event=lambda name:next(row for row in rows if row['event']==name)
        self.assertEqual(ops['receipt_sha256'],event('receipt_atomic_published')['receipt_sha256'])
        self.assertEqual(ops['receipt_sha256'],hashlib.sha256((PUBLIC/'partial-receipt.json').read_bytes()).hexdigest())
        seconds=(datetime.fromisoformat(event('launcher_or_collector_stopped')['at_utc'])
                 -datetime.fromisoformat(ops['binding']['booted_at_proxy'])).total_seconds()
        self.assertEqual(seconds,ops['budget']['boot_to_connection_loss_seconds'])
        self.assertEqual(seconds/3600*ops['budget']['hourly_cny_assumed'],ops['budget']['compute_proxy_cny'])
        self.assertEqual(ops['server_ack_consumption'],'unobserved')


if __name__ == '__main__':
    unittest.main()
