"""Restore E1 delta plus actual original parent; emit a receipt only after real verification."""
import argparse
from pathlib import Path
import tarfile
from audit_e1 import audit
from d2_execution import read
from e1_execution import verify_plan, validate_opening
from e1_receipt import validate_index, fields
from restore_recovery import restore
from server_workspace import dump_new, sha256


def assemble(archives, output, tokenizer, parent, receipt=None, parent_index=None, *,
             allow_partial=False, scripted=False, plan=None):
    if output.exists():
        raise ValueError('fresh E1 restoration destination required')
    if plan is None:
        plan = verify_plan()
    elif not scripted:
        raise ValueError('model restore must use the frozen E1 plan')
    index = read(archives / 'backup-index.json')
    validate_index(index, index['binding'], scripted=scripted)
    if index['status'] != 'complete' and not allow_partial:
        raise ValueError('explicit partial recovery required')
    item = index['archives'][0]
    path = archives / item['path']
    if path.is_symlink() or path.stat().st_size != item['bytes'] or sha256(path) != item['sha256']:
        raise ValueError('E1 archive size/hash differs')
    # The shared restorer verifies names, inventory and hashes. Bound this
    # evidence-only envelope before extraction as well (there are no weights).
    with tarfile.open(path, 'r:gz') as tar:
        count, expanded = 0, 0
        for member in tar:
            count += 1
            if member.isfile(): expanded += member.size
            if count > 500 or expanded > 500_000_000 or member.name.endswith('.safetensors'):
                raise ValueError('E1 delta cannot contain model weights or unbounded evidence')
    recovered = restore(path, output / 'parts', item['sha256'])
    run = output / 'parts/evidence'
    if Path(recovered['run_directory']).resolve() != run.resolve():
        raise ValueError('E1 archive root differs')
    b = validate_opening(read(run / 'opening.json'), plan, scripted=scripted)
    status = read(run / 'window-status.json')
    if b != index['binding'] or status['binding'] != b or status['status'] != index['status']:
        raise ValueError('restored run/status/binding mismatch')
    if index['status'] == 'complete':
        result = audit(run, tokenizer, parent, receipt, parent_index, scripted=scripted, plan=plan if scripted else None)
        if not result['complete_evidence'] or result != read(run / 'comparison.json'):
            raise ValueError('independent full task/native/token/weight reconstruction differs')
        dump_new(output / 'independent-audit.json', result)
    actual = {**fields(index, b, scripted=scripted), 'verified_files': recovered['verified_files']}
    dump_new(output / 'restore-receipt.json', recovered)
    dump_new(output / 'off-instance-backup.json', actual)
    return actual


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for n in ('archive-dir', 'output-dir', 'tokenizer-dir', 'parent-run', 'parent-receipt', 'parent-index'):
        p.add_argument('--' + n, type=Path, required=True)
    p.add_argument('--allow-partial', action='store_true')
    a = p.parse_args()
    print(assemble(a.archive_dir, a.output_dir, a.tokenizer_dir, a.parent_run,
                   a.parent_receipt, a.parent_index, allow_partial=a.allow_partial))
