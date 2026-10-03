"""I1 archive/receipt schema; complete receipts require actual restoration."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import uuid

from d2_execution import utcnow
from liftcut_agent.interactive import digest
from replication_receipt_transfer import _before_deadline, _remote_run, _verified_remote_bytes


def validate_index(index, bind, *, kind='model'):
    if (set(index) != {'version', 'binding', 'evidence_kind', 'status', 'archives'}
            or index['version'] != 'i1-backup-v1' or index['binding'] != bind
            or index['evidence_kind'] != kind or index['status'] not in {'complete', 'partial'}
            or len(index['archives']) != 1):
        raise ValueError('I1 backup binding/kind/status differs')
    row = index['archives'][0]
    if (set(row) != {'archive', 'path', 'bytes', 'sha256'}
            or row['archive'] != 'evidence.tar.gz' or row['path'] != 'evidence.tar.gz'
            or type(row['bytes']) is not int or not 0 < row['bytes'] <= 512_000_000
            or not isinstance(row['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', row['sha256'])):
        raise ValueError('invalid I1 single bounded evidence archive')
    return index


def receipt_fields(index, bind, *, kind='model'):
    validate_index(index, bind, kind=kind)
    complete = index['status'] == 'complete'
    return {'version': 'i1-backup-receipt-v1', 'binding': bind, 'index_digest': digest(index),
            'evidence_kind': kind, 'run_status': index['status'], 'all_inventory_files_verified': True,
            'complete_study_replayed': complete, 'episodes_replayed': 222 if complete else 0,
            'adapter_files_verified': complete, 'token_ids_verified': complete,
            'projection_inputs_verified': complete, 'model_result': complete and kind == 'model',
            'test_episodes': 0, 'new_training': False}


def validate_receipt(content, index, bind, *, kind='model'):
    result = json.loads(content)
    expected = receipt_fields(index, bind, kind=kind)
    if (set(result) != set(expected) | {'verified_files'} or type(result['verified_files']) is not int
            or result['verified_files'] <= 0
            or any(type(result[k]) is not type(v) or result[k] != v for k, v in expected.items())):
        raise ValueError('I1 receipt differs from actual complete/partial recovery')
    return result


def transfer_receipt(sftp, path, remote_run, index, bind, deadline, *, now=utcnow, emit=None, kind='model'):
    emit = emit or (lambda *_a, **_k: None)
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size < 65536:
        raise ValueError('regular bounded genuine receipt required')
    content = path.read_bytes()
    validate_receipt(content, index, bind, kind=kind)
    remote = _remote_run(remote_run)
    final = str(remote / 'off-instance-backup.json')
    temp = str(remote / ('.off-instance-backup.' + uuid.uuid4().hex + '.tmp'))
    base = {'receipt_sha256': hashlib.sha256(content).hexdigest(), 'remote_final': final,
            'server_acceptance': 'unknown', 'temp_path': temp}
    issued, stage = False, 'existing_final'
    try:
        _before_deadline(deadline, now)
        if _verified_remote_bytes(sftp, final, content, deadline, now, absent_allowed=True):
            result = {**base, 'status': 'already_present'}
            emit('receipt_final_observed', **result)
            return result
        stage = 'write'
        _before_deadline(deadline, now)
        with closing(sftp.open(temp, 'wx', bufsize=0)) as stream:
            written = stream.write(content)
            if written is not None and written != len(content):
                raise ValueError('short receipt write')
        stage = 'readback'
        _verified_remote_bytes(sftp, temp, content, deadline, now)
        emit('receipt_temporary_verified', **base)
        if _verified_remote_bytes(sftp, final, content, deadline, now, absent_allowed=True):
            result = {**base, 'status': 'already_present'}
            emit('receipt_final_observed', **result)
            return result
        stage = 'rename'
        _before_deadline(deadline, now)
        issued = True
        sftp.rename(temp, final)
        result = {**base, 'status': 'published'}
        emit('receipt_atomic_published', **result)
        return result
    except Exception as error:
        result = {**base, 'status': 'unknown' if issued else 'failed', 'stage': stage,
                  'error_type': type(error).__name__}
        emit('receipt_publish_' + result['status'], **result)
        return result
