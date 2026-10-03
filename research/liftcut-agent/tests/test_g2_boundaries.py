"""Keep true stopping regressions and scripted prefixes distinct in G2 review."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from analyze_g2_boundaries import continuation_chain
from liftcut_agent.benchmark import read_jsonl


class BoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = read_jsonl(ROOT / 'reports/g2-seed42-2026-10-03/run/evaluation/coverage_mix/d2/episodes.jsonl')

    def test_real_repair_success_excludes_injected_error_but_infeasible_loops_remain(self):
        repair = [continuation_chain(e) for e in self.rows if e['case_id'].startswith('d2-repair-')]
        infeasible = [continuation_chain(e) for e in self.rows if e['case_id'].startswith('d2-infeasible-')]
        self.assertEqual(len(repair), 4)
        self.assertEqual(len(infeasible), 4)
        for row in repair:
            self.assertTrue(row['correct'])
            self.assertEqual(row['scripted_prefix_excluded'], 4)
            self.assertEqual(row['invalid_validation_attempts'], 0)
            self.assertEqual(row['autonomous_tools'], ['validate_plan', 'propose_plan', 'finish'])
        for row in infeasible:
            self.assertFalse(row['correct'])
            expected_repeats = 7 if row['case_id'] == 'd2-infeasible-session_count_mismatch-v0' else 8
            self.assertEqual(row['invalid_validation_attempts'], 8)
            self.assertEqual(row['maximum_repeats_of_same_invalid_validation'], expected_repeats)
            self.assertEqual(row['validation_issue_counts'], {'wrong_action': 8})
            self.assertEqual(row['stop_reason'], 'request_limit')
            self.assertIsNone(row['policy_failure'])
            self.assertIsNone(row['terminal_outcome'])

    def test_changed_action_is_not_counted_as_identical_retry(self):
        episode = deepcopy(self.rows[-1])
        events = [e for e in episode['trace']['events'] if e['actor'] == 'agent']
        events[-1]['action']['arguments']['plan']['evidence_ids'] = ['explicit-test-mutation']
        result = continuation_chain(episode)
        self.assertEqual(result['invalid_validation_attempts'], 8)
        self.assertEqual(result['maximum_repeats_of_same_invalid_validation'], 7)

    def test_inconsistent_or_truncated_autonomous_history_is_rejected(self):
        for prefix in (-1, True, 999, 3):
            episode = deepcopy(self.rows[-1])
            episode['scripted_prefix_calls'] = prefix
            with self.subTest(prefix=prefix), self.assertRaises(ValueError):
                continuation_chain(episode)


if __name__ == '__main__':
    unittest.main()
