"""Actual local Git roundtrip; no network, server, credential or GPU."""
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from d2_bundle import git, install_bundle


@unittest.skipUnless(shutil.which('git'), 'Git executable required')
class BundleTests(unittest.TestCase):
    def repository(self, root):
        repo = root / 'source'
        git('init', '-b', 'main', repo)
        (repo / 'SYNTHETIC.txt').write_text('base\n')
        git('-C', repo, 'add', 'SYNTHETIC.txt')
        git('-C', repo, '-c', 'user.name=CPU Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'base')
        base = git('-C', repo, 'rev-parse', 'HEAD')
        seed = root / 'immutable-base'
        git('clone', '--no-hardlinks', repo, seed)
        (repo / 'SYNTHETIC.txt').write_text('changed\n')
        git('-C', repo, 'add', 'SYNTHETIC.txt')
        git('-C', repo, '-c', 'user.name=CPU Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'next')
        target = git('-C', repo, 'rev-parse', 'HEAD')
        bundle = root / 'incremental.bundle'
        git('-C', repo, 'bundle', 'create', bundle, 'main', '^' + base)
        return repo, seed, base, target, bundle

    def test_delta_applies_offline_without_changing_base_and_complete_checkout_reuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo, seed, base, target, bundle = self.repository(root)
            checkout = root / 'new-checkout'
            result = install_bundle(bundle, checkout, target, seed, base)
            self.assertEqual(result['network_calls'], 0)
            self.assertEqual((checkout / 'SYNTHETIC.txt').read_text(), 'changed\n')
            self.assertEqual((seed / 'SYNTHETIC.txt').read_text(), 'base\n')
            self.assertEqual(git('-C', checkout, 'rev-parse', 'HEAD^{tree}'), git('-C', repo, 'rev-parse', 'HEAD^{tree}'))
            self.assertEqual(install_bundle(bundle, checkout, target, seed, base), result)

    def test_dirty_or_wrong_base_rejected_before_target_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, seed, base, target, bundle = self.repository(root)
            (seed / 'SYNTHETIC.txt').write_text('tampered\n')
            for expected in (base, target):
                with self.assertRaises(ValueError):
                    install_bundle(bundle, root / 'never-created', target, seed, expected)
                self.assertFalse((root / 'never-created').exists())


if __name__ == '__main__':
    unittest.main()
