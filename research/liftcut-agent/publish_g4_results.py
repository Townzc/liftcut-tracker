"""Publish restored G4 evidence without weights or manufacturing recovery receipts."""
import argparse
from copy import deepcopy
from pathlib import Path, PurePosixPath
import shutil
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))

from audit_g4 import audit
from d2_execution import read
from g4_receipt_transfer import validate_index, validate_receipt
from liftcut_agent.benchmark import read_jsonl
from prepare_g4 import ARMS
from server_workspace import dump_new, sha256

EXECUTION = '10a729eb0f8f55ba9d1b6888f5d6cdb9ac88fd28'
WEIGHTS = {f'training/{a}/final/adapter_model.safetensors' for a in ARMS}
POWER_FILES = ('backup-copy-status.json', 'launch.json', 'opening.json')


def inventory(run):
    """Merge the three original inventories; never regenerate their contents."""
    files, inventories = {}, set()
    for prefix in ('', *(f'training/{a}/' for a in ARMS)):
        manifest = prefix + 'backup-inventory.json'
        inventories.add(manifest)
        rows = read(run / manifest)['files']
        for row in rows:
            name = row['path']
            p = PurePosixPath(name)
            if (not p.parts or p.is_absolute() or '..' in p.parts or ':' in name or '\\' in name
                    or str(p) != name or name == 'backup-inventory.json'
                    or (not prefix and p.parts[0] == 'training')):
                raise ValueError('unsafe G4 inventory path')
            full = prefix + name
            if full in files:
                raise ValueError('duplicate G4 inventory entry')
            files[full] = {k: row[k] for k in ('bytes', 'sha256')}
    if not WEIGHTS <= files.keys():
        raise ValueError('both original weight entries are required')
    return files, inventories


def verify_inventory(run, *, metadata_only=False):
    files, inventories = inventory(run)
    omitted = WEIGHTS if metadata_only else set()
    actual = set()
    for p in run.rglob('*'):
        if p.is_symlink():
            raise ValueError('symlinks are not publication evidence')
        if p.is_file():
            actual.add(p.relative_to(run).as_posix())
    if actual != (set(files) - omitted) | inventories:
        raise ValueError('exact G4 inventory required; only the two weights may be omitted')
    for name, row in files.items():
        if name not in omitted:
            path = run / name
            if path.stat().st_size != row['bytes'] or sha256(path) != row['sha256']:
                raise ValueError('G4 archived file integrity differs')
    return len(files)


def verify_complete(run, index_path, receipt_path, prepared, diagnostic, d2, tokenizer, *, metadata_only=False):
    index = read(index_path)
    if (index.get('status') != 'complete' or index.get('evidence_kind') != 'model'
            or index['binding']['code_commit'] != EXECUTION):
        raise ValueError('only checked complete real-model G4 evidence may be published')
    validate_index(index, index['binding'])
    receipt = validate_receipt(receipt_path.read_bytes(), index, index['binding'])
    if verify_inventory(run, metadata_only=metadata_only) != receipt['verified_files']:
        raise ValueError('restored receipt inventory count differs')
    status = read(run / 'window-status.json')
    if status['status'] != 'complete' or status['binding'] != index['binding'] or status['failures']:
        raise ValueError('complete G4 window status differs')
    early = read_jsonl(run / 'early-index.jsonl')
    if [r['arm'] for r in early] != list(ARMS):
        raise ValueError('both ordered early G4 archives required')
    for row, item in zip(early, index['archives']):
        if row['binding'] != index['binding'] or any(row[k] != item[k] for k in ('path', 'archive', 'bytes', 'sha256')):
            raise ValueError('early G4 archives differ from final inventory')
    result = audit(run, prepared, diagnostic, d2, tokenizer, verify_weights=not metadata_only)
    expected = deepcopy(read(run / 'comparison.json'))
    if metadata_only:
        expected['adapter_files_verified'] = False
        expected['weights'] = {a: None for a in ARMS}
    if result != expected or result['binding'] != index['binding']:
        raise ValueError('independent G4 reconstruction differs from archived comparison')
    return result


