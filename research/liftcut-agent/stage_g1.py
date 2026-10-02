"""Stage exact G1 code and nested paired data offline; no network or rental."""
import argparse
from pathlib import Path
import re
import shutil
import tarfile

from g1_execution import ROOT, EXECUTION, verify_plan
from prepare_counterfactual_diagnostics import load_tokenizer, verify_prepared as verify_d2
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from server_workspace import command, dump_new, sha256


def stage(output, prepared, diagnostic, d2, tokenizer, commit, source_ref, base_commit, name):
    if output.exists() or not re.fullmatch(r'[A-Za-z0-9_-]+', name):
        raise ValueError('fresh staging directory and simple identifier required')
    if (not re.fullmatch(r'[0-9a-f]{40}', commit) or not re.fullmatch(r'[0-9a-f]{40}', base_commit)
            or command(['git', 'rev-parse', source_ref], ROOT) != commit or commit == base_commit
            or command(['git', 'merge-base', base_commit, commit], ROOT) != base_commit
            or command(['git', 'status', '--porcelain'], ROOT) or command(['git', 'diff', commit, '--', '.'], ROOT)):
        raise ValueError('checked clean commit and original immutable ancestor required')
    plan = verify_plan(prepared)
    verify_diagnostic(diagnostic)
    verify_d2(d2)
    load_tokenizer(tokenizer)
    output.mkdir(parents=True, exist_ok=False)
    command(['git', 'bundle', 'create', str((output / 'code.bundle').resolve()), source_ref, '^' + base_commit], ROOT)
    command(['git', 'bundle', 'verify', str((output / 'code.bundle').resolve())], ROOT)
    for item in ('g1_setup.py', 'shutdown_guard.py', 'd2_bundle.py', 'g1_prelaunch_guard.py'):
        shutil.copyfile(ROOT / item, output / item)
    inventory = {}
    with tarfile.open(output / 'assets.tar.gz', 'w:gz') as tar:
        for label, directory in (('prepared', prepared), ('diagnostic', diagnostic), ('d2', d2), ('tokenizer', tokenizer)):
            for path in sorted(directory.rglob('*')):
                if path.is_symlink():
                    raise ValueError('no symlinked staged assets')
                if path.is_file():
                    name_in_tar = label + '/' + path.relative_to(directory).as_posix()
                    inventory[name_in_tar] = {'bytes': path.stat().st_size, 'sha256': sha256(path)}
                    tar.add(path, arcname=name_in_tar, recursive=False)
    if len(inventory) > 48 or sum(v['bytes'] for v in inventory.values()) > 256_000_000:
        raise ValueError('staged data exceeds frozen installation bounds')
    dump_new(output / 'asset-index.json', inventory)
    files = {p.name: {'bytes': p.stat().st_size, 'sha256': sha256(p)} for p in sorted(output.iterdir()) if p.is_file()}
    spec = {'execution_commit': commit, 'bundle_base_commit': base_commit,
            'execution_plan_sha256': sha256(EXECUTION), 'remote_stage': '/root/autodl-tmp/liftcut/staging/g1-' + name,
            'files': files, 'budget': plan['budget'], 'new_model_calls': 0, 'server_state_verified': False,
            'launch': 'Use launch_g1_remote.py only after a new authorized opening; no automatic restart.'}
    dump_new(output / 'stage.json', spec)
    return spec


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('output-dir', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    for name in ('execution-commit', 'source-ref', 'base-commit', 'name'):
        p.add_argument('--' + name, required=True)
    args = p.parse_args()
    print(stage(args.output_dir, args.prepared_dir, args.diagnostic_dir, args.d2_dir, args.tokenizer_dir,
                args.execution_commit, args.source_ref, args.base_commit, args.name))
