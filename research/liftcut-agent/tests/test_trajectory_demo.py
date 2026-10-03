"""Saved demonstrations must preserve failures and never execute model text."""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from trajectory_demo import collect, render


class TrajectoryDemoTests(unittest.TestCase):
    def test_saved_g2_replays_recovery_and_both_remaining_failures(self):
        data = collect(ROOT / 'reports/g2-seed42-2026-10-03', 'g2')
        self.assertEqual([data['scores'][a]['passed'] for a in data['arms']], [2, 10])
        failures = {e['scenario_id']: e for e in data['episodes']['coverage_mix']
                    if not e['trace']['score']['passed']}
        self.assertEqual(set(failures), {'r2-05-infeasible', 'r2-05-memory_missing_time'})
        self.assertEqual(failures['r2-05-infeasible']['failure_chain']['maximum_repeats_of_same_invalid_validation'], 15)
        self.assertEqual(failures['r2-05-memory_missing_time']['failure_chain']['local_refusals'], {'context_limit': 1})
        self.assertEqual(data['new_model_calls'], 0)

    def test_saved_g1_replay_keeps_all_failures_and_external_user_events(self):
        data = collect(ROOT / 'reports/g1-seed42-2026-10-02', 'g1')
        self.assertEqual(data['episodes_replayed'], 24)
        self.assertEqual([data['scores'][a]['passed'] for a in data['arms']], [9, 2])
        self.assertEqual(data['new_model_calls'], 0)
        self.assertEqual(data['test_episodes'], 0)
        approved = data['episodes']['control'][1]['trace']
        self.assertTrue(any(e['actor'] == 'user' for e in approved['events']))
        self.assertEqual(approved['score']['writes'], 1)
        repair = data['episodes']['repair'][-1]
        self.assertEqual(repair['policy_failure'], 'expected_single_tool_call')
        self.assertEqual(repair['failure_chain']['local_refusals'], {'context_limit': 1})
        self.assertEqual(repair['failure_chain']['maximum_repeats_of_same_invalid_validation'], 9)
        self.assertFalse(repair['trace']['score']['passed'])
        self.assertNotIn('calls', repair)

    def test_model_text_cannot_terminate_embedded_data_script(self):
        source = {'model_text': '</script><img src=x onerror="alert(1)">&中文'}
        page = render(source)
        payload = page.split('<script type="application/json" id="data">', 1)[1].split('</script>', 1)[0]
        self.assertNotIn('<', payload)
        self.assertNotIn('>', payload)
        self.assertNotIn('&', payload)
        self.assertEqual(json.loads(payload), source)
        self.assertIn("connect-src 'none'", page)
        self.assertNotIn('innerHTML', page)

    def test_no_unpublished_or_unknown_study_can_be_displayed(self):
        with self.assertRaises(ValueError):
            collect(ROOT / 'reports/g1-seed42-2026-10-02', 'g0')
        with self.assertRaises(ValueError):
            collect(ROOT / 'reports/g1-seed42-2026-10-02', 'g2')


if __name__ == '__main__':
    unittest.main()
