"""Reject misleading G3 publication boundaries and preserve every historical comparison."""
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
from analyze_g3_results import case_comparison, normal_comparison, control_scope
from liftcut_agent.benchmark import read_jsonl
from plot_g3_results import plot
from publish_g3_results import ARMS, EXECUTION, WEIGHTS, verify_complete, verify_inventory
from server_workspace import sha256


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


def fixture(root):
    for prefix in ('', *(f'training/{a}/' for a in ARMS)):
        rows = []
        for name in (['data.json'] if not prefix else ['report.json', 'final/adapter_model.safetensors']):
            p = root / prefix / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b'unit-fixture-not-a-model-result')
            rows.append({'path': name, 'bytes': p.stat().st_size, 'sha256': sha256(p)})
        save(root / prefix / 'backup-inventory.json', {'files': rows})


class G3PublicationTests(unittest.TestCase):
    def test_entrypoints_bootstrap_without_pythonpath(self):
        env = dict(os.environ)
        env.pop('PYTHONPATH', None)
        for name in ('publish', 'analyze', 'plot'):
            with self.subTest(name=name):
                result = subprocess.run([sys.executable, str(ROOT / (name + '_g3_results.py')), '--help'],
                                        env=env, capture_output=True, text=True, check=True)
                self.assertIn('usage:', result.stdout)

    def test_partial_scripted_and_old_execution_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            for status, kind, commit in [('partial', 'model', EXECUTION), ('complete', 'scripted_contract', EXECUTION),
                                         ('complete', 'model', '404115971f3db97577433769a88dbb2486058d99')]:
                save(p/'index.json', {'status':status, 'evidence_kind':kind, 'binding':{'code_commit':commit}})
                with self.assertRaisesRegex(ValueError, 'complete real-model'):
                    verify_complete(p, p/'index.json', p/'absent', p, p, p, p)

    def test_only_two_weights_may_be_omitted_and_metadata_must_match(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            fixture(p)
            self.assertEqual(verify_inventory(p), 5)
            with self.assertRaisesRegex(ValueError, 'only the two weights'):
                verify_inventory(p, metadata_only=True)
            for name in WEIGHTS:
                (p/name).unlink()
            self.assertEqual(verify_inventory(p, metadata_only=True), 5)
            (p/'data.json').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                verify_inventory(p, metadata_only=True)

    def test_extra_duplicate_and_traversing_inventory_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            fixture(p)
            (p/'extra').write_text('not inventoried')
            with self.assertRaisesRegex(ValueError, 'exact G3 inventory'):
                verify_inventory(p)
            (p/'extra').unlink()
            row = json.loads((p/'backup-inventory.json').read_text())['files'][0]
            save(p/'backup-inventory.json', {'files':[row,row]})
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                verify_inventory(p)
            row['path'] = '../outside'
            save(p/'backup-inventory.json', {'files':[row]})
            with self.assertRaisesRegex(ValueError, 'unsafe'):
                verify_inventory(p)

    def test_all111_cases_include_diagnostic_negative_control_and_keep_regressions(self):
        root = ROOT/'reports/g2-seed42-2026-10-03/run/evaluation/coverage_mix'
        total = 0
        for panel, size in [('normal',12), ('diagnostic',19), ('d2',80)]:
            before = read_jsonl(root/panel/'episodes.jsonl')
            after = deepcopy(before)
            outcome = after[0]['trace']['score'] if panel == 'normal' else after[0]['decision']
            key = 'passed' if panel == 'normal' else 'correct'
            outcome[key] = not outcome[key]
            rows = case_comparison(before, after, panel)
            total += len(rows)
            self.assertEqual(len(rows), size)
            self.assertEqual(sum(r['gained'] or r['lost'] for r in rows), 1)
            self.assertEqual(rows[0]['lost'], before[0]['trace']['score']['passed'] if panel == 'normal' else before[0]['decision']['correct'])
            with self.assertRaises(ValueError):
                case_comparison(before, after[:-1], panel)
            with self.assertRaises(ValueError):
                case_comparison(before, after[::-1], panel)
        self.assertEqual(total,111)

    def test_diagnostic_actions_exclude_scripted_prefix_and_detect_length_changes(self):
        before = read_jsonl(ROOT/'reports/g2-seed42-2026-10-03/run/evaluation/coverage_mix/d2/episodes.jsonl')
        after = deepcopy(before)
        after[0]['trace']['events'].append({'actor':'agent','action':{'tool':'finish','arguments':{'outcome':'infeasible'}}})
        row = case_comparison(before,after,'d2')[0]
        self.assertIsNone(row['first_different_historical_control_action'])
        self.assertEqual(row['first_different_candidate_action']['tool'],'finish')
        self.assertEqual(row['common_action_prefix_length'], len([e for e in before[0]['trace']['events'] if e['actor']=='agent'])-before[0]['scripted_prefix_calls'])

    def test_prefix_match_does_not_become_fresh_complete_control(self):
        result = control_scope({'reproduction':{'stop_half':{'reproduced':True,'shared_steps':12}}, 'paired_claim_allowed':True})
        self.assertTrue(result['frozen_audit_paired_claim_allowed'])
        self.assertFalse(result['retrained_in_this_window'])
        self.assertFalse(result['independent_generalization'])
        rows = read_jsonl(ROOT/'reports/g2-seed42-2026-10-03/run/evaluation/coverage_mix/normal/episodes.jsonl')
        normal = normal_comparison(rows,rows,'stop_half')
        self.assertEqual(set(normal['arms']), {'g2_coverage_mix_historical','stop_half'})
        self.assertEqual(normal['counts']['stop_half']['correct'],10)

    def test_plot_rejects_partial_scripted_or_falsely_fresh_control(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            for model,count in [(False,222),(True,111)]:
                save(p/'review.json', {'version':'g3-results-review-v1','model_result':model,'episodes_replayed':count,'unrun_cases':222-count})
                with self.assertRaisesRegex(ValueError,'complete independently replayed'):
                    plot(p/'review.json',p/'figures')
            save(p/'review.json', {'version':'g3-results-review-v1','model_result':True,'episodes_replayed':222,'unrun_cases':0,'control':{'retrained_in_this_window':True}})
            with self.assertRaisesRegex(ValueError,'historical control'):
                plot(p/'review.json',p/'figures')
            self.assertFalse((p/'figures').exists())


if __name__ == '__main__':
    unittest.main()
