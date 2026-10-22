"""Pack/restore a bound v6 window, including both sets of weights.

The caller supplies the reviewed commit and original work deadline. No default
live window, network access, acknowledgement, or shutdown is performed here.
"""
import argparse, hashlib, json, re, shutil, subprocess, tarfile, time
from pathlib import Path

WINDOW = 'UNBOUND-v6'
COMMIT = 'UNBOUND'
STOP = 0.0
STATES = ('development-passed-not-release', 'below-threshold', 'stopped')
STREAMS = ('H', 'T', 'S-HF', 'S-F16', 'S')
WEIGHTS = tuple('run/' + arm + '/' + name for arm in ('T', 'S') for name in
    ('model/adapter/adapter_model.safetensors', 'model/merged/model.safetensors',
     'gguf/parser-f16.gguf', 'gguf/parser-q8_0.gguf'))

def configure(window, commit, stop):
    global WINDOW, COMMIT, STOP
    if not __debug__:
        raise RuntimeError('backup verification requires Python assertions enabled')
    if not re.fullmatch(r'm4-v6-\d{8}T\d{6}Z', window) or not re.fullmatch(r'[0-9a-f]{40}', commit) or stop <= 0:
        raise ValueError('a fresh bound v6 window, exact commit and original deadline are required')
    WINDOW, COMMIT, STOP = window, commit, stop

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(4 * 1024**2), b''): h.update(b)
    return h.hexdigest()

def safe(root, name):
    if not name or name.startswith('/') or '\\' in name or ':' in name or '..' in name.split('/'):
        raise ValueError('unsafe member')
    target = (root / name).resolve()
    if not target.is_relative_to(root.resolve()): raise ValueError('outside root')
    return target

def state_check(run):
    state = json.loads((run/'run.json').read_text())
    assert state['state'] in STATES and state['commit'] == COMMIT
    assert state['stopAt'] == STOP
    return state

def pack(root, staged=None):
    state_check(root/'run')
    assert (root/'exit.json').is_file(), 'driver not finished'
    manifest = json.loads((root/'run/sha256.json').read_text())
    names = ['run/' + n for n in manifest] + ['run/sha256.json']
    names += ['window.json', 'launch.json', 'exit.json', 'driver.py', 'driver.log', 'source.bundle',
              'backup_v6.py', 'observe.py', 'resources.jsonl', 'observer.log', 'status.py']
    files = {}
    for name in names:
        assert not (root / name).is_symlink(), 'symlink source'
        p = safe(root, name)
        assert p.is_file() and not p.is_symlink(), name
        digest = sha(p)
        if name.startswith('run/') and name != 'run/sha256.json': assert digest == manifest[name[4:]], name
        files[name] = {'sha256': digest, 'bytes': p.stat().st_size}
    external = json.loads(staged.read_text()) if staged else {}
    assert set(external).issubset(files)
    for name, local_name in external.items():
        assert name in WEIGHTS and '/' not in local_name and '\\' not in local_name
        safe(root, local_name)
    out = root/'backup'; out.mkdir(exist_ok=False)
    (out/'members.txt').write_text('\n'.join(sorted(set(files)-set(external))) + '\n')
    proc = subprocess.Popen(['tar', '-C', str(root), '-cf', '-', '-T', str(out/'members.txt')], stdout=subprocess.PIPE)
    whole = hashlib.sha256(); parts = []; current = None; size = 0; index = 0
    try:
        while True:
            data = proc.stdout.read(1024**2)
            if not data: break
            if current is None:
                path = out/f'archive.part-{index:04d}'; current = path.open('xb'); size = 0
            current.write(data); whole.update(data); size += len(data)
            if size >= 128 * 1024**2:
                current.close(); current = None
                parts.append({'name':path.name, 'bytes':size, 'sha256':sha(path)}); index += 1
        if current:
            current.close(); current = None
            parts.append({'name':path.name, 'bytes':size, 'sha256':sha(path)})
        assert proc.wait(timeout=60) == 0
    finally:
        if current: current.close()
        if proc.poll() is None: proc.kill(); proc.wait()
        proc.stdout.close()
    report = {'windowId':WINDOW, 'commit':COMMIT, 'createdAt':time.time(), 'archiveSha256':whole.hexdigest(),
              'runManifestSha256':sha(root/'run/sha256.json'), 'files':files, 'externalFiles':external, 'parts':parts}
    (out/'manifest.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'parts':len(parts), 'files':len(files), 'bytes':sum(p['bytes'] for p in parts),
                      'manifestSha256':sha(out/'manifest.json')}))