def publish(restored, index, operations, output, prepared, diagnostic, d2, tokenizer):
    if output.exists():
        raise ValueError('publication destination must be new')
    run = Path(read(restored / 'restore-receipt.json')['run_directory']).resolve()
    if run != restored.resolve() / 'run':
        raise ValueError('restored run is outside the named restoration')
    receipt = restored / 'off-instance-backup.json'
    result = verify_complete(run, index, receipt, prepared, diagnostic, d2, tokenizer)
    if result != read(restored / 'independent-audit.json'):
        raise ValueError('restoration and publication audits differ')
    events = read_jsonl(operations / 'events.jsonl')
    if not events or events[-1]['event'] not in {'collector_finished'}:
        raise ValueError('sole collector must end before freezing public operations')
    verified = [r for r in events if r['event'] == 'off_instance_verified']
    if len(verified) != 1 or verified[0]['receipt'] != read(receipt):
        raise ValueError('missing original actual-weight restoration observation')
    files, inventories = inventory(run)
    output.mkdir(parents=True, exist_ok=False)
    for name in sorted((set(files) - WEIGHTS) | inventories):
        dest = output / 'run' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(run / name, dest)
    for source, name in ((index, 'backup-index.json'), (receipt, 'restore-receipt.json'),
                         (operations / 'events.jsonl', 'operations.jsonl'),
                         (operations / 'server-events-latest.jsonl', 'server-events.jsonl')):
        shutil.copyfile(source, output / name)
    for name in POWER_FILES:
        shutil.copyfile(operations / name, output / name)
    verify_inventory(output / 'run', metadata_only=True)
    record = {'version': 'g4-publication-v1', 'binding': result['binding'],
              'original_receipt_sha256': sha256(receipt),
              'public_files_sha256': {p.relative_to(output).as_posix(): sha256(p)
                                      for p in sorted(output.rglob('*')) if p.is_file()},
              'omitted_weight_files': {n: files[n] for n in sorted(WEIGHTS)},
              'episodes_replayed': 222, 'actual_weights_checked_before_publication': True,
              'new_receipts_created': 0, 'new_model_calls': 0, 'test_episodes': 0}
    dump_new(output / 'publication.json', record)
    return {k: record[k] for k in ('episodes_replayed', 'new_receipts_created', 'new_model_calls')}


def publication_integrity(public):
    record = read(public / 'publication.json')
    if (record['version'] != 'g4-publication-v1' or record['episodes_replayed'] != 222
            or record['new_receipts_created'] != 0 or record['new_model_calls'] != 0
            or not record['actual_weights_checked_before_publication']):
        raise ValueError('publication is not a complete actual G4 record')
    for name, checksum in record['public_files_sha256'].items():
        path = public / name
        if not path.resolve().is_relative_to(public.resolve()) or path.is_symlink() or sha256(path) != checksum:
            raise ValueError('public evidence differs from copied original bytes')
    files, inventories = inventory(public / 'run')
    required = {'run/' + n for n in (set(files) - WEIGHTS) | inventories}
    required |= {'backup-index.json', 'restore-receipt.json', 'operations.jsonl', 'server-events.jsonl'}
    required |= set(POWER_FILES)
    if set(record['public_files_sha256']) != required:
        raise ValueError('publication provenance must cover all original public files')
    if (record['omitted_weight_files'] != {n: files[n] for n in sorted(WEIGHTS)}
            or record['original_receipt_sha256'] != sha256(public / 'restore-receipt.json')
            or record['binding'] != read(public / 'backup-index.json')['binding']):
        raise ValueError('original receipt/weight inventory binding differs')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('restored-dir', 'index', 'operations', 'output-dir', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    print(publish(a.restored_dir, a.index, a.operations, a.output_dir, a.prepared_dir, a.diagnostic_dir, a.d2_dir, a.tokenizer_dir))
