"""Offline Git bundle installation, including a verified immutable base checkout."""
from pathlib import Path
import re
import subprocess


def git(*args):
    return subprocess.check_output(['git', *map(str, args)], text=True, encoding='utf-8').strip()


def checked_checkout(path, commit):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('full commit required')
    if git('-C', path, 'rev-parse', 'HEAD') != commit or git('-C', path, 'status', '--porcelain'):
        raise ValueError('immutable checkout differs from its exact commit')


def install_bundle(bundle, checkout, commit, base_checkout=None, base_commit=None):
    """No network. A delta requires the old clean base; never mutate that base."""
    bundle, checkout = Path(bundle).resolve(), Path(checkout).resolve()
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or bool(base_checkout) != bool(base_commit):
        raise ValueError('exact target and paired base path/commit required')
    if not checkout.exists():
        if base_commit:
            base = Path(base_checkout).resolve()
            if base == checkout:
                raise ValueError('new checkout must be separate from base')
            checked_checkout(base, base_commit)
            git('clone', '--no-hardlinks', '--no-checkout', base, checkout)
            git('-C', checkout, 'bundle', 'verify', bundle)
            git('-C', checkout, 'fetch', '--no-tags', bundle, commit)
        else:
            git('clone', '--no-checkout', bundle, checkout)
        git('-C', checkout, 'checkout', '--detach', commit)
    checked_checkout(checkout, commit)
    return {'checkout_verified': True, 'base_commit': base_commit, 'network_calls': 0}
