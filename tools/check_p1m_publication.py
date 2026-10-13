"""Check byte-exact CPU observations; extraction never executes archived code."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'research/liftcut-agent/reports/p1m-readiness-2026-10-13'


def check(output):
    manifest = json.loads((PUBLIC/'sha256.json').read_text(encoding='utf-8'))
    for name, meta in manifest.items():
        if not re.fullmatch(r'[a-z0-9.-]+', name): raise ValueError('unsafe public path')
        data = (PUBLIC/name).read_bytes()
        if len(data) != meta['bytes'] or hashlib.sha256(data).hexdigest() != meta['sha256']: raise ValueError('public bytes differ: '+name)
    receipt = json.loads((PUBLIC/'backup-receipt.json').read_text(encoding='utf-8'))
    if receipt['kind'] != 'scripted' or receipt['complete_model_receipt'] or receipt['native']['model_calls']:
        raise ValueError('preparation must remain scripted')
    output.mkdir(parents=True, exist_ok=False)
    with tarfile.open(PUBLIC/'scripted-evidence.tar.gz', 'r:gz') as archive:
        seen = set()
        for member in archive:
            if not member.isfile() or not re.fullmatch(r'[A-Za-z0-9_.-]+', member.name) or member.name in ('.','..') or member.name in seen:
                raise ValueError('unsafe/duplicate evidence member')
            seen.add(member.name)
            with (output/member.name).open('xb') as stream: stream.write(archive.extractfile(member).read())
    print(json.dumps({'public_files': len(manifest), 'scripted_model_calls': 0, 'extracted_evidence_files': len(seen)}))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--extract-dir', type=Path, required=True)
    check(p.parse_args().extract_dir)
