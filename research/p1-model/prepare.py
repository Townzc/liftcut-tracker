"""Offline immutable source freeze and small code-only stage; no SSH/model calls."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

from protocol import ROOT, MANIFEST, STUDY, read, sha, verify_sources
from relay import exclusive


def source_names():
    old = read(ROOT / 'research/liftcut-agent/reports/e1-execution-v2.json')['source_sha256']
    names = {'research/liftcut-agent/' + name for name in old}
    # Unlike old incremental stages, this pack must import in an empty directory.
    # Include the complete read-only Python package, not just its entry point.
    names.update(str(p.relative_to(ROOT)).replace('\\', '/') for p in (ROOT / 'research/liftcut-agent/src/liftcut_agent').rglob('*.py'))
    names.update(str(p.relative_to(ROOT)).replace('\\', '/') for p in (ROOT / 'research/p1-model').iterdir() if p.suffix in ('.py', '.ts'))
    names.update(str(p.relative_to(ROOT)).replace('\\', '/') for p in (ROOT / 'src/services/agent').glob('*.ts'))
    names.update(['src/lib/agent/contracts.ts', 'src/lib/ai/schemas.ts', 'research/p1-application/cases.ts', 'research/p1-application/evidence.ts',
                  'research/liftcut-agent/reports/candidate-d-v1.json', 'research/liftcut-agent/reports/e1-execution-v2.json',
                  'supabase/schema.sql', 'supabase/migrations/20261013203030_p1_application_transactions.sql',
                  'tests/agent-db/bootstrap.sql', 'tests/agent-db/setup.ts', 'package.json', 'package-lock.json', 'tsconfig.json'])
    for name, wanted in old.items():
        if sha(ROOT / 'research/liftcut-agent' / name) != wanted: raise ValueError('historical E1 source was changed')
    return sorted(names)


def freeze():
    value = {'study': STUDY, 'new_application_system': True, 'development_workflows': 24, 'model_calls_during_preparation': 0,
             'limits': {'requestsPerCase': 12, 'cases': 24, 'outputTokens': 512, 'contextTokens': 4096},
             'window_minutes': {'work': 60, 'collection': 80, 'hard': 90}, 'hourly_cny': 2.18, 'reserve_cny': 4,
             'sources': {name: sha(ROOT / name) for name in source_names()}}
    exclusive(MANIFEST, value)
    return value


def stage(output):
    plan = verify_sources()
    files = {name: (ROOT / name).read_bytes() for name in plan['sources']}
    files[str(MANIFEST.relative_to(ROOT)).replace('\\', '/')] = MANIFEST.read_bytes()
    # Deterministic tar members; no weights, databases, cookies or dependencies.
    output = Path(output)
    with output.open('xb') as raw:
        import gzip
        with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode='w') as archive:
                for name, data in sorted(files.items()):
                    info = tarfile.TarInfo(name); info.size = len(data); info.mode = 0o644; info.mtime = 0
                    archive.addfile(info, io.BytesIO(data))
    return {'sha256': sha(output), 'bytes': output.stat().st_size, 'sources': len(plan['sources']), 'assets_uploaded': 0}


def install(archive, output):
    output = Path(output); output.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive, 'r:gz') as source:
        seen = set()
        for entry in source:
            name = entry.name; p = Path(name)
            if not entry.isfile() or p.is_absolute() or '..' in p.parts or ':' in name or '\\' in name or name in seen:
                raise ValueError('unsafe/duplicate stage member')
            seen.add(name); target = output / name; target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as stream: stream.write(source.extractfile(entry).read())
    verify_sources(output, output / MANIFEST.relative_to(ROOT))
    for cli in ('worker.py', 'launch.py', 'restore.py', 'prepare.py'):
        r = subprocess.run([sys.executable, str(output / 'research/p1-model' / cli), '--help'], capture_output=True, timeout=30)
        if r.returncode: raise ValueError(f'stage CLI import failed: {cli}; {r.stderr.decode(errors="replace")[:400]}')
    return {'actual_new_directory_installed': True, 'source_count': len(read(MANIFEST)['sources']), 'cli_imports': 4, 'gpu_calls': 0}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('operation', choices=['freeze', 'check', 'stage', 'install']); p.add_argument('--archive', type=Path); p.add_argument('--output', type=Path)
    a = p.parse_args()
    result = freeze() if a.operation == 'freeze' else verify_sources() if a.operation == 'check' else stage(a.output) if a.operation == 'stage' else install(a.archive, a.output)
    print(json.dumps(result, ensure_ascii=False))
