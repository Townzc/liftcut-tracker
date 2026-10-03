"""Restore actual unchanged I1 weights, original traces and projected input tokens."""
import argparse
from pathlib import Path

from audit_i1 import audit
from d2_execution import read
from i1_receipt_transfer import receipt_fields, validate_index
from restore_recovery import restore
from server_workspace import dump_new


def assemble(archives, output, diagnostic, d2, tokenizer, *, allow_partial=False, scripted=False, plan=None):
    if output.exists():
        raise ValueError('new I1 restoration destination required')
    index = read(archives / 'backup-index.json')
    kind = 'scripted_contract' if scripted else 'model'
    validate_index(index, index['binding'], kind=kind)
    if index['status'] != 'complete' and not allow_partial:
        raise ValueError('partial I1 restoration must be explicit')
    item = index['archives'][0]
    path = archives / item['archive']
    if path.stat().st_size != item['bytes']:
        raise ValueError('I1 archive size mismatch')
    recovered = restore(path, output / 'parts', item['sha256'])
    run = output / 'parts/evidence'
    if Path(recovered['run_directory']).resolve() != run.resolve():
        raise ValueError('I1 archive root differs')
    status = read(run / 'window-status.json')
    if status['status'] != index['status'] or status['binding'] != index['binding']:
        raise ValueError('I1 restored status differs from bound index')
    if index['status'] == 'complete':
        result = audit(run, diagnostic, d2, tokenizer, scripted=scripted, plan=plan)
        if result != read(run / 'comparison.json') or result['binding'] != index['binding']:
            raise ValueError('I1 restored weight/native/projection/token audit differs')
        dump_new(output / 'independent-audit.json', result)
    receipt = {**receipt_fields(index, index['binding'], kind=kind),
               'verified_files': recovered['verified_files']}
    dump_new(output / 'restore-receipt.json', recovered)
    dump_new(output / 'off-instance-backup.json', receipt)
    return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('archive-dir', 'output-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--allow-partial', action='store_true')
    a = p.parse_args()
    print(assemble(a.archive_dir, a.output_dir, a.diagnostic_dir, a.d2_dir, a.tokenizer_dir,
                   allow_partial=a.allow_partial))
