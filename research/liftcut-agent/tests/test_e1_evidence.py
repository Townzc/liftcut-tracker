"""Optional real-tokenizer E1 evidence fault checks against an offline development drill.

Set LIFTCUT_E1_DRILL and LIFTCUT_TOKENIZER_DIR. No model calls or reserved-data reads.
The fixture is produced by prepare_e1_execution, and must label itself scripted.
"""
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from audit_e1 import audit
from d2_execution import read
from e1_execution import cases_for_run
from e1_rollout import audit_arm
from liftcut_agent.benchmark import load_catalog, read_jsonl
from prepare_counterfactual_diagnostics import load_tokenizer
from recovery_dataset import write_rows
from restore_e1 import assemble
from server_workspace import dump_new


@unittest.skipUnless(os.environ.get('LIFTCUT_E1_DRILL') and os.environ.get('LIFTCUT_TOKENIZER_DIR'),
                     'requires explicitly prepared development-only tokenizer drill')
class E1EvidenceFaultTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path(os.environ['LIFTCUT_E1_DRILL'])
        cls.tokpath = Path(os.environ['LIFTCUT_TOKENIZER_DIR'])
        cls.plan = read(cls.source / 'scripted-plan.json')
        report = read(cls.source / 'readiness.json')
        assert report['evidence_kind'] == 'scripted_development_contract' and not report['model_result']
        assert report['reserved_task_payloads_read'] == report['new_model_calls'] == 0
        cls.fixture_run = cls.source / 'SCRIPTED-E1-DEVELOPMENT-ONLY'
        cls.catalog = load_catalog(ROOT / 'benchmark/catalog.json')
        cls.cases = cases_for_run(cls.fixture_run, cls.plan, cls.catalog)
        cls.tokenizer, _ = load_tokenizer(cls.tokpath)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.arm = self.root / 'episodes'
        shutil.copytree(self.fixture_run / 'evaluation/D/episodes', self.arm)

    def mutated(self, filename, change):
        path = self.arm / (filename + '.jsonl'); rows = read_jsonl(path)
        change(rows)
        path.unlink(); write_rows(path, rows)

    def check_rejected(self):
        with self.assertRaises((ValueError, KeyError, TypeError, AssertionError)):
            audit_arm(self.arm, self.cases, self.catalog, self.tokenizer, 'D', scripted=True)

    def test_complete_original_environment_and_native_replay(self):
        result = audit_arm(self.arm, self.cases, self.catalog, self.tokenizer, 'D', scripted=True)
        self.assertEqual(result['replay']['replayed'], 48)
        self.assertEqual(result['actual_model_calls'], 0)
        self.assertFalse(result['recorded_usage_is_model_usage'])

    def test_missing_full_episode_rejected(self):
        self.mutated('episodes', lambda rows: rows.pop())
        self.check_rejected()

    def test_reordered_full_episode_rejected(self):
        self.mutated('episodes', lambda rows: rows.reverse())
        self.check_rejected()

    def test_native_token_mutation_rejected(self):
        self.mutated('generations', lambda rows: rows[0]['output_ids'].__setitem__(0, rows[0]['output_ids'][0] + 1))
        self.check_rejected()

    def test_projection_input_mutation_rejected(self):
        self.mutated('inputs', lambda rows: rows[0].__setitem__('request_number', 99))
        self.check_rejected()

    def test_inverse_mapping_mutation_rejected(self):
        self.mutated('responses', lambda rows: rows[0].__setitem__('mapping', {}))
        self.check_rejected()

    def test_outcome_score_cannot_be_overridden(self):
        self.mutated('episodes', lambda rows: rows[0]['trace']['score'].__setitem__('passed', not rows[0]['trace']['score']['passed']))
        self.check_rejected()

    def test_parent_absence_never_mints_complete_receipt(self):
        index = read(self.source / 'downloads/backup-index.json')
        if index['status'] != 'complete':
            self.skipTest('CI has no private weight: partial inventory is checked separately')
        output = self.root / 'restored-missing-parent'
        with self.assertRaises((ValueError, FileNotFoundError, TypeError, AttributeError)):
            assemble(self.source / 'downloads', output, self.tokpath, self.root / 'missing-parent',
                     scripted=True, plan=self.plan)
        self.assertFalse((output / 'off-instance-backup.json').exists())

    def test_corrupt_archive_never_mints_receipt(self):
        downloads = self.root / 'downloads'; shutil.copytree(self.source / 'downloads', downloads)
        path = downloads / 'evidence.tar.gz'
        with path.open('r+b') as stream:
            stream.seek(10); value = stream.read(1); stream.seek(10); stream.write(bytes([value[0] ^ 1]))
        output = self.root / 'corrupt-restored'
        with self.assertRaises(ValueError):
            assemble(downloads, output, self.tokpath, None, allow_partial=True, scripted=True, plan=self.plan)
        self.assertFalse((output / 'off-instance-backup.json').exists())

    def test_weightless_metadata_replay_does_not_pass_candidate(self):
        result = audit(self.fixture_run, self.tokpath, scripted=True, plan=self.plan, metadata_only=True)
        self.assertFalse(result['complete_evidence'])
        self.assertFalse(result['decision']['candidate_passed'])
        self.assertEqual(result['full_task_episodes_replayed'], 96)


if __name__ == '__main__':
    unittest.main()
