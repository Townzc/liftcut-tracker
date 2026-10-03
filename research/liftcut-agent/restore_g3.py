"""Restore G3 training bytes and 222 actual native/environment/token replays."""
import argparse
from pathlib import Path
import shutil

from audit_g3 import audit
from d2_execution import read
from liftcut_agent.benchmark import read_jsonl
from g3_receipt_transfer import receipt_fields, validate_index
from restore_recovery import restore
from server_workspace import dump_new


def assemble(archives, output, prepared, diagnostic, d2, tokenizer, *, allow_partial=False, scripted=False):
    if output.exists():
        raise ValueError('new restoration directory required')
    index = read(archives / 'backup-index.json')
    kind = 'scripted_contract' if scripted else 'model'
    validate_index(index, index['binding'], kind=kind)
    if index['status'] != 'complete' and not allow_partial:
        raise ValueError('partial restore must be explicit')
    receipts = []
    for item in index['archives']:
        path = archives / item['archive']
        if path.stat().st_size != item['bytes']:
            raise ValueError('archive size differs')
        part = item['part']
        result = restore(path, output / 'parts' / part, item['sha256'])
        if Path(result['run_directory']).resolve() != (output / 'parts' / part / part).resolve():
            raise ValueError('unexpected G3 archive root')
        receipts.append(result)
    run = output / 'run'
    shutil.copytree(output / 'parts/evidence/evidence', run)
    for item in index['archives']:
        if item['part'] != 'evidence':
            part = item['part']
            shutil.copytree(output / 'parts' / part / part, run / 'training' / part)
    status = read(run / 'window-status.json')
    if status['status'] != index['status'] or status['binding'] != index['binding']:
        raise ValueError('restored window differs from index')
    early_path = run / 'early-index.jsonl'
    early = read_jsonl(early_path) if early_path.exists() else []
    if index['status'] == 'complete' and [r['arm'] for r in early] != ['stop_half', 'stop_all']:
        raise ValueError('complete G3 lacks both ordered early archives')
    seen = set()
    for row in early:
        if row['arm'] in seen or row['binding'] != index['binding']:
            raise ValueError('early G3 archive identity changed')
        seen.add(row['arm'])
        matches = [i for i in index['archives'] if i['part'] == row['arm']]
        if len(matches) != 1 or any(matches[0][k] != row[k] for k in ('path', 'archive', 'bytes', 'sha256')):
            raise ValueError('final G3 inventory differs from early backup')
    if index['status'] == 'complete':
        result = audit(run, prepared, diagnostic, d2, tokenizer, scripted=scripted)
        if result != read(run / 'comparison.json') or result['binding'] != index['binding']:
            raise ValueError('restored comparison differs from actual-weight/native/token audit')
        dump_new(output / 'independent-audit.json', result)
    verified = {**receipt_fields(index, index['binding'], kind=kind),
                'verified_files': sum(r['verified_files'] for r in receipts)}
    dump_new(output / 'restore-receipt.json', {'run_directory': str(run), 'parts': receipts})
    dump_new(output / 'off-instance-backup.json', verified)
    return verified


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('archive-dir', 'output-dir', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--allow-partial', action='store_true')
    args = p.parse_args()
    print(assemble(args.archive_dir, args.output_dir, args.prepared_dir, args.diagnostic_dir,
                   args.d2_dir, args.tokenizer_dir, allow_partial=args.allow_partial))
