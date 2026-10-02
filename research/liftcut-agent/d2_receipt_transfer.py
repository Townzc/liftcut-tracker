"""D2 receipt schema and exclusive, verified atomic SFTP publication.

Only the successful restorer creates receipts. Schema checks alone cannot prove
that execution happened. Publication is distinct from server consumption.
"""
from pathlib import Path
from contextlib import closing
import hashlib
import json
import uuid

from d2_execution import utcnow
from liftcut_agent.interactive import digest
from replication_receipt_transfer import _before_deadline, _remote_run, _verified_remote_bytes


def validate_index(index, bind, *, kind="model"):
    if (set(index) != {"version", "binding", "evidence_kind", "status", "archive", "bytes", "sha256"}
            or index["version"] != "d2-backup-v1" or index["binding"] != bind
            or index["evidence_kind"] != kind or index["status"] not in {"complete", "partial"}
            or index["archive"] != "evidence.tar.gz" or type(index["bytes"]) is not int
            or not 0 < index["bytes"] <= 512_000_000):
        raise ValueError("invalid D2 backup index/binding")
    import re
    if not isinstance(index["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", index["sha256"]):
        raise ValueError("invalid archive SHA256")
    return index


def validate_receipt(content, index, bind, *, kind="model"):
    validate_index(index, bind, kind=kind)
    receipt = json.loads(content)
    complete = index["status"] == "complete"
    expected = {"version": "d2-backup-receipt-v1", "binding": bind, "index_digest": digest(index),
        "evidence_kind": kind, "run_status": index["status"], "archive": index["archive"],
        "bytes": index["bytes"], "sha256": index["sha256"], "all_inventory_files_verified": True,
        "complete_study_replayed": complete, "episodes_replayed": 320 if complete else 0,
        "adapter_files_verified": complete, "token_ids_verified": complete,
        "model_result": complete and kind == "model", "test_episodes": 0}
    if (set(receipt) != set(expected) | {"verified_files"} or type(receipt["verified_files"]) is not int
            or receipt["verified_files"] <= 0 or any(type(receipt[k]) is not type(v) or receipt[k] != v for k, v in expected.items())):
        raise ValueError("D2 receipt does not match verified complete/partial evidence")
    return receipt


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
