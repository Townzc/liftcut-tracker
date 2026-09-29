"""Restore every archived byte; replay a complete pair before acknowledging it."""
import argparse
import json
from pathlib import Path

from restore_recovery import restore
from audit_state_diagnostics import audit
from server_workspace import dump_new


def restore_diagnostics(archive, output, expected_sha256, prepared, *, allow_partial=False):
    receipt = restore(archive, output, expected_sha256)
    run = Path(receipt["run_directory"])
    status = json.loads((run / "window-status.json").read_text(encoding="utf-8"))["status"]
    if status not in {"complete", "failed"}:
        raise ValueError("unknown archived diagnostic status")
    complete = status == "complete"
    if complete:
        result = audit(run, prepared)
        if result != json.loads((run / "comparison.json").read_text(encoding="utf-8")):
            raise ValueError("archived diagnostic comparison differs from replay")
    elif not allow_partial:
        raise ValueError("partial evidence restored; --allow-partial required for backup-only acknowledgment")
    ack = {"sha256": expected_sha256, "all_inventory_files_verified": True,
           "verified_files": receipt["verified_files"], "complete_pair_replayed": complete,
           "scope": "complete 38-state replay" if complete else "file integrity only; incomplete run is not a model result"}
    dump_new(output / "off-instance-backup.json", ack)
    return ack


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--archive", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--sha256", required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--allow-partial", action="store_true")
    args = p.parse_args()
    print(json.dumps(restore_diagnostics(args.archive, args.output_dir, args.sha256, args.prepared_dir,
                                        allow_partial=args.allow_partial), indent=2))
