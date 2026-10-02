"""Publish a genuinely restored complete D2 window without creating a receipt."""
import argparse
from pathlib import Path, PurePosixPath
import shutil

from audit_counterfactual_diagnostics import audit
from d2_execution import read
from d2_receipt_transfer import validate_receipt
from server_workspace import sha256

EXECUTION = '3e4d8e208aecd86f05a7d3243942df6aefc2f73c'


def verify_inventory(run):
    rows = read(run / 'backup-inventory.json')['files']
    names = [row['path'] for row in rows]
    if len(names) != len(set(names)):
        raise ValueError('duplicate archived inventory entry')
    for row in rows:
        name = row['path']
        relative = PurePosixPath(name)
        if (relative.is_absolute() or '..' in relative.parts or ':' in name or '\\' in name
                or not relative.parts or name == 'backup-inventory.json'):
            raise ValueError('unsafe inventory path')
        path = run.joinpath(*relative.parts)
        if (path.is_symlink() or not path.is_file() or path.stat().st_size != row['bytes']
                or sha256(path) != row['sha256']):
            raise ValueError('archived file integrity differs')
    actual = {p.relative_to(run).as_posix() for p in run.rglob('*') if p.is_file()}
    if actual != set(names) | {'backup-inventory.json'}:
        raise ValueError('archive inventory must cover the exact run')
    return len(rows)


def verify_complete(run, index_path, receipt_path, prepared, tokenizer, adapters=None, *, metadata_only=False):
    index, receipt = read(index_path), read(receipt_path)
    if (index['status'] != 'complete' or index['evidence_kind'] != 'model'
            or index['binding']['code_commit'] != EXECUTION):
        raise ValueError('only the checked complete real-model v2 window may be published')
    validate_receipt(receipt_path.read_bytes(), index, index['binding'])
    if (not receipt['model_result'] or not receipt['complete_study_replayed']
            or receipt['episodes_replayed'] != 320 or not receipt['adapter_files_verified']
            or not receipt['token_ids_verified']):
        raise ValueError('genuine complete restoration receipt required')
    if verify_inventory(run) != receipt['verified_files']:
        raise ValueError('receipt file count differs from archive inventory')
    status = read(run / 'window-status.json')
    if status['status'] != 'complete' or status['binding'] != index['binding'] or status['failures']:
        raise ValueError('window status differs from complete index')
    result = audit(run, prepared, tokenizer, adapters, metadata_only=metadata_only)
    expected = read(run / 'comparison.json')
    if metadata_only:
        expected['adapter_files_verified'] = False
    if result != expected or result['binding'] != index['binding']:
        raise ValueError('independent reconstruction differs from archived comparison')
    return result


def publish(restored, index, operations, output, prepared, tokenizer, adapters):
    if output.exists():
        raise ValueError('publication destination must be new')
    run = Path(read(restored / 'restore-receipt.json')['run_directory']).resolve()
    if run.parent != restored.resolve():
        raise ValueError('restored run is outside the named restoration')
    receipt = restored / 'off-instance-backup.json'
    result = verify_complete(run, index, receipt, prepared, tokenizer, adapters)
    if result != read(restored / 'independent-audit.json'):
        raise ValueError('restorer and publication audits differ')
    output.mkdir(parents=True, exist_ok=False)
    shutil.copytree(run, output / 'run')
    for source, name in ((index, 'backup-index.json'), (receipt, 'restore-receipt.json'),
                         (operations / 'events.jsonl', 'operations.jsonl'),
                         (operations / 'server-events-latest.jsonl', 'server-events.jsonl')):
        shutil.copyfile(source, output / name)
    verify_inventory(output / 'run')
    return {'published_cases': result['episodes_replayed'], 'original_receipt_sha256': sha256(receipt),
            'new_receipts_created': 0, 'new_model_calls': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('restored-dir', 'index', 'operations', 'output-dir', 'prepared-dir', 'tokenizer-dir', 'adapters-root'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    print(publish(args.restored_dir, args.index, args.operations, args.output_dir,
                  args.prepared_dir, args.tokenizer_dir, args.adapters_root))
