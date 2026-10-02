"""Validate a genuine frozen-restorer receipt, then publish its bytes atomically.

The caller MUST first run the frozen restorer successfully into a fresh directory.
Schema checks cannot prove that execution happened. This module never constructs
a receipt, connects/reconnects SSH, starts a server, or requests shutdown. The
caller supplies an SFTP session with bounded operation timeouts and the original
absolute deadline. Uploaded bytes are not proof of controller acceptance.
"""
from datetime import datetime, timezone
import errno
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import uuid

from prepare_coverage_replication import REVIEWED, read, require_seed, run_binding, require_binding
from restore_coverage_replication import validate_index

EXECUTION_COMMIT = "f18cb5820881a048b19b6007fc4ca231dfd64de9"
MAX_RECEIPT_BYTES = 65536
CHUNK_BYTES = 16384
FINAL_NAME = "off-instance-backup.json"
REMOTE_RUNS = PurePosixPath("/root/autodl-tmp/liftcut/runs")


def utc_now():
    return datetime.now(timezone.utc)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate receipt JSON key")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError("nonfinite receipt JSON value")


def _keys(value, expected, name):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError("unexpected " + name + " schema")


def _positive_integer(value, name):
    if type(value) is not int or value <= 0:
        raise ValueError("invalid " + name)


def _hash(value, name):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ValueError("invalid " + name)


def validate_receipt(receipt_bytes, index, plan, expected_commit):
    """Check schema/provenance only; never fabricate an attestation or audit output."""
    if (type(receipt_bytes) is not bytes or not 0 < len(receipt_bytes) <= MAX_RECEIPT_BYTES
            or expected_commit != EXECUTION_COMMIT):
        raise ValueError("invalid receipt bytes or unfrozen execution commit")
    try:
        require_seed(plan["seed"], executing=True)
        if plan != read(REVIEWED)["seeds"][str(plan["seed"])]:
            raise ValueError("receipt plan differs from frozen R1 preparation")
        expected_binding = run_binding(plan, expected_commit)
        _keys(index, ("archives", "status", "run_binding", "inventory_digest"), "index")
        if not isinstance(index["archives"], list):
            raise ValueError("invalid index archives")
        for item in index["archives"]:
            _keys(item, ("part", "binding", "path", "archive", "bytes", "sha256"), "archive index")
            _positive_integer(item["bytes"], "archive bytes")
            _hash(item["sha256"], "archive hash")
        _hash(index["inventory_digest"], "inventory digest")
        validate_index(index, plan, expected_commit, allow_partial=True)
        receipt = json.loads(receipt_bytes.decode("utf-8"), object_pairs_hook=_unique_object,
                             parse_constant=_reject_constant)
        _keys(receipt, ("inventory_digest", "run_status", "run_binding", "archives",
                       "all_archive_files_verified", "complete_study_replayed", "episodes_replayed",
                       "adapter_files_verified", "token_ids_verified", "test_episodes"), "receipt")
        require_binding(receipt["run_binding"], expected_binding)
        complete = index["status"] == "complete"
        if (receipt["inventory_digest"] != index["inventory_digest"]
                or receipt["run_status"] != index["status"]
                or receipt["all_archive_files_verified"] is not True
                or receipt["complete_study_replayed"] is not complete
                or receipt["adapter_files_verified"] is not complete
                or receipt["token_ids_verified"] is not complete
                or type(receipt["episodes_replayed"]) is not int
                or receipt["episodes_replayed"] != (124 if complete else 0)
                or type(receipt["test_episodes"]) is not int or receipt["test_episodes"] != 0):
            raise ValueError("receipt verification fields disagree with complete/partial index")
        if not isinstance(receipt["archives"], list) or len(receipt["archives"]) != len(index["archives"]):
            raise ValueError("receipt archive inventory differs")
        for saved, expected in zip(receipt["archives"], index["archives"]):
            _keys(saved, ("archive", "bytes", "sha256", "verified_files", "all_inventory_files_verified"),
                  "archive receipt")
            _positive_integer(saved["bytes"], "receipt archive bytes")
            _positive_integer(saved["verified_files"], "verified file count")
            _hash(saved["sha256"], "receipt archive hash")
            if (any(saved[key] != expected[key] for key in ("archive", "bytes", "sha256"))
                    or saved["all_inventory_files_verified"] is not True):
                raise ValueError("receipt archive fields differ from index")
        return receipt
    except (KeyError, TypeError, UnicodeDecodeError, RecursionError) as exc:
        raise ValueError("malformed receipt/index/plan") from exc


def _before_deadline(deadline, now):
    current = now()
    if (not isinstance(deadline, datetime) or deadline.utcoffset() is None
            or not isinstance(current, datetime) or current.utcoffset() is None):
        raise ValueError("timezone-aware original deadline and clock required")
    if current >= deadline:
        raise TimeoutError("original receipt deadline reached")


