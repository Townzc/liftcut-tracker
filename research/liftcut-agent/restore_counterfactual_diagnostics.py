"""Restore D2 archive; a complete receipt requires native/environment/token/weight audit."""
import argparse
import json
from pathlib import Path
import tarfile

from d2_execution import read, verify_plan
from audit_counterfactual_diagnostics import audit, validate_opening
from d2_receipt_transfer import validate_index, validate_receipt
from liftcut_agent.interactive import digest
from restore_recovery import restore
from server_workspace import dump_new, sha256


def restore_d2(archive, output, index, prepared, tokenizer_dir, adapters_root, *, allow_partial=False, allow_scripted=False):
    if archive.stat().st_size != index["bytes"]:
        raise ValueError("archive size differs from observed index")
    kind = "scripted_contract" if allow_scripted else "model"
    validate_index(index, index["binding"], kind=kind)
    if sha256(archive) != index["sha256"]:
        raise ValueError("archive hash differs before extraction")
    # Reject decompression bombs before the generic verified extractor allocates.
    with tarfile.open(archive, "r:gz") as tar:
        count, size = 0, 0
        for member in tar:
            count, size = count + 1, size + member.size
            if count > 2000 or size > 1_000_000_000 or member.size < 0:
                raise ValueError("D2 archive exceeds bounded evidence inventory")
    restored = restore(archive, output, index["sha256"])
    run = Path(restored["run_directory"])
    plan = verify_plan(prepared)
    bind = validate_opening(read(run / "opening.json"), plan, allow_scripted=allow_scripted)
    validate_index(index, bind, kind=kind)
    status = read(run / "window-status.json")
    if status["status"] != index["status"] or status["binding"] != bind:
        raise ValueError("archived state and index mismatch")
    complete = index["status"] == "complete"
    if complete:
        result = audit(run, prepared, tokenizer_dir, adapters_root, allow_scripted=allow_scripted)
        if result != read(run / "comparison.json"):
            raise ValueError("archived D2 result does not match independent reconstruction")
        dump_new(output / "independent-audit.json", result)
    elif not allow_partial:
        raise ValueError("partial bytes restored; explicit allow-partial required for integrity-only receipt")
    receipt = {"version": "d2-backup-receipt-v1", "binding": bind, "index_digest": digest(index),
        "evidence_kind": kind, "run_status": index["status"], "archive": index["archive"],
        "bytes": index["bytes"], "sha256": index["sha256"], "verified_files": restored["verified_files"],
        "all_inventory_files_verified": True, "complete_study_replayed": complete,
        "episodes_replayed": 320 if complete else 0, "adapter_files_verified": complete,
        "token_ids_verified": complete, "model_result": complete and kind == "model", "test_episodes": 0}
    validate_receipt(json.dumps(receipt), index, bind, kind=kind)
    dump_new(output / "off-instance-backup.json", receipt)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ("archive", "output-dir", "index", "prepared-dir", "tokenizer-dir", "adapters-root"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--allow-partial", action="store_true")
    parser.add_argument("--allow-scripted-contract", action="store_true")
    args = parser.parse_args()
    print(json.dumps(restore_d2(args.archive, args.output_dir, read(args.index), args.prepared_dir,
        args.tokenizer_dir, args.adapters_root, allow_partial=args.allow_partial,
        allow_scripted=args.allow_scripted_contract)))
