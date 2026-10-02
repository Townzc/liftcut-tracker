"""Production phase/archival path, real temporary archives, synthetic workers."""
from datetime import datetime, timedelta, timezone
from functools import partial
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
import d2_execution as d2
from run_counterfactual_window import execute_phases, run_phase
from restore_recovery import restore
from server_workspace import dump_new


class PhaseIntegrationTests(unittest.TestCase):
    def test_event_payload_can_contain_path_without_shadowing_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'events.jsonl'
            d2.event_file(target, 'arm_archive', path='evaluation/s0.tar.gz', arm='s0')
            value = json.loads(target.read_text())
            self.assertEqual(value['path'], 'evaluation/s0.tar.gz')
            self.assertEqual(value['event'], 'arm_archive')

    def run_pipeline(self, root, fail=None):
        steps, now = [], datetime.now(timezone.utc)
        class Clock:
            def now(self):
                return now
        def runner(argv, **_):
            name = argv[0]
            steps.append(name)
            # Every earlier arm must already have a durable archive index before
            # the next worker/audit can run. This failed in the live v1 window.
            index = root / 'early-index.jsonl'
            rows = [json.loads(line) for line in index.read_text().splitlines()] if index.exists() else []
            self.assertEqual([r['arm'] for r in rows], list(d2.ARMS[:len(steps)-1]))
            if name == fail:
                raise subprocess.CalledProcessError(2, argv)
            if name.startswith('evaluate-'):
                arm = name.removeprefix('evaluate-')
                dump_new(root / 'evaluation' / arm / 'SYNTHETIC-WORKER.json', {'arm': arm, 'model_calls': 0})
        commands = [('evaluate-' + arm, ['evaluate-' + arm]) for arm in d2.ARMS] + [('audit', ['audit'])]
        execute_phases(commands, root, {'synthetic': True}, now + timedelta(minutes=1), Clock(),
                       phase_runner=partial(run_phase, runner=runner))
        return steps

    def test_all_four_archives_exist_before_audit_and_restore_exact_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(self.run_pipeline(root), ['evaluate-' + a for a in d2.ARMS] + ['audit'])
            rows = [json.loads(line) for line in (root / 'early-index.jsonl').read_text().splitlines()]
            self.assertEqual([r['arm'] for r in rows], list(d2.ARMS))
            for row in rows:
                self.assertEqual(row['path'], 'evaluation/' + row['arm'] + '.tar.gz')
                receipt = restore(root / row['path'], root / ('restore-' + row['arm']), row['sha256'])
                original = root / 'evaluation' / row['arm'] / 'SYNTHETIC-WORKER.json'
                restored = Path(receipt['run_directory']) / original.name
                self.assertEqual(restored.read_bytes(), original.read_bytes())
            events = [json.loads(line) for line in (root / 'events.jsonl').read_text().splitlines()]
            self.assertEqual([r['event'] for r in events], ['phase_started', 'phase_completed'] * 5)

    def test_failed_worker_does_not_start_next_worker_or_label_it_archived(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(subprocess.CalledProcessError):
                self.run_pipeline(root, fail='evaluate-t')
            rows = [json.loads(line) for line in (root / 'early-index.jsonl').read_text().splitlines()]
            self.assertEqual([r['arm'] for r in rows], ['s0'])
            self.assertFalse((root / 'evaluation/t.tar.gz').exists())
            events = [json.loads(line) for line in (root / 'events.jsonl').read_text().splitlines()]
            self.assertEqual([r['phase'] for r in events], ['evaluate-s0', 'evaluate-s0', 'evaluate-t'])


if __name__ == '__main__':
    unittest.main()