def _remote_run(path):
    if not isinstance(path, str) or any(ord(c) < 32 for c in path) or "\\" in path:
        raise ValueError("invalid remote run path")
    result = PurePosixPath(path)
    if (not result.is_absolute() or ".." in result.parts or str(result) != path
            or not result.is_relative_to(REMOTE_RUNS) or result == REMOTE_RUNS):
        raise ValueError("receipt must stay inside one persistent experiment run")
    return result


def _verified_remote_bytes(sftp, path, content, deadline, now, *, absent_allowed=False):
    _before_deadline(deadline, now)
    try:
        attributes = sftp.lstat(path)
    except OSError as exc:
        if absent_allowed and exc.errno == errno.ENOENT:
            return False
        raise
    if (not isinstance(attributes.st_mode, int) or not stat.S_ISREG(attributes.st_mode)
            or type(attributes.st_size) is not int or attributes.st_size != len(content)):
        raise ValueError("remote receipt is linked, nonregular, or has different size")
    _before_deadline(deadline, now)
    handle = sftp.open(path, "rb")
    collected = bytearray()
    try:
        while len(collected) <= len(content):
            _before_deadline(deadline, now)
            chunk = handle.read(min(CHUNK_BYTES, len(content) + 1 - len(collected)))
            if type(chunk) is not bytes:
                raise ValueError("remote receipt read did not return bytes")
            if not chunk:
                break
            collected.extend(chunk)
    finally:
        handle.close()
    if len(collected) != len(content) or hashlib.sha256(collected).digest() != hashlib.sha256(content).digest():
        raise ValueError("remote receipt readback SHA256 mismatch")
    return True


def transfer_receipt(sftp, receipt_path, remote_run, index, plan, expected_commit, deadline, *, now=utc_now, emit=None):
    """Publish validated bytes without overwrite; ambiguous rename never means success.

    Invalid local schema/binding raises ValueError before SFTP access. Transfer
    failures return failed, except any exception after issuing rename returns
    unknown. No automatic retry or reconnect occurs. A later explicit call first
    checks existing final bytes. No return value establishes server acceptance.
    """
    emit = emit or (lambda event_name, **data: None)
    path = Path(receipt_path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_RECEIPT_BYTES:
        raise ValueError("genuine local receipt must be a regular bounded file")
    content = path.read_bytes()
    receipt = validate_receipt(content, index, plan, expected_commit)
    remote = _remote_run(remote_run)
    final = str(remote / FINAL_NAME)
    temporary = str(remote / ("." + FINAL_NAME + "." + uuid.uuid4().hex + ".tmp"))
    base = {"receipt_sha256": hashlib.sha256(content).hexdigest(), "receipt_bytes": len(content),
            "run_status": receipt["run_status"], "complete_study_receipt": receipt["complete_study_replayed"],
            "remote_final": final, "temp_path": None, "server_acceptance": "unknown"}
    stage, rename_issued = "existing_final", False
    try:
        _before_deadline(deadline, now)
        if _verified_remote_bytes(sftp, final, content, deadline, now, absent_allowed=True):
            result = {**base, "status": "already_present", "reason": "existing final bytes match; no overwrite"}
            emit("receipt_final_observed", **result)
            return result
        stage = "exclusive_create"
        _before_deadline(deadline, now)
        # Paramiko's 'x' alone does not set WRITE; 'wx' combines WRITE and EXCL.
        handle = sftp.open(temporary, "wx", bufsize=0)
        base["temp_path"] = temporary
        stage = "write_and_close"
        try:
            for offset in range(0, len(content), CHUNK_BYTES):
                _before_deadline(deadline, now)
                written = handle.write(content[offset:offset + CHUNK_BYTES])
                if written is not None and written != len(content[offset:offset + CHUNK_BYTES]):
                    raise ValueError("short receipt write")
        finally:
            # Closing is required even after a failed write. No final name exists yet.
            handle.close()
        stage = "readback"
        _verified_remote_bytes(sftp, temporary, content, deadline, now)
        emit("receipt_temporary_verified", **base)
        stage = "final_recheck"
        if _verified_remote_bytes(sftp, final, content, deadline, now, absent_allowed=True):
            result = {**base, "status": "already_present", "reason": "matching final appeared; no overwrite"}
            emit("receipt_final_observed", **result)
            return result
        stage = "rename"
        _before_deadline(deadline, now)
        # Standard SFTP rename refuses an existing destination. Never posix_rename.
        rename_issued = True
        sftp.rename(temporary, final)
        result = {**base, "status": "published", "reason": "standard rename confirmation received"}
        emit("receipt_atomic_published", **result)
        return result
    except Exception as exc:
        result = {**base, "status": "unknown" if rename_issued else "failed", "stage": stage,
                  "reason": type(exc).__name__ + ": " + str(exc),
                  "retry_rule": "Do not reconnect automatically; a later explicit attempt must inspect final bytes first"}
        emit("receipt_publish_unknown" if rename_issued else "receipt_transfer_failed", **result)
        return result
