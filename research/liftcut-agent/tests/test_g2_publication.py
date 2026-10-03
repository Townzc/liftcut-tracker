"""G2 public evidence must preserve raw bytes, failures and study boundaries."""
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
from analyze_g2_results import compare_repeat, normal_pairs, operational_evidence
from liftcut_agent.benchmark import read_jsonl
from plot_g2_results import plot
from publish_g2_results import EXECUTION, WEIGHTS, verify_complete, verify_inventory
from server_workspace import sha256


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


def fixture(root):
    for prefix in ('', 'training/repair_only/', 'training/coverage_mix/'):
        files = ['data.json'] if not prefix else ['report.json', 'final/adapter_model.safetensors']
        rows = []
        for name in files:
            path = root / prefix / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'explicit-unit-fixture-not-model-evidence')
            rows.append({'path': name, 'bytes': path.stat().st_size, 'sha256': sha256(path)})
        save(root / prefix / 'backup-inventory.json', {'files': rows})


class PublicationTests(unittest.TestCase):
    def test_all_new_cli_entrypoints_bootstrap_without_pythonpath(self):
        env = dict(os.environ)
        env.pop('PYTHONPATH', None)
        for name in ('publish', 'analyze', 'plot'):
            with self.subTest(name=name):
                result = subprocess.run([sys.executable, str(ROOT / (name + '_g2_results.py')), '--help'],
                    env=env, capture_output=True, text=True, check=True)
                self.assertIn('usage:', result.stdout)

    def test_partial_scripted_and_prior_g1_commits_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for status, kind, commit in [('partial', 'model', EXECUTION),
                    ('complete', 'scripted_contract', EXECUTION),
                    ('complete', 'model', '29d8d7fc6d1e749a85d93979da3b589d063f5c0d')]:
                save(directory / 'index.json', {'status': status, 'evidence_kind': kind,
                    'binding': {'code_commit': commit}})
                with self.assertRaisesRegex(ValueError, 'complete real-model'):
                    verify_complete(directory, directory/'index.json', directory/'absent',
                                    directory, directory, directory, directory)

    def test_exact_weight_omission_and_raw_byte_integrity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            self.assertEqual(verify_inventory(root), 5)
            with self.assertRaisesRegex(ValueError, 'only the two weights'):
                verify_inventory(root, metadata_only=True)
            for name in WEIGHTS:
                (root / name).unlink()
            self.assertEqual(verify_inventory(root, metadata_only=True), 5)
            (root / 'data.json').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                verify_inventory(root, metadata_only=True)

    def test_extra_duplicate_and_traversing_files_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            extra = root / 'extra.json'
            extra.write_text('{}')
            with self.assertRaisesRegex(ValueError, 'exact G2 inventory'):
                verify_inventory(root)
            extra.unlink()
            p = root / 'backup-inventory.json'
            row = json.loads(p.read_text())['files'][0]
            save(p, {'files': [row, row]})
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                verify_inventory(root)
            row['path'] = '../outside'
            save(p, {'files': [row]})
            with self.assertRaisesRegex(ValueError, 'unsafe'):
                verify_inventory(root)

    def test_real_historical_failure_chains_keep_names_and_denominators(self):
        root = ROOT / 'reports/g1-seed42-2026-10-02/run/evaluation'
        before, after = [read_jsonl(root / a / 'normal/episodes.jsonl') for a in ('control', 'repair')]
        result = normal_pairs(before, after)
        self.assertEqual(set(result['arms']), {'repair_only', 'coverage_mix'})
        self.assertEqual(result['counts']['repair_only']['correct'], 9)
        self.assertEqual(result['counts']['coverage_mix']['false_infeasible_without_validation'], 8)
        self.assertEqual(result['counts']['coverage_mix']['local_refusals'], {'context_limit': 1})
        self.assertIn('first_different_coverage_mix_action', result['paired'][0])
        # Historical inputs exercise the adapter; they are never G2 results.
        with self.assertRaises(ValueError):
            normal_pairs(before[:-1], after[:-1])
        with self.assertRaises(ValueError):
            normal_pairs(before, after[::-1])

    def test_historical_repeat_never_replaces_current_control_and_rejects_omissions(self):
        root = ROOT / 'reports/g1-seed42-2026-10-02/run/evaluation/repair'
        for panel in ('normal', 'diagnostic', 'd2'):
            before = read_jsonl(root / panel / 'episodes.jsonl')
            same = compare_repeat(before, before, panel)
            self.assertEqual(same['changed_outcome_cases'], [])
            after = deepcopy(before)
            outcome = after[0]['trace']['score'] if panel == 'normal' else after[0]['decision']
            key = 'passed' if panel == 'normal' else 'correct'
            outcome[key] = not outcome[key]
            changed = compare_repeat(before, after, panel)
            self.assertEqual(len(changed['changed_outcome_cases']), 1)
            self.assertEqual(len(changed['gained']) + len(changed['lost']), 1)
            with self.assertRaises(ValueError):
                compare_repeat(before, after[:-1], panel)

    def test_recovery_collector_end_is_not_provider_shutdown(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            receipt = {'explicit_fixture': True}
            save(root / 'restore-receipt.json', receipt)
            rows = [{'event': 'off_instance_verified', 'receipt': receipt},
                    {'event': 'receipt_atomic_published', 'receipt_sha256': sha256(root / 'restore-receipt.json')},
                    {'event': 'monitor_stopped', 'at_utc': '2026-10-03T01:00:00+00:00'}]
            (root/'operations.jsonl').write_text('\n'.join(json.dumps(r) for r in rows))
            (root/'server-events.jsonl').write_text('')
            result = operational_evidence(root, {'booted_at_proxy':'2026-10-03T00:00:00+00:00',
                                                'hard_cutoff':'2026-10-03T03:00:00+00:00'})
            self.assertEqual(result['compute_proxy_cny'], 2.18)
            self.assertEqual(result['reserve_cny'], 8)
            self.assertEqual(result['provider_billing_stopped'], 'unconfirmed')
            self.assertEqual(result['shutdown_request'], 'unobserved')
            self.assertEqual(result['server_receipt_consumption'], 'unobserved')

    def test_plot_refuses_partial_or_non_model_results(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for model, count in ((False, 222), (True, 111)):
                save(root/'review.json', {'version':'g2-results-review-v1','model_result':model,
                    'episodes_replayed':count,'unrun_cases':222-count})
                with self.assertRaisesRegex(ValueError, 'complete independently replayed'):
                    plot(root/'review.json', root/'figures')
            self.assertFalse((root/'figures').exists())


if __name__ == '__main__':
    unittest.main()
