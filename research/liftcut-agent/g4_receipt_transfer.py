"""Bounded G4 archive schema; receipts originate only from actual restoration."""
from pathlib import Path
from contextlib import closing
import hashlib
import json
import re
import uuid

from d2_execution import utcnow
from liftcut_agent.interactive import digest
from replication_receipt_transfer import _before_deadline, _remote_run, _verified_remote_bytes


def validate_index(index, bind, *, kind='model'):
    if (set(index) != {'version', 'binding', 'evidence_kind', 'status', 'archives'}
            or index['version'] != 'g4-backup-v1' or index['binding'] != bind
            or index['evidence_kind'] != kind or index['status'] not in {'complete', 'partial'}):
        raise ValueError('G4 backup binding/kind/status differs')
    parts = []
    for item in index['archives']:
        part = item.get('part')
        if (set(item) != {'part', 'archive', 'path', 'bytes', 'sha256'} or part not in {'control', 'permuted', 'evidence'}
                or part in parts or item['archive'] != part + '.tar.gz'
                or item['path'] != ('' if part == 'evidence' else 'training/') + item['archive']
                or type(item['bytes']) is not int or not 0 < item['bytes'] <= 512_000_000
                or not isinstance(item['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', item['sha256'])):
            raise ValueError('invalid G4 archive inventory')
        parts.append(part)
    if 'evidence' not in parts or (index['status'] == 'complete' and parts != ['control', 'permuted', 'evidence']):
        raise ValueError('complete G4 requires both training archives and evidence')
    return index


def receipt_fields(index, bind, *, kind='model'):
    validate_index(index, bind, kind=kind)
    complete = index['status'] == 'complete'
    return {'version': 'g4-backup-receipt-v1', 'binding': bind, 'index_digest': digest(index),
            'evidence_kind': kind, 'run_status': index['status'], 'all_inventory_files_verified': True,
            'complete_study_replayed': complete, 'episodes_replayed': 222 if complete else 0,
            'adapter_files_verified': complete, 'token_ids_verified': complete,
            'model_result': complete and kind == 'model', 'test_episodes': 0}


def validate_receipt(content, index, bind, *, kind='model'):
    result = json.loads(content)
    expected = receipt_fields(index, bind, kind=kind)
    if (set(result) != set(expected) | {'verified_files'} or type(result['verified_files']) is not int
            or result['verified_files'] <= 0
            or any(type(result[k]) is not type(v) or result[k] != v for k, v in expected.items())):
        raise ValueError('G4 receipt does not match actual complete/partial recovery')
    return result


def transfer_receipt(sftp, path, remote_run, index, bind, deadline, *, now=utcnow, emit=None, kind="model"):
    emit = emit or (lambda *_a, **_k: None)
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size < 65536:
        raise ValueError("regular bounded genuine receipt required")
    content = path.read_bytes()
    validate_receipt(content, index, bind, kind=kind)
    remote = _remote_run(remote_run)
    final = str(remote / "off-instance-backup.json")
    temp = str(remote / (".off-instance-backup." + uuid.uuid4().hex + ".tmp"))
    base = {"receipt_sha256": hashlib.sha256(content).hexdigest(), "remote_final": final,
            "server_acceptance": "unknown", "temp_path": temp}
    issued, stage = False, "existing_final"
    try:
        _before_deadline(deadline, now)
        if _verified_remote_bytes(sftp, final, content, deadline, now, absent_allowed=True):
            result = {**base, "status": "already_present"}
            emit("receipt_final_observed", **result)
            return result
        stage = "write"
        _before_deadline(deadline, now)
        with closing(sftp.open(temp, "wx", bufsize=0)) as stream:
            written = stream.write(content)
            if written is not None and written != len(content):
                raise ValueError("short receipt write")
        stage = "readback"
        _verified_remote_bytes(sftp, temp, content, deadline, now)
        emit("receipt_temporary_verified", **base)
        if _verified_remote_bytes(sftp, final, content, deadline, now, absent_allowed=True):
            result = {**base, "status": "already_present"}
            emit("receipt_final_observed", **result)
            return result
        stage = "rename"
        _before_deadline(deadline, now)
        issued = True
        sftp.rename(temp, final)  # standard no-overwrite rename, never posix_rename
        result = {**base, "status": "published"}
        emit("receipt_atomic_published", **result)
        return result
    except Exception as error:
        result = {**base, "status": "unknown" if issued else "failed", "stage": stage,
                  "error_type": type(error).__name__}
        emit("receipt_publish_" + result["status"], **result)
        return result
