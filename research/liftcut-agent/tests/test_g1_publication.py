"""Publication must retain raw evidence and never upgrade a script or partial run."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from analyze_g1_results import d2_case_details, training_description
from analyze_g1_contexts import decision_context, paired_contexts, normal_pairs
from counterfactual_diagnostics import fixtures
from d2_execution import ordered_cases
from liftcut_agent.benchmark import load_catalog, read_jsonl
from publish_g1_results import EXECUTION, WEIGHTS, verify_complete, verify_inventory
from server_workspace import sha256


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


def fixture(root):
    # Deliberately tiny bytes; this fixture does not represent model evidence.
    for prefix in ('', 'training/control/', 'training/repair/'):
        files = ['data.json'] if not prefix else ['report.json', 'final/adapter_model.safetensors']
        rows = []
        for name in files:
            p = root / prefix / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b'explicit-publication-unit-test-fixture')
            rows.append({'path': name, 'bytes': p.stat().st_size, 'sha256': sha256(p)})
        save(root / prefix / 'backup-inventory.json', {'files': rows})


class G1PublicationTests(unittest.TestCase):
    def test_context_cli_bootstraps_src_without_pythonpath(self):
        env = dict(os.environ)
        env.pop('PYTHONPATH', None)
        result = subprocess.run([sys.executable, str(ROOT / 'analyze_g1_contexts.py'), '--help'],
                                env=env, capture_output=True, text=True, check=True)
        self.assertIn('--public-dir', result.stdout)

    def test_conditioning_state_is_separate_from_matched_target(self):
        # Same correct target; one row learns the clean decision and the other
        # learns a continuation after an invalid response. The call IDs differ.
        def call(ident, name):
            return {'role': 'assistant', 'tool_calls': [{'id': ident,
                    'function': {'name': name, 'arguments': {}}}]}
        def response(ident, result):
            return {'role': 'tool', 'tool_call_id': ident,
                    'content': json.dumps({'result': result})}
        before = {'split': 'train', 'pair_id': 'a:0', 'scenario_id': 'a',
                  'family_id': 'f', 'category': 'preview',
                  'messages': [call('s', 'search_exercises'), response('s', {'blocks': []}),
                               call('v', 'validate_plan')], 'assistant_target_index': 2}
        after = deepcopy(before)
        after['messages'][2:2] = [call('bad', 'validate_plan'), response('bad', {'valid': False})]
        after['assistant_target_index'] = 4
        result = paired_contexts([before], [after])
        self.assertEqual(result['changed_state_pairs'][0]['before'], 'clean_search_before_any_validation')
        self.assertEqual(result['changed_state_pairs'][0]['after'], 'immediately_after_invalid_validation')
        self.assertEqual(result['paired_targets'], 1)
        after['messages'][-1]['tool_calls'][0]['function']['arguments'] = {'changed': True}
        with self.assertRaisesRegex(ValueError, 'correct target differs'):
            paired_contexts([before], [after])

    def test_context_audit_rejects_wrong_label_boundary_or_split(self):
        for row in ({'split': 'test', 'messages': [], 'assistant_target_index': -1},
                    {'split': 'train', 'messages': [], 'assistant_target_index': 0}):
            with self.assertRaisesRegex(ValueError, 'final-assistant training'):
                decision_context(row)
        with self.assertRaisesRegex(ValueError, 'unique ordered pairs'):
            paired_contexts([{'pair_id': 'a'}, {'pair_id': 'a'}], [])

    def test_actual_normal_failures_distinguish_local_context_refusal(self):
        root = ROOT / 'reports/g1-seed42-2026-10-02/run/evaluation'
        before, after = [read_jsonl(root / arm / 'normal/episodes.jsonl') for arm in ('control', 'repair')]
        result = normal_pairs(before, after)
        self.assertEqual(result['counts']['control']['correct'], 9)
        self.assertEqual(result['counts']['repair']['correct'], 2)
        self.assertEqual(result['counts']['repair']['false_infeasible_without_validation'], 8)
        self.assertEqual(result['counts']['repair']['local_refusals'], {'context_limit': 1})
        last = result['arms']['repair'][-1]
        self.assertEqual(last['maximum_repeats_of_same_invalid_validation'], 9)
        self.assertEqual(last['policy_failure'], 'expected_single_tool_call')
        with self.assertRaisesRegex(ValueError, 'unique ordered full-task pairs'):
            normal_pairs(before, after[::-1])

    def test_partial_and_scripted_records_cannot_become_model_results(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for status, kind, commit in [('partial', 'model', EXECUTION),
                                          ('complete', 'scripted_contract', EXECUTION),
                                          ('complete', 'model', '0' * 40)]:
                save(directory / 'index.json', {'status': status, 'evidence_kind': kind,
                                                'binding': {'code_commit': commit}})
                with self.assertRaisesRegex(ValueError, 'complete real-model'):
                    verify_complete(directory, directory / 'index.json', directory / 'absent',
                                    directory, directory, directory, directory)

    def test_only_named_weights_may_be_omitted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            self.assertEqual(verify_inventory(root), 5)
            with self.assertRaisesRegex(ValueError, 'only the two weights'):
                verify_inventory(root, metadata_only=True)
            for name in WEIGHTS:
                (root / name).unlink()
            self.assertEqual(verify_inventory(root, metadata_only=True), 5)
            (root / 'training/control/report.json').unlink()
            with self.assertRaisesRegex(ValueError, 'exact G1 inventory'):
                verify_inventory(root, metadata_only=True)

    def test_added_or_changed_public_bytes_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            extra = root / 'untracked.json'
            extra.write_bytes(b'{}')
            with self.assertRaisesRegex(ValueError, 'exact G1 inventory'):
                verify_inventory(root)
            extra.unlink()
            (root / 'data.json').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                verify_inventory(root)

    def test_duplicate_or_traversing_inventory_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            p = root / 'backup-inventory.json'
            row = json.loads(p.read_text())['files'][0]
            save(p, {'files': [row, row]})
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                verify_inventory(root)
            bad = deepcopy(row)
            bad['path'] = '../outside'
            save(p, {'files': [bad]})
            with self.assertRaisesRegex(ValueError, 'unsafe'):
                verify_inventory(root)

    def test_training_loss_uses_target_token_increments(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            save(root / 'report.json', {'steps': 2, 'processed': {'supervised_tokens': 40},
                'optimization_seconds': 20, 'peak_allocated_bytes': 1, 'peak_reserved_bytes': 2,
                'reload_max_logit_difference': 0})
            save(root / 'memory-probe.json', {'fixture': True})
            rows = [{'step': 1, 'loss': 1., 'supervised_tokens': 10, 'elapsed_seconds': 8},
                    {'step': 2, 'loss': 3., 'supervised_tokens': 40, 'elapsed_seconds': 20}]
            (root / 'training.jsonl').write_text('\n'.join(json.dumps(r) for r in rows), encoding='utf-8')
            result = training_description(root)
            self.assertEqual(result['target_weighted_mean_loss'], 2.5)
            self.assertEqual(result['supervised_tokens_per_second'], 2.)

    def test_descriptive_adapter_preserves_real_historical_d2_cases(self):
        cases = ordered_cases(fixtures(load_catalog(ROOT / 'benchmark/catalog.json')))
        old = ROOT / 'reports/d2-fixed-seed42-2026-10-02'
        episodes = read_jsonl(old / 'run/evaluation/t/episodes.jsonl')
        result = d2_case_details(cases, episodes)
        expected = json.loads((old / 'review.json').read_text(encoding='utf-8'))['arms']['t']
        for key in ('memory_by_factor', 'memory_member_selection_roles', 'identity_pairs', 'consent_cases', 'continuation_cases'):
            self.assertEqual(result[key], expected[key])
        with self.assertRaisesRegex(ValueError, 'all ordered'):
            d2_case_details(cases, episodes[::-1])


if __name__ == '__main__':
    unittest.main()
