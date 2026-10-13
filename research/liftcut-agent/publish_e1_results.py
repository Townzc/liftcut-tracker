"""Publish complete E1 model evidence with explicit external-weight and power limits."""
import argparse
from copy import deepcopy
from pathlib import Path, PurePosixPath
import shutil

from audit_e1 import audit
from d2_execution import read, aware
from e1_protocol import decide
from e1_receipt import validate_index, validate_receipt
from liftcut_agent.benchmark import read_jsonl
from publish_i3_results import inventory
from server_workspace import dump_new, sha256

EXECUTION = '9e9387c1a4bac03b1363e38a379816cfe6cf3436'
CAPTURES = ('opening.json', 'launch.json', 'guard.json', 'receipt-transfer.json',
            'backup-copy-status.json', 'window-close.json', 'server-events-latest.jsonl',
            'shutdown-request.json', 'shutdown-return.json')
RESOURCES = ('server-stream.jsonl', 'server-stderr.log', 'local-events.jsonl',
             'remote-read-only-source.py')
REQUIRED = {'backup-index.json', 'restore-receipt.json', 'independent-audit.json', 'operations.jsonl'}


def compare_reconstruction(actual, archived, *, metadata_only):
    expected = deepcopy(archived)
    if (archived['model_result'] is not True or archived['complete_evidence'] is not True
            or archived['actual_external_weight_verified'] is not True):
        raise ValueError('complete genuine model evidence required')
    if metadata_only:
        expected.update(complete_evidence=False, actual_external_weight_verified=False, external_weights=None)
        expected['decision'] = decide({a: actual['arms'][a]['rows'] for a in ('A', 'D')},
                                     complete=False, actual_model_result=True)
        rebuilt = decide({a: actual['arms'][a]['rows'] for a in ('A', 'D')},
                         complete=True, actual_model_result=True)
        if rebuilt != archived['decision']:
            raise ValueError('archived complete gates differ from independently replayed rows')
    if actual != expected:
        raise ValueError('independent E1 reconstruction differs')


def verify_complete(run, index_path, receipt_path, tokenizer, parent=None,
                    parent_receipt=None, parent_index=None, *, metadata_only=False):
    index = read(index_path); b = index['binding']; validate_index(index, b)
    if index['status'] != 'complete' or b['code_commit'] != EXECUTION or 'power_lease' in b:
        raise ValueError('exact standalone complete E1 required')
    receipt = validate_receipt(receipt_path.read_bytes(), index, b)
    if len(inventory(run)) != receipt['verified_files']:
        raise ValueError('E1 inventory/receipt count differs')
    status = read(run / 'window-status.json')
    if status['binding'] != b or status['status'] != 'complete' or status['failures']:
        raise ValueError('partial E1 cannot become a complete result')
    result = audit(run, tokenizer, parent, parent_receipt, parent_index, metadata_only=metadata_only)
    compare_reconstruction(result, read(run / 'comparison.json'), metadata_only=metadata_only)
    return result


def verify_handoff(public):
    events = read_jsonl(public / 'operations.jsonl')
    server = read_jsonl(public / 'server-events-latest.jsonl', allow_empty=True)
    receipt = read(public / 'restore-receipt.json'); h = sha256(public / 'restore-receipt.json')
    b = read(public / 'backup-index.json')['binding']
    checked = [e for e in events if e['event'] == 'off_instance_verified']
    published = [e for e in events if e['event'] in ('receipt_atomic_published', 'receipt_final_observed')]
    finished = [e for e in events if e['event'] == 'collector_finished']
    consumed = [e for e in server if e['event'] == 'server_receipt_consumed']
    if (len(checked) != 1 or checked[0]['receipt'] != receipt or len(published) != 1
            or published[0]['receipt_sha256'] != h or len(finished) != 1
            or finished[0]['result']['receipt_transfer']['receipt_sha256'] != h
            or not aware(b['trial_started_at_utc']) <= aware(checked[0]['at_utc'])
            <= aware(published[0]['at_utc']) <= aware(finished[0]['at_utc']) <= aware(b['hard_cutoff'])
            or aware(published[0]['at_utc']) > aware(b['collection_cutoff'])):
        raise ValueError('genuine E1 verification/publication chain differs')
    acceptance = None
    if (public / 'backup-copy-status.json').exists():
        acceptance = read(public / 'backup-copy-status.json')['off_instance_acknowledged']
        if type(acceptance) is not bool:
            raise ValueError('server status must be an observed boolean')
    if consumed:
        if (len(consumed) != 1 or consumed[0]['receipt_sha256'] != h
                or consumed[0]['status'] != 'complete' or acceptance is False
                or not aware(published[0]['at_utc']) <= aware(consumed[0]['at_utc']) <= aware(b['collection_cutoff'])):
            raise ValueError('actual server E1 receipt event differs')
        acceptance = True
    return {'receipt_sha256': h, 'published_at_utc': published[0]['at_utc'],
            'server_consumption_observed': acceptance,
            'server_consumed_at_utc': consumed[0]['at_utc'] if consumed else None,
            'collector_finished_at_utc': finished[0]['at_utc'],
            'collector_result': finished[0]['result'],
            'shutdown_request': read(public / 'shutdown-request.json') if (public / 'shutdown-request.json').exists() else None,
            'shutdown_return': read(public / 'shutdown-return.json') if (public / 'shutdown-return.json').exists() else None,
            'provider_power_state': 'unknown', 'provider_billing_stopped': 'unknown'}


