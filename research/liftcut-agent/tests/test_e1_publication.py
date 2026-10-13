"""Synthetic unit fixtures; no E1 model calls or reserved-payload reads."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import json
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from analyze_e1_results import resource_interval, trajectory_detail
from e1_protocol import CATEGORIES, decide
from publish_e1_results import compare_reconstruction, verify_handoff
from server_workspace import dump_new, sha256


def append_json(path, row):
    with path.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(row) + '\n')


def rows():
    return [{'case_id': f'b{b}-{c}', 'category': c, 'bundle': f'b{b}', 'passed': True,
             'blocked_write_attempts': 0, 'unexpected_committed_writes': 0, 'unknown_alias_rejections': 0}
            for b in range(4) for c in CATEGORIES]


class E1PublicationTests(unittest.TestCase):
    def test_high_total_cannot_hide_category_failure(self):
        arms = {'A': rows(), 'D': rows()}
        for row in arms['D']:
            if row['bundle'] in ('b0', 'b1') and row['category'] == CATEGORIES[0]:
                row['passed'] = False
        r = decide(arms, complete=True, actual_model_result=True)
        self.assertEqual(r['passed']['D'], 46)
        self.assertTrue(r['gates']['D_at_least_44'])
        self.assertFalse(r['gates']['D_each_category_at_least_3'])
        self.assertFalse(r['candidate_passed'])

    def test_metadata_reconstruction_never_claims_current_weight_verification(self):
        arms = {a: {'rows': rows()} for a in ('A', 'D')}
        archived = {'arms': arms, 'model_result': True, 'complete_evidence': True,
                    'actual_external_weight_verified': True, 'external_weights': {'fixture': True},
                    'decision': decide({a: arms[a]['rows'] for a in arms}, complete=True, actual_model_result=True)}
        actual = deepcopy(archived)
        actual.update(complete_evidence=False, actual_external_weight_verified=False, external_weights=None)
        actual['decision'] = decide({a: arms[a]['rows'] for a in arms}, complete=False, actual_model_result=True)
        compare_reconstruction(actual, archived, metadata_only=True)
        with self.assertRaises(ValueError):
            compare_reconstruction(actual, archived, metadata_only=False)
        archived['decision']['passed']['D'] -= 1
        with self.assertRaisesRegex(ValueError, 'complete gates'):
            compare_reconstruction(actual, archived, metadata_only=True)

    def test_scripted_or_incomplete_result_cannot_publish(self):
        for field in ('model_result', 'complete_evidence', 'actual_external_weight_verified'):
            archived = {k: True for k in ('model_result', 'complete_evidence', 'actual_external_weight_verified')}
            archived[field] = False
            with self.assertRaisesRegex(ValueError, 'genuine model'):
                compare_reconstruction({}, archived, metadata_only=True)

    def test_sparse_telemetry_never_fills_missing_gap_or_unknown_metric(self):
        def sample(second, utilization, memory):
            return {'at_utc': f'2026-10-13T00:00:{second:02d}+00:00', 'status': 'observed', 'probe_wall_seconds': .1,
                    'gpus': [{'utilization.gpu': utilization, 'utilization.memory': None,
                              'memory.used': memory, 'memory.total': 24564, 'power.draw': 100}]}
        s = [sample(5, 20, 7500), sample(20, 40, 8000)]
        r = resource_interval(s, '2026-10-13T00:00:00+00:00', '2026-10-13T00:00:30+00:00')
        self.assertEqual(r['covered_seconds'], 10)
        self.assertAlmostEqual(r['coverage_fraction'], 1/3)
        self.assertEqual(r['metrics']['utilization.gpu']['time_weighted_mean_over_covered_seconds'], 30)
        self.assertEqual(r['metrics']['memory.used']['max_observed'], 8000)
        self.assertIsNone(r['metrics']['utilization.memory']['time_weighted_mean_over_covered_seconds'])
        self.assertEqual(r['metrics']['utilization.memory']['known_seconds'], 0)
        with self.assertRaisesRegex(ValueError, 'chronological'):
            resource_interval(list(reversed(s)), '2026-10-13T00:00:00+00:00', '2026-10-13T00:00:30+00:00')

    def test_invalid_feedback_is_separate_from_eventual_success(self):
        e = {'trace': {'events': [{'index': 2, 'actor': 'agent', 'action': {'tool': 'validate_plan'},
                    'observation': {'ok': True, 'result': {'valid': False, 'issues': ['fixture']}}}],
                     'score': {'passed': True, 'writes': 0}}, 'calls': [], 'policy_failure': None}
        n = {'tokens': {'generated_prompt_tokens': 0, 'completion_tokens': 0, 'actual_model_generations': 0,
                        'local_context_guards': 0}, 'raw_prompt_tokens_at_same_visited_states': 0,
             'changed_requests': 0, 'unknown_alias_rejections': 0}
        r = trajectory_detail(e, n)
        self.assertTrue(r['score']['passed'])
        self.assertEqual(r['first_observed_invalid_feedback']['event_index'], 2)
        self.assertTrue(r['feedback_is_not_automatically_the_root_cause'])

    def test_publication_does_not_invent_server_consumption_or_shutdown(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t); receipt = {'synthetic_test_receipt': True}
            dump_new(p/'restore-receipt.json', receipt); h = sha256(p/'restore-receipt.json')
            dump_new(p/'backup-index.json', {'binding': {'trial_started_at_utc': '2026-10-13T00:00:00+00:00',
                'collection_cutoff': '2026-10-13T01:00:00+00:00', 'hard_cutoff': '2026-10-13T02:00:00+00:00'}})
            events = [dict(event='off_instance_verified', receipt=receipt, at_utc='2026-10-13T00:10:00+00:00'),
                      dict(event='receipt_atomic_published', receipt_sha256=h, at_utc='2026-10-13T00:11:00+00:00'),
                      dict(event='collector_finished', result={'receipt_transfer': {'receipt_sha256': h}, 'server_consumed': None}, at_utc='2026-10-13T00:12:00+00:00')]
            for e in events:
                append_json(p/'operations.jsonl', e)
            (p/'server-events-latest.jsonl').write_text('', encoding='utf-8')
            r = verify_handoff(p)
            self.assertIsNone(r['server_consumption_observed'])
            self.assertIsNone(r['shutdown_return'])
            self.assertEqual(r['provider_power_state'], 'unknown')
            append_json(p/'server-events-latest.jsonl', {'event': 'server_receipt_consumed',
                'receipt_sha256': h, 'status': 'complete', 'at_utc': '2026-10-13T00:11:30+00:00'})
            observed = verify_handoff(p)
            self.assertTrue(observed['server_consumption_observed'])
            self.assertIsNone(observed['collector_result']['server_consumed'])
            self.assertIsNone(observed['shutdown_request'])
            self.assertEqual(observed['provider_power_state'], 'unknown')
            # A server event adds evidence without rewriting the collector's
            # missing status-file observation, and duplicate/conflicting events fail.
            append_json(p/'server-events-latest.jsonl', {'event': 'server_receipt_consumed',
                'receipt_sha256': 'wrong', 'status': 'complete', 'at_utc': '2026-10-13T00:11:30+00:00'})
            with self.assertRaisesRegex(ValueError, 'server E1'):
                verify_handoff(p)


if __name__ == '__main__':
    unittest.main()
