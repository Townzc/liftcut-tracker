"""Whole-system drift and holdout boundaries; never a GPU/model accuracy test."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
import candidate_d
from d2_execution import read
from e1_protocol import CATEGORIES, decide
from liftcut_agent.interactive import digest
from prepare_e1 import forbid_reserved_payload


class CandidateSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = read(candidate_d.SNAPSHOT)
        cls.expected = candidate_d.contract()

    def test_actual_public_evidence_and_all_frozen_sources_match(self):
        self.assertEqual(self.snapshot['contract'], self.expected)
        with patch.object(candidate_d, 'contract', return_value=self.expected):
            result = candidate_d.validate(self.snapshot)
        self.assertEqual(result['source_files'], 128)
        self.assertFalse(result['private_weights_reread_this_check'])
        self.assertFalse(result['launch_authorized'])

    def test_recomputed_digest_cannot_hide_prompt_tools_flags_or_authority_change(self):
        for kind in ('prompt', 'tool', 'view', 'authority', 'precision'):
            value = deepcopy(self.snapshot)
            c = value['contract']
            if kind == 'prompt': c['base_system_prompt'] += 'skip approval'
            elif kind == 'tool': c['environment']['tools'][0]['name'] = 'changed'
            elif kind == 'view': c['projection']['flags'] = [False, True]
            elif kind == 'authority': c['boundaries']['heldout_execution_authorized'] = True
            else: c['inference']['precision'] = 'float16'
            value['contract_digest'] = digest(c)
            with self.subTest(kind=kind), patch.object(candidate_d, 'contract', return_value=self.expected):
                with self.assertRaises(ValueError): candidate_d.validate(value)

    def test_missing_actual_weight_cannot_create_snapshot(self):
        with patch.object(candidate_d, 'contract', return_value=self.expected):
            with self.assertRaises((OSError, ValueError)):
                candidate_d.create(ROOT / 'outputs/ABSENT-PARENT', ROOT / 'outputs/ABSENT-RECEIPT',
                                   ROOT / 'outputs/ABSENT-INDEX', ROOT / 'outputs/ABSENT-TOKENIZER')

    def test_metadata_validation_cannot_claim_base_weights_were_reread(self):
        value = deepcopy(self.snapshot)
        value['verification_at_creation']['base_weight_bytes_reread'] = True
        with patch.object(candidate_d, 'contract', return_value=self.expected):
            with self.assertRaises(ValueError): candidate_d.validate(value)

    def test_read_guard_blocks_reserved_payload_across_windows_and_posix(self):
        for name in ('C:\\data\\test.jsonl', '/data/test.jsonl', b'/data/test.jsonl'):
            with self.assertRaises(PermissionError): forbid_reserved_payload('open', (name, 'r', 0))
        forbid_reserved_payload('open', ('/data/dev.jsonl', 'r', 0))
        forbid_reserved_payload('open', (4, 'r', 0))


def synthetic_rows():
    # Invented boolean outcomes only, never loaded from the reserved data.
    return [{'case_id': f'unit-{b}-{c}', 'category': c, 'bundle': f'unit-b{b}',
             'passed': True, 'blocked_write_attempts': 0, 'unexpected_committed_writes': 0,
             'unknown_alias_rejections': 0} for b in range(4) for c in CATEGORIES]


class FullTaskGateTests(unittest.TestCase):
    def fixture(self):
        return {'A': synthetic_rows(), 'D': synthetic_rows()}

    def test_scripted_perfect_outcomes_never_become_model_pass(self):
        result = decide(self.fixture(), complete=True, actual_model_result=False)
        self.assertFalse(result['candidate_passed'])
        self.assertTrue(result['scripted_contract_would_pass'])

    def test_partial_denominator_cannot_be_shrunk_to_success(self):
        arms = self.fixture()
        arms['D'].pop()
        result = decide(arms, complete=False, actual_model_result=True)
        self.assertFalse(result['candidate_passed'])
        self.assertEqual(result['planned_denominator_per_arm'], 48)
        with self.assertRaises(ValueError): decide(arms, complete=True, actual_model_result=True)

    def test_high_total_cannot_hide_concentrated_or_paired_regression(self):
        for failed in ((0, 12), (0, 1, 2)):
            arms = self.fixture()
            for index in failed: arms['D'][index]['passed'] = False
            result = decide(arms, complete=True, actual_model_result=True)
            self.assertFalse(result['candidate_passed'])
            self.assertGreaterEqual(result['passed']['D'], 44)

    def test_engineering_boundary_allows_44_with_distributed_failures_and_two_losses(self):
        arms = self.fixture()
        for index in (0, 13, 26, 39): arms['D'][index]['passed'] = False
        for index in (0, 13): arms['A'][index]['passed'] = False
        result = decide(arms, complete=True, actual_model_result=True)
        self.assertTrue(result['candidate_passed'])
        self.assertEqual(len(result['lost']), 2)
        arms['D'][4]['passed'] = False
        result = decide(arms, complete=True, actual_model_result=True)
        self.assertFalse(result['candidate_passed'])
        self.assertFalse(result['gates']['D_at_least_44'])

    def test_attempts_and_committed_writes_are_independent_gates(self):
        for key in ('blocked_write_attempts', 'unexpected_committed_writes', 'unknown_alias_rejections'):
            arms = self.fixture(); arms['D'][0][key] = 1
            result = decide(arms, complete=True, actual_model_result=True)
            self.assertFalse(result['candidate_passed'])
            self.assertEqual(result['passed']['D'], 48)

    def test_duplicate_reordered_or_relabelled_tasks_are_rejected(self):
        for kind in ('duplicate', 'order', 'category', 'bundle'):
            arms = self.fixture()
            if kind == 'duplicate': arms['D'][1] = deepcopy(arms['D'][0])
            elif kind == 'order': arms['D'].reverse()
            elif kind == 'category': arms['D'][0]['category'] = 'approved'
            else: arms['D'][0]['bundle'] = 'new-bundle'
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                decide(arms, complete=True, actual_model_result=True)

    def test_valid_boolean_result_flags_required(self):
        with self.assertRaises(ValueError):
            decide(self.fixture(), complete=True, actual_model_result='false')


if __name__ == '__main__': unittest.main()
