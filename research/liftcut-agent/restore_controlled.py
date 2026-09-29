"""Restore all three v2 archives, audit actual adapters, then create a backup ack."""
import argparse
import json
from pathlib import Path
import shutil

from audit_controlled import audit
from liftcut_agent.interactive import digest
from restore_recovery import restore
from server_workspace import dump_new


def validate_index(index):
    if index["status"] != "complete" or index["inventory_digest"] != digest({k: index[k] for k in ("archives", "status")}):
        raise ValueError("incomplete or inconsistent archive index")
    if len(index["archives"]) != 3 or {a["part"] for a in index["archives"]} != {"clean", "mixed", "evidence"}:
        raise ValueError("three distinct backup parts required")
    for item in index["archives"]:
        expected = item["part"] + ".tar.gz"
        if item["archive"] != expected or item["path"] != ("training/" if item["part"] != "evidence" else "") + expected:
            raise ValueError("unexpected backup archive path")


def assemble(archive_dir, prepared, output):
    if output.exists():
        raise ValueError("restore output must be new")
    index = json.loads((archive_dir / "backup-ready.json").read_text(encoding="utf-8"))
    validate_index(index)
    for item in index["archives"]:
        if (archive_dir / item["archive"]).stat().st_size != item["bytes"]:
            raise ValueError("archive size mismatch")
    output.mkdir(parents=True, exist_ok=False)
    receipts = []
    for item in index["archives"]:
        receipt = restore(archive_dir / item["archive"], output / "restored" / item["part"], item["sha256"])
        expected = output / "restored" / item["part"] / item["part"]
        if Path(receipt["run_directory"]).resolve() != expected.resolve():
            raise ValueError("unexpected archive root")
        receipts.append({k: v for k, v in receipt.items() if k != "run_directory"})
    run = output / "run"
    shutil.copytree(output / "restored/evidence/evidence", run)
    for arm in ("clean", "mixed"):
        shutil.copytree(output / "restored" / arm / arm, run / "training" / arm)
    result = audit(run, prepared)
    original = json.loads((run / "comparison.json").read_text(encoding="utf-8"))
    if original != result:
        raise ValueError("restored audit differs from server comparison")
    verified = {"inventory_digest": index["inventory_digest"], "archives": receipts,
        "episodes_replayed": result["episodes_replayed"], "adapter_files_verified": result["adapter_files_verified"],
        "all_archive_files_verified": True, "test_episodes": result["test_episodes"]}
    dump_new(run / "backup-index.json", index)
    dump_new(run / "off-instance-verification.json", verified)
    # This file must be copied to the server only after this command succeeds.
    dump_new(output / "off-instance-backup.json", verified)
    return verified


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--archive-dir", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    args = p.parse_args()
    print(json.dumps(assemble(args.archive_dir, args.prepared_dir, args.output_dir), indent=2))
