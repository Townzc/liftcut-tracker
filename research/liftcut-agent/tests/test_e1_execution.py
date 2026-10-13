"""E1 deadline, one-shot data and truthful restoration boundaries, no GPU/heldout access."""
from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from d2_execution import aware, read
from e1_data_use import reserve, open_once
from e1_execution import verify_plan, binding, validate_opening, cases_for_run
from e1_power import validate_bound_power
from e1_receipt import fields, validate_index, validate_receipt
from e1_rollout import evaluate
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import Reply
from prepare_e1_execution import development_fixture, scripted_authorization
from recovery_dataset import write_rows
from run_e1_window import finalise
from server_workspace import dump_new, sha256


class E1ExecutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = verify_plan()
        cls.cases = development_fixture()
        cls.catalog = load_catalog(ROOT / 'benchmark/catalog.json')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.payload = self.root / 'development-copies.jsonl'
        write_rows(self.payload, self.cases)
        self.p = deepcopy(self.plan)
        self.p['protocol']['dataset']['test_file_sha256_from_existing_manifest'] = sha256(self.payload)
        self.t = aware('2026-10-14T00:01:00+00:00')
        self.b = binding(self.p, '0' * 40, scripted_authorization(), '20261014-000100', self.t.isoformat())
        self.opening = {'binding': self.b, 'at_utc': self.t.isoformat(), 'evidence_kind': 'scripted_contract'}

    def reservation(self, side='server'):
        return reserve(self.root / 'ledger', self.p['protocol'], self.b, side=side, now=lambda: self.t)

    def opened(self):
        ledger = self.reservation(); run = self.root / 'run'
        dump_new(run / 'opening.json', self.opening)
        open_once(self.payload, ledger, run / 'dataset', self.p['protocol'], self.b, self.catalog, now=lambda: self.t)
        return run, ledger

    def index(self, status='complete'):
        return {'version': 'e1-delta-index-v1', 'binding': self.b, 'status': status,
                'evidence_kind': 'scripted_contract', 'archive_is_self_contained': False,
                'archives': [{'path': 'evidence.tar.gz', 'archive': 'evidence.tar.gz', 'bytes': 20, 'sha256': 'a' * 64}]}

    def test_duplicate_dataset_reservation_rejected_even_with_new_run_id(self):
        self.reservation('local')
        other = {**self.b, 'run_id': '20261014-000101'}
        with self.assertRaises(FileExistsError):
            reserve(self.root / 'ledger', self.p['protocol'], other, side='local', now=lambda: self.t)

    def test_wrong_candidate_cannot_reserve(self):
        b = {**self.b, 'candidate_digest': 'a' * 64}
        with self.assertRaises(ValueError):
            reserve(self.root / 'ledger', self.p['protocol'], b, side='server')

    def test_original_payload_copied_once_and_full_shape_replayed(self):
        run, ledger = self.opened()
        self.assertEqual(cases_for_run(run, self.p, self.catalog), self.cases)
        self.assertEqual((run / 'dataset/cases.jsonl').read_bytes(), self.payload.read_bytes())
        with self.assertRaises(FileExistsError):
            open_once(self.payload, ledger, self.root / 'second', self.p['protocol'], self.b, self.catalog, now=lambda: self.t)

    def test_hash_failure_keeps_consumed_attempt(self):
        ledger = self.reservation()
        self.payload.write_bytes(b'not the registered fixture')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            open_once(self.payload, ledger, self.root / 'dataset', self.p['protocol'], self.b, self.catalog, now=lambda: self.t)
        self.assertTrue(ledger.with_name(ledger.name.replace('reserved-', 'opened-')).is_file())
        self.assertFalse((self.root / 'dataset/data-opened.json').exists())

    def test_local_reservation_cannot_stand_in_for_server(self):
        ledger = self.reservation('local')
        with self.assertRaises(ValueError):
            open_once(self.payload, ledger, self.root / 'dataset', self.p['protocol'], self.b, self.catalog, now=lambda: self.t)

    def test_expired_window_prevents_payload_attempt(self):
        ledger = self.reservation()
        with self.assertRaises(TimeoutError):
            open_once(self.payload, ledger, self.root / 'dataset', self.p['protocol'], self.b, self.catalog,
                      now=lambda: aware(self.b['work_cutoff']))
        self.assertFalse(ledger.with_name(ledger.name.replace('reserved-', 'opened-')).exists())

    def test_mutated_reservation_timing_prevents_replay(self):
        run, _ = self.opened(); path = run / 'dataset/reservation.json'
        record = read(path); record['at_utc'] = (self.t + timedelta(seconds=1)).isoformat()
        path.write_text(json.dumps(record), encoding='utf-8')
        with self.assertRaises(ValueError):
            cases_for_run(run, self.p, self.catalog)

    def test_no_old_night_or_late_opening(self):
        for boot, start in [('2026-10-13T04:27:00+00:00', '2026-10-13T04:28:00+00:00'),
                            ('2026-10-14T00:00:00+00:00', '2026-10-14T00:11:00+00:00')]:
            auth = {**scripted_authorization(), 'booted_at_proxy': boot}
            with self.assertRaises(ValueError):
                binding(self.p, '0' * 40, auth, '20261014-000100', start)

    def test_original_power_budget_and_no_deadline_reset(self):
        self.assertEqual(validate_bound_power(self.b, self.t), aware('2026-10-14T02:00:00+00:00'))
        altered = deepcopy(self.b); altered['hard_cutoff'] = '2026-10-14T02:01:00+00:00'
        with self.assertRaises(ValueError):
            validate_bound_power(altered, self.t)
        altered = deepcopy(self.opening); altered['binding']['work_cutoff'] = '2026-10-14T02:00:00+00:00'
        with self.assertRaises(ValueError):
            validate_opening(altered, self.p, scripted=True)

    def test_scripted_opening_cannot_be_read_as_model(self):
        with self.assertRaises(ValueError):
            validate_opening(self.opening, self.p)

    def test_partial_receipt_never_claims_complete_or_weights_or_model(self):
        value = fields(self.index('partial'), self.b, scripted=True)
        self.assertFalse(value['complete_study_replayed'])
        self.assertFalse(value['actual_external_weight_verified'])
        self.assertFalse(value['model_result'])
        self.assertEqual(value['episodes_replayed'], 0)
        self.assertTrue(value['partial_data_use_unknown'])

    def test_synthetic_receipt_rejects_promoted_model_flag_and_duplicate_keys(self):
        index = self.index(); value = {**fields(index, self.b, scripted=True), 'verified_files': 9}
        validate_receipt(json.dumps(value), index, self.b, scripted=True)
        value['model_result'] = True
        with self.assertRaises(ValueError):
            validate_receipt(json.dumps(value), index, self.b, scripted=True)
        value['model_result'] = False
        text = json.dumps(value)[:-1] + ',"model_result":false}'
        with self.assertRaises(ValueError):
            validate_receipt(text, index, self.b, scripted=True)

    def test_archive_size_bounds_reject_large_delta(self):
        index = self.index(); index['archives'][0]['bytes'] = 50_000_001
        with self.assertRaises(ValueError):
            validate_index(index, self.b, scripted=True)

    def test_unknown_usage_stops_after_first_task_and_keeps_trace(self):
        class MissingUsage:
            def complete(self, payload):
                return Reply('{"choices":[{"message":{"content":"done"}}]}', 200, None, 0)
        with self.assertRaisesRegex(ValueError, 'unknown usage'):
            evaluate(self.root / 'episodes', self.cases, self.catalog, lambda _callback: MissingUsage(), 'D')
        self.assertEqual(len(read_jsonl(self.root / 'episodes/episodes.jsonl')), 1)
        self.assertEqual(len(read_jsonl(self.root / 'episodes/calls.jsonl')), 1)

    def test_archive_failure_still_requests_shutdown(self):
        run = self.root / 'run'; run.mkdir(); powers = []
        class Clock:
            def now(_): return self.t
        def broken(_): raise OSError('simulated disk failure')
        with self.assertRaises(OSError):
            finalise(run, self.root / 'ops', 'partial', [], self.b, Clock(), scripted=True,
                     sleep=lambda _: None, archive=broken, power=lambda *args: powers.append(args))
        self.assertEqual(len(powers), 1)

    def test_collection_wait_uses_original_cutoff_not_a_new_rolling_limit(self):
        run = self.root / 'run'; run.mkdir(); powers = []; tick = [self.t]
        class Clock:
            def now(_): return tick[0]
        def sleep(seconds): tick[0] += timedelta(seconds=seconds)
        item = self.index()['archives'][0].copy(); item.pop('path')
        finalise(run, self.root / 'ops', 'partial', [], self.b, Clock(), scripted=True,
                 sleep=sleep, archive=lambda _: item, power=lambda *args: powers.append(args))
        self.assertEqual(tick[0], aware(self.b['collection_cutoff']) - timedelta(seconds=8))
        self.assertFalse(read(run / 'backup-copy-status.json')['off_instance_acknowledged'])
        self.assertEqual(len(powers), 1)


if __name__ == '__main__':
    unittest.main()