def publication_integrity(public):
    m = read(public / 'publication-manifest.json')
    if (m['version'] != 'e1-publication-v1' or m['execution_commit'] != EXECUTION
            or m['archive_is_self_contained'] is not False or m['model_result'] is not True
            or m['actual_parent_weight_verified_at_publication'] is not True
            or m['episodes_replayed'] != 96 or m['unique_tasks'] != 48
            or m['independent_generalization'] is not False):
        raise ValueError('E1 publication binding differs')
    expected = {'run/' + n for n in set(inventory(public / 'run')) | {'backup-inventory.json'}} | REQUIRED
    expected |= {n for n in CAPTURES if (public / n).exists()}
    expected |= {'resources/' + n for n in RESOURCES if (public / 'resources' / n).exists()}
    if set(m['raw_sha256']) != expected:
        raise ValueError('E1 publication raw manifest differs')
    for name, h in m['raw_sha256'].items():
        p = PurePosixPath(name)
        if (p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name
                or (public / name).is_symlink() or sha256(public / name) != h):
            raise ValueError('E1 publication raw bytes changed')
    if verify_handoff(public) != m['handoff']:
        raise ValueError('E1 handoff summary differs')
    return m


def publish(restored, index, operations, resources, output, tokenizer, parent, parent_receipt, parent_index):
    if output.exists():
        raise ValueError('new E1 publication directory required')
    run = restored / 'parts/evidence'; receipt = restored / 'off-instance-backup.json'
    if Path(read(restored / 'restore-receipt.json')['run_directory']).resolve() != run.resolve():
        raise ValueError('E1 restored directory differs')
    result = verify_complete(run, index, receipt, tokenizer, parent, parent_receipt, parent_index)
    if result != read(restored / 'independent-audit.json'):
        raise ValueError('actual-parent independent E1 audit differs')
    output.mkdir(parents=True)
    for n in sorted(set(inventory(run)) | {'backup-inventory.json'}):
        p = output / 'run' / n; p.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(run / n, p)
    for src, name in ((index, 'backup-index.json'), (receipt, 'restore-receipt.json'),
                      (restored / 'independent-audit.json', 'independent-audit.json'),
                      (operations / 'events.jsonl', 'operations.jsonl')):
        shutil.copyfile(src, output / name)
    for n in CAPTURES:
        if (operations / n).exists():
            shutil.copyfile(operations / n, output / n)
    (output / 'resources').mkdir()
    for n in RESOURCES:
        shutil.copyfile(resources / n, output / 'resources' / n)
    handoff = verify_handoff(output)
    raw = {p.relative_to(output).as_posix(): sha256(p) for p in sorted(output.rglob('*')) if p.is_file()}
    value = {'version': 'e1-publication-v1', 'execution_commit': EXECUTION, 'raw_sha256': raw,
             'handoff': handoff, 'actual_parent_weight_verified_at_publication': True,
             'archive_is_self_contained': False, 'parent_reference': read(run / 'reference.json'),
             'model_result': True, 'episodes_replayed': 96, 'unique_tasks': 48,
             'independent_generalization': False, 'scope': 'shared-template combination transfer; historical structural payload access'}
    dump_new(output / 'publication-manifest.json', value)
    publication_integrity(output)
    return value


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for n in ('restored', 'backup-index', 'operations', 'resources', 'output-dir', 'tokenizer-dir',
              'parent-run', 'parent-receipt', 'parent-index'):
        p.add_argument('--' + n, type=Path, required=True)
    a = p.parse_args()
    r = publish(a.restored, a.backup_index, a.operations, a.resources, a.output_dir, a.tokenizer_dir,
                a.parent_run, a.parent_receipt, a.parent_index)
    print({'raw_files': len(r['raw_sha256']), 'episodes': 96, 'archive_is_self_contained': False})
