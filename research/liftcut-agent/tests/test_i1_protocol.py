"""Conditional experiment boundaries, including fixed-S0 guard and original lease."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from d2_execution import aware
from i1_gates import evaluate
from i1_protocol import BUDGET, G4_COMMIT, G4_EXECUTION, deadlines, validate_reference


def maps(memory=40, identity=10, normal=12):
    counts = {'normal': (normal, 12), 'main_memory': (6, 8), 'old_consent': (10, 10),
              'd2_memory': (memory, 48), 'd2_identity': (identity, 12),
              'd2_consent': (12, 12), 'd2_repair': (4, 4), 'd2_infeasible': (4, 4)}
    return {p: {p + str(n): n < passed for n in range(total)} for p, (passed, total) in counts.items()}


class I1ProtocolTests(unittest.TestCase):
    def test_continuous_boot_price_and_original_deadlines_are_not_reset(self):
        work, collect = deadlines('2026-10-03T10:30:00+00:00', aware('2026-10-03T10:30:01+00:00'))
        self.assertEqual(work.isoformat(), '2026-10-03T11:20:00+00:00')
        self.assertEqual(collect.isoformat(), '2026-10-03T11:50:00+00:00')
        self.assertEqual(BUDGET['instance_boot'], '2026-10-03T05:35:00.409447+00:00')
        self.assertEqual(BUDGET['cumulative_reserve_cny'], 20)
        self.assertEqual(BUDGET['hourly_cny'], 2.18)
        self.assertEqual(BUDGET['power_deadline'], '2026-10-03T14:00:00+00:00')
        for started, now in [('2026-10-03T12:30:00+00:00', '2026-10-03T12:30:00+00:00'),
                             ('2026-10-03T12:10:00+00:00', '2026-10-03T12:10:00+00:00'),
                             ('2026-10-03T10:30:00+00:00', '2026-10-03T10:31:01+00:00')]:
            with self.assertRaises(TimeoutError):
                deadlines(started, aware(now))
        with self.assertRaises(ValueError):
            deadlines('2026-10-03T04:00:00+00:00', aware('2026-10-03T04:00:00+00:00'))

    def test_g4_failure_and_prespecified_control_cannot_be_replaced_by_best_score(self):
        reference = {'version': 'i1-fixed-reference-v1', 'model_result': True,
            'g4_code_commit': G4_COMMIT, 'g4_candidate_passed': False,
            'g4_binding': {'code_commit': G4_COMMIT, 'seed': 42, 'test_episodes': 0},
            'selection': 'preselected_G4_new_control', 'g4_episodes_replayed': 222, 'test_episodes': 0,
            'model': G4_EXECUTION['preparation']['model'],
            'adapter_sha256': {'adapter_config.json': 'a'*64, 'adapter_model.safetensors': 'b'*64},
            'adapter_bytes': {'sha256': 'b'*64},
            'control_evaluation_sha256': {f'{p}/{n}.jsonl': 'c'*64 for p in ('normal', 'diagnostic', 'd2')
                                         for n in ('episodes', 'calls', 'generations')},
            **{k: 'd'*64 for k in ('g4_index_digest', 'g4_restore_receipt_sha256', 'g4_comparison_digest')}}
        self.assertEqual(validate_reference(reference), reference)
        for key, value in [('selection', 'permuted'), ('model_result', False),
                           ('g4_candidate_passed', True), ('g4_episodes_replayed', 111)]:
            with self.assertRaises(ValueError):
                validate_reference({**reference, key: value})
        bad = deepcopy(reference)
        bad['control_evaluation_sha256'].pop('normal/calls.jsonl')
        with self.assertRaises(ValueError):
            validate_reference(bad)

    def test_system_thresholds_paired_gain_and_fixed_s0_protection_are_separate(self):
        arms = {'raw': maps(28, 7), 'view': maps()}
        fixed = maps(26, 7)
        def score(base, false_stops=None):
            with patch('i1_gates.panel_maps', side_effect=lambda r: r), patch(
                    'i1_gates.published_maps', side_effect=lambda arm: (arms[arm], false_stops or [], 0)):
                return evaluate(arms, base, {'raw': 'raw', 'view': 'view'})
        self.assertTrue(score(fixed)['candidate_passed'])
        self.assertFalse(score(maps(26, 11))['candidate_passed'])
        self.assertTrue(score(maps(26, 11))['mechanism_passed'])
        self.assertFalse(score(fixed, ['false-stop'])['mechanism_passed'])
        arms['raw'] = maps(39, 7)
        self.assertFalse(score(fixed)['mechanism_checks']['memory_net_gain_at_least_12'])
        arms['raw'] = maps(28, 7)
        arms['view'] = maps(48, 12, 11)
        self.assertFalse(score(fixed)['mechanism_passed'])


if __name__ == '__main__':
    unittest.main()
