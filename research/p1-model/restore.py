"""Native token audit + actual pg_dump/restore + fresh SQL replay before receipt.

This operates only on explicitly named loopback synthetic databases. Partial and
scripted results can never produce a complete MODEL backup receipt.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
from urllib.parse import urlsplit, urlunsplit, unquote
import uuid

from native import ROOT, audit
from relay import exclusive


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1048576), b''): h.update(b)
    return h.hexdigest()


def read(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result: raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding='utf-8'), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('non-finite JSON')))


def pg(tool, args, url, *, data=None):
    target = urlsplit(url)
    if target.hostname not in ('127.0.0.1', 'localhost') or not re.fullmatch(r'/liftcut_p1_[a-z0-9_]+', target.path):
        raise ValueError('explicit disposable loopback database required')
    values = {'PGHOST': target.hostname, 'PGPORT': str(target.port or 5432), 'PGUSER': unquote(target.username or ''),
              'PGPASSWORD': unquote(target.password or ''), 'PGDATABASE': target.path[1:], 'PGCONNECT_TIMEOUT': '10'}
    env = {**os.environ, **values}
    argv = [tool, *args]
    if platform.system() == 'Windows': argv = ['wsl', '-d', 'Ubuntu', '--', 'env', *[f'{k}={v}' for k, v in values.items()], *argv]
    result = subprocess.run(argv, env=env, input=data, capture_output=True, timeout=90)
    if result.returncode: raise RuntimeError(f'{tool} failed ({result.returncode}); database preserved')
    return result.stdout


def seal(directory):
    directory = Path(directory)
    files = sorted(p for p in directory.iterdir() if p.is_file() and p.name != 'inventory.json')
    if any(p.is_symlink() for p in files): raise ValueError('symlink refused')
    inventory = {'version': 'p1-model-backup-v1', 'files': {p.name: {'bytes': p.stat().st_size, 'sha256': sha(p)} for p in files}}
    exclusive(directory / 'inventory.json', inventory)
    return inventory


def verify_inventory(directory):
    directory = Path(directory); index = read(directory / 'inventory.json')
    if index['version'] != 'p1-model-backup-v1': raise ValueError('backup version differs')
    actual = {p.name for p in directory.iterdir() if p.is_file()} - {'inventory.json'}
    if actual != set(index['files']): raise ValueError('inventory is not exhaustive')
    for name, info in index['files'].items():
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', name) or name in ('.', '..'): raise ValueError('unsafe backup path')
        p = directory / name
        if p.is_symlink() or p.stat().st_size != info['bytes'] or sha(p) != info['sha256']: raise ValueError(f'backup bytes differ: {name}')
    return index


def native_evidence(directory, tokenizer):
    directory = Path(directory); summary = read(directory / 'summary.json')
    if summary['status'] != 'complete' or summary['cases'] != 24 or summary['kind'] not in ('model', 'scripted'):
        raise ValueError('complete 24-case evidence required')
    kind = summary['kind']; records = read(directory / 'native-records.json')
    if records['kind'] != kind: raise ValueError('native kind differs')
    cursor, prompt, completion, called, max_prompt = 0, 0, 0, 0, 0
    resume_indices = []
    for case in range(24):
        e = read(directory / f'case-{case}.json'); c = e['checkpoint']
        if e['kind'] != kind or c['caseIndex'] != case or not c['finished'] or not 0 < len(c['steps']) <= 12:
            raise ValueError('missing or invalid complete episode')
        if c['resumeIssued']: resume_indices.append(case)
        for n, step in enumerate(c['steps'], 1):
            if step['number'] != n: raise ValueError('case decision order differs')
            original = records['records'][cursor]
            if original != {'request': step['request'], 'reply': step['reply']}: raise ValueError('independent native copy differs')
            cursor += 1
            report = audit(tokenizer, step['request'], step['reply'], cursor, kind)
            prompt += report['prompt_tokens']; completion += report['completion_tokens']; called += int(report['model_called'])
            max_prompt = max(max_prompt, report['requested_prompt_tokens'])
    if cursor != len(records['records']) or cursor != summary['requests'] or called != summary['modelCalls']:
        raise ValueError('incomplete/extra native requests or usage')
    controller = read(directory / 'local-controller.json')
    if controller['automatic_transport_retries'] != 0 or controller['requests'] != cursor: raise ValueError('controller differs')
    procs = controller['processes']
    if len(procs) != len(resume_indices) + 1 or len({p['pid'] for p in procs}) != len(procs): raise ValueError('actual process restarts differ')
    for proc, case in zip(procs[:-1], resume_indices):
        frame, = proc['frames']
        if proc['returncode'] != 75 or frame['command'] != 'planned_resume' or frame['caseIndex'] != case:
            raise ValueError('unplanned restart')
        if not re.fullmatch(r'checkpoint-\d+-\d+\.json', frame['checkpoint']): raise ValueError('unsafe checkpoint')
        if sha(directory / frame['checkpoint']) != frame['checkpointSha']: raise ValueError('resume checkpoint changed')
        checkpoint = read(directory / frame['checkpoint'])
        saved = read(directory / f'case-{case}.json')['checkpoint']
        if not checkpoint['resumeIssued'] or checkpoint['steps'] != saved['steps'][:len(checkpoint['steps'])]:
            raise ValueError('resume prefix differs')
        used = read(directory / f'resume-used-{case}.json')
        if used['pid'] != procs[resume_indices.index(case) + 1]['pid']: raise ValueError('resume process identity differs')
    if procs[-1]['returncode'] != 0 or procs[-1]['frames'] != [{'command': 'complete', 'summary': summary}]:
        raise ValueError('driver did not complete')
    return {'kind': kind, 'cases': 24, 'requests': cursor, 'model_calls': called, 'prompt_tokens': prompt,
            'completion_tokens': completion, 'max_requested_prompt_tokens': max_prompt, 'planned_process_restarts': len(resume_indices)}


def verify_parent(parent):
    contract = read(ROOT / 'research/liftcut-agent/reports/candidate-d-v1.json')['contract']
    observed = {name: sha(Path(parent) / name) for name in contract['adapter_sha256']}
    if observed != contract['adapter_sha256']: raise ValueError('actual fixed parent bytes differ')
    return observed


def backup(directory, url):
    directory = Path(directory)
    with (directory / 'database.dump').open('xb') as stream:
        stream.write(pg('pg_dump', ['--format=custom'], url)); stream.flush(); os.fsync(stream.fileno())
    return seal(directory)


def restore(directory, output, tokenizer_dir, *, parent=None, partial=False):
    directory, output = Path(directory).resolve(), Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    index = verify_inventory(directory)
    if partial:
        report = {'status': 'partial', 'complete_model_receipt': False, 'verified_files': len(index['files'])}
        exclusive(output / 'partial.json', report); return report
    from transformers import AutoTokenizer
    contract = read(ROOT / 'research/liftcut-agent/reports/candidate-d-v1.json')['contract']
    for name, wanted in contract['tokenizer_provenance']['file_sha256'].items():
        if sha(Path(tokenizer_dir) / name) != wanted: raise ValueError('tokenizer bytes differ')
    tokenizer = AutoTokenizer.from_pretrained(str(tokenizer_dir), local_files_only=True, trust_remote_code=False)
    native = native_evidence(directory, tokenizer)
    weights = verify_parent(parent) if parent else None
    if native['kind'] == 'model' and not weights: raise ValueError('actual model weights must be read for complete receipt')
    if native['kind'] == 'model':
        from protocol import verify_model_evidence
        verify_model_evidence(directory, native, weights)
    url = os.environ['P1_TEST_DATABASE_URL']
    name = 'liftcut_p1_restore_' + uuid.uuid4().hex
    pg('psql', ['--set=ON_ERROR_STOP=1', '--command', f'CREATE DATABASE {name};'], url)
    parsed = urlsplit(url); restored = urlunsplit(parsed._replace(path='/' + name))
    pg('pg_restore', ['--exit-on-error', '--no-owner', '--dbname', name], restored, data=(directory / 'database.dump').read_bytes())
    env = {**os.environ, 'P1_TEST_DATABASE_URL': restored}
    replay_path = output / 'database-replay.json'
    result = subprocess.run(['node', '--conditions=react-server', '--import', 'tsx', 'research/p1-model/replay.ts', str(directory), str(replay_path)],
                            cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', timeout=90)
    exclusive(output / 'replay-process.json', {'returncode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr,
                                               'restored_database': name})
    if result.returncode: raise ValueError('actual restored database/replay failed; inspect preserved evidence')
    report = {'version': 'p1-model-backup-receipt-v1', 'status': 'complete', 'kind': native['kind'],
              'complete_model_receipt': native['kind'] == 'model', 'inventory_sha256': sha(directory / 'inventory.json'),
              'native': native, 'actual_parent_sha256': weights, 'database': read(replay_path),
              'verified_at_utc': datetime.now(timezone.utc).isoformat()}
    if native['kind'] == 'model': report['binding_sha256'] = sha(directory / 'binding.json')
    exclusive(output / 'backup-receipt.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['backup', 'restore'])
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--tokenizer-dir', type=Path)
    parser.add_argument('--parent', type=Path)
    parser.add_argument('--partial', action='store_true')
    args = parser.parse_args()
    result = backup(args.directory, os.environ['P1_TEST_DATABASE_URL']) if args.operation == 'backup' else restore(
        args.directory, args.output, args.tokenizer_dir, parent=args.parent, partial=args.partial)
    print(json.dumps(result, ensure_ascii=False))