class Parts:
    def __init__(self, paths): self.paths = iter(paths); self.file = None
    def read(self, n):
        result = bytearray()
        while len(result) < n:
            if self.file is None:
                try: self.file = next(self.paths).open('rb')
                except StopIteration: break
            data = self.file.read(n-len(result))
            if data: result.extend(data)
            else: self.file.close(); self.file = None
        return bytes(result)
    def close(self):
        if self.file: self.file.close()

def restore(root, manifest_sha):
    assert sha(root/'manifest.json') == manifest_sha, 'manifest hash'
    report = json.loads((root/'manifest.json').read_text())
    assert report['windowId'] == WINDOW and report['commit'] == COMMIT
    paths = []; whole = hashlib.sha256()
    for i, part in enumerate(report['parts']):
        assert part['name'] == f'archive.part-{i:04d}'
        p = safe(root, part['name']); assert p.stat().st_size == part['bytes'] and sha(p) == part['sha256'], 'part hash'
        paths.append(p)
        with p.open('rb') as f:
            for b in iter(lambda:f.read(4*1024**2), b''): whole.update(b)
    assert whole.hexdigest() == report['archiveSha256'], 'archive hash'
    out = root/'restored'; out.mkdir(exist_ok=False)
    external = report.get('externalFiles', {})
    assert set(external).issubset(report['files'])
    stream = Parts(paths); seen = set()
    try:
        with tarfile.open(fileobj=stream, mode='r|') as tar:
            for member in tar:
                target = safe(out, member.name)
                assert member.isfile() and member.name in report['files'] and member.name not in seen and member.name not in external, 'unexpected member'
                assert member.size == report['files'][member.name]['bytes']
                seen.add(member.name); target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as f: shutil.copyfileobj(tar.extractfile(member), f, 4*1024**2)
    finally: stream.close()
    assert seen | set(external) == set(report['files']), 'missing member'
    for name, local_name in external.items():
        assert name in WEIGHTS and '/' not in local_name and '\\' not in local_name, 'unexpected staged file'
        source = safe(root, local_name); spec = report['files'][name]
        assert source.is_file() and source.stat().st_size == spec['bytes'] and sha(source) == spec['sha256'], 'staged file hash'
        target = safe(out, name); target.parent.mkdir(parents=True, exist_ok=True)
        with source.open('rb') as src, target.open('xb') as dst: shutil.copyfileobj(src, dst, 4*1024**2)
    for name, spec in report['files'].items():
        p = safe(out, name)
        assert p.stat().st_size == spec['bytes'] and sha(p) == spec['sha256'], name
    run = out/'run'; assert sha(run/'sha256.json') == report['runManifestSha256']
    run_manifest = json.loads((run/'sha256.json').read_text())
    for name, digest in run_manifest.items(): assert sha(safe(run, name)) == digest, name
    state = state_check(run); counts = {}
    for arm in STREAMS:
        p = run/(arm+'.jsonl')
        if not p.exists():
            assert state['state'] == 'stopped', 'missing completed prediction stream'
            continue
        rows = [json.loads(line) for line in p.read_text(encoding='utf-8').splitlines()]
        assert len({r['id'] for r in rows}) == len(rows)
        counts[arm] = len(rows)
        if state['state'] != 'stopped': assert len(rows) == 1040
    if state['state'] != 'stopped':
        assert set(WEIGHTS).issubset(report['files']), 'missing completed weight'
        assert {n[4:] for n in WEIGHTS}.issubset(run_manifest), 'weight missing from run manifest'
    receipt = {'verified':True, 'windowId':WINDOW, 'manifestSha256':report['runManifestSha256'],
               'archiveManifestSha256':manifest_sha, 'archiveSha256':report['archiveSha256'],
               'files':len(run_manifest), 'bytes':sum(p['bytes'] for p in report['files'].values()),
               'state':state['state'], 'predictionRows':counts, 'restored':str(run), 'verifiedAt':time.time()}
    (root/'backup-verification.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))
    return receipt

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('operation', choices=['pack','restore']); ap.add_argument('root', type=Path); ap.add_argument('--manifest-sha'); ap.add_argument('--staged', type=Path)
    ap.add_argument('--window-id', required=True); ap.add_argument('--commit', required=True); ap.add_argument('--stop-at', required=True, type=float)
    args = ap.parse_args()
    configure(args.window_id, args.commit, args.stop_at)
    if args.operation == 'pack': pack(args.root, args.staged)
    else: restore(args.root, args.manifest_sha)
