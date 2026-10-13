"""Offline negative gates: no model, no SSH, no cloud power action."""
import copy
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from protocol import validate_binding, validate_ack
from native import Native, audit
from restore import seal, verify_inventory, restore
from worker import request_shutdown
from relay import drive


def binding():
    boot = datetime(2026, 10, 13, 22, tzinfo=timezone.utc)
    return {'study': 'p1-model-tools-v1', 'runId': 'p1m-20261013-220000', 'opening': boot.isoformat(),
            **{k: (boot + timedelta(minutes=m)).isoformat() for k, m in [('workCutoff', 60), ('collectionCutoff', 80), ('hardCutoff', 90)]},
            'hourlyCny': 2.18, 'reserveCny': 4, 'authorizationSha256': 'a'*64, 'manifestSha256': 'b'*64, 'codeCommit': 'c'*40}


class ProtocolTests(unittest.TestCase):
    def test_lost_ssh_output_cannot_skip_shutdown_request(self):
        from types import SimpleNamespace
        events, commands = [], []
        def emit(_): raise BrokenPipeError('synthetic disconnected output')
        def runner(*args, **kwargs): commands.append((args, kwargs)); return SimpleNamespace(returncode=0)
        request_shutdown(['SYNTHETIC_NO_EXECUTION'], lambda name, **fields: events.append((name, fields)), emit, runner)
        self.assertEqual(len(commands), 1); self.assertEqual(events[-1], ('shutdown_returned', {'returncode': 0}))

    def test_deadlines_cannot_extend(self):
        original = binding(); validate_binding(original)
        for key in ('workCutoff', 'collectionCutoff', 'hardCutoff'):
            bad = copy.deepcopy(original); bad[key] = (datetime.fromisoformat(bad[key])+timedelta(seconds=1)).isoformat()
            with self.assertRaises(ValueError): validate_binding(bad)

    def test_old_or_future_opening_cannot_dispatch(self):
        original = binding(); boot = datetime.fromisoformat(original['opening'])
        validate_binding(original, launch=True, clock=boot+timedelta(minutes=5))
        for delta in (-1, 601):
            with self.assertRaises(ValueError): validate_binding(original, launch=True, clock=boot+timedelta(seconds=delta))

    def test_previous_study_or_missing_authorization_hash_rejected(self):
        for key, value in [('study', 'e1'), ('reserveCny', 25), ('authorizationSha256', None), ('codeCommit', 'main')]:
            bad = binding(); bad[key] = value
            with self.assertRaises((ValueError, TypeError)): validate_binding(bad)

    def test_scripted_or_partial_receipt_cannot_be_acked(self):
        for receipt in ({'status': 'partial'}, {'status': 'complete', 'kind': 'scripted', 'complete_model_receipt': False}):
            with self.assertRaises(ValueError): validate_ack(receipt, binding(), {})

    def test_inventory_rejects_modified_and_unlisted_files(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); (p/'record.json').write_text('{}'); seal(p); verify_inventory(p)
            (p/'record.json').write_text('{"different":true}')
            with self.assertRaises(ValueError): verify_inventory(p)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); seal(p); (p/'extra.json').write_text('{}')
            with self.assertRaises(ValueError): verify_inventory(p)

    def test_partial_cannot_create_model_receipt_or_touch_database(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); (p/'evidence').mkdir(); seal(p/'evidence')
            with patch('restore.pg', side_effect=AssertionError('partial must not touch database')):
                result = restore(p/'evidence', p/'partial', None, partial=True)
            self.assertFalse(result['complete_model_receipt']); self.assertFalse((p/'partial/backup-receipt.json').exists())

    @unittest.skipUnless(os.environ.get('P1_TEST_DATABASE_URL'), 'real local test database required')
    def test_uncertain_transport_stops_without_duplicate_process(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def uncertain(payload): calls.append(payload); raise ConnectionError('synthetic lost response')
            output = Path(directory)/'partial'
            with self.assertRaises(ConnectionError): drive(output, uncertain)
            record = json.loads((output/'local-controller.json').read_text())
            self.assertEqual(len(calls), 1); self.assertEqual(len(record['processes']), 1)
            self.assertNotEqual(record['processes'][0]['returncode'], 0)
            self.assertTrue((output/'checkpoint-0-0.json').exists())
            self.assertFalse((output/'summary.json').exists())


@unittest.skipUnless(os.environ.get('P1M_TOKENIZER'), 'explicit pinned tokenizer required for native tests')
class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from transformers import AutoTokenizer
        cls.tokenizer = AutoTokenizer.from_pretrained(os.environ['P1M_TOKENIZER'], local_files_only=True, trust_remote_code=False)

    def fixture(self):
        payload = {'messages': [{'role': 'user', 'content': 'Read the workflow.'}], 'tools': []}
        return payload, Native(self.tokenizer).complete(payload)

    def test_real_token_serialization_and_kind_not_promotable(self):
        p, r = self.fixture(); self.assertFalse(audit(self.tokenizer, p, r, 1, 'scripted')['model_called'])
        promoted = copy.deepcopy(r); promoted['evidenceKind'] = 'model'
        with self.assertRaises(ValueError): audit(self.tokenizer, p, promoted, 1, 'model')

    def test_changed_input_token_output_token_and_usage_rejected(self):
        p, r = self.fixture()
        for target in ('input_ids', 'output_ids'):
            bad = copy.deepcopy(r); bad['native'][target][0] += 1
            with self.assertRaises(ValueError): audit(self.tokenizer, p, bad, 1, 'scripted')
        bad = copy.deepcopy(r); bad['body']['usage']['total_tokens'] += 1
        with self.assertRaises(ValueError): audit(self.tokenizer, p, bad, 1, 'scripted')

    def test_parsed_action_cannot_be_repaired_after_native_generation(self):
        p, r = self.fixture(); r['body']['choices'][0]['message']['tool_calls'][0]['function']['name'] = 'execute_plan'
        with self.assertRaises(ValueError): audit(self.tokenizer, p, r, 1, 'scripted')


if __name__ == '__main__': unittest.main()
