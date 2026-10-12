"""Bounded, network-free I2 asset installation. Standalone bootstrap, no GPU imports."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile


def sha(path):
    with Path(path).open('rb') as f:
        value = hashlib.sha256()
        for block in iter(lambda: f.read(1024*1024), b''): value.update(block)
        return value.hexdigest()


def install_assets(archive, index, destination):
    destination = Path(destination)
    if (destination.exists() or destination.is_symlink() or not index or len(index) > 150
            or any(type(v['bytes']) is not int or v['bytes'] < 0 for v in index.values())
            or sum(x['bytes'] for x in index.values()) > 512_000_000):
        raise ValueError('fresh bounded I2 asset destination required')
    for name in index:
        p = PurePosixPath(name)
        if p.is_absolute() or '\\' in name or ':' in name or '..' in p.parts or str(p) != name:
            raise ValueError('unsafe asset name')
    # Verify all archive names/types/sizes before any extraction.
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) != len(index) or {m.name for m in members} != set(index):
            raise ValueError('asset inventory differs')
        if any(not m.isfile() or m.size != index[m.name]['bytes'] for m in members):
            raise ValueError('unsafe asset member')
        destination.mkdir(parents=True, exist_ok=False)
        for m in members:
            path = destination/m.name
            if not path.resolve().is_relative_to(destination.resolve()): raise ValueError('asset escape')
            path.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(m) as source, path.open('xb') as sink: shutil.copyfileobj(source, sink)
            if sha(path) != index[m.name]['sha256']: raise ValueError('asset SHA differs')
    return {'verified_files': len(index), 'network_calls': 0}


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(allow_abbrev=False)
    for n in ('archive', 'index', 'destination'): p.add_argument('--'+n, type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(install_assets(a.archive, json.loads(a.index.read_text()), a.destination)))
