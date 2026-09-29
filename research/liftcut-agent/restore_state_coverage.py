"""Verify all coverage archives and actual adapters before acknowledging shutdown."""
import argparse
import json
from pathlib import Path
import shutil

from state_coverage import ARMS
from audit_state_coverage import audit
from liftcut_agent.interactive import digest
from restore_recovery import restore
from server_workspace import dump_new


def validate_index(index, *, allow_partial=False):
    payload = {k: index[k] for k in ("archives", "status")}
    if index["inventory_digest"] != digest(payload) or index["status"] not in {"complete", "failed"}:
        raise ValueError("invalid coverage archive index")
    parts = [a["part"] for a in index["archives"]]
    if (len(parts) != len(set(parts)) or "evidence" not in parts or not set(parts) <= set(ARMS) | {"evidence"}
            or (index["status"] == "complete" and set(parts) != set(ARMS) | {"evidence"})
            or (index["status"] != "complete" and not allow_partial)):
        raise ValueError("missing, duplicate or incomplete coverage backup parts")
    for item in index["archives"]:
        name = item["part"] + ".tar.gz"
        if item["archive"] != name or item["path"] != ("" if item["part"] == "evidence" else "training/") + name:
            raise ValueError("unexpected coverage archive path")


def assemble(archive_dir, prepared, diagnostic, output, *, allow_partial=False):
    if output.exists():
        raise ValueError("new restore directory required")
    index = json.loads((archive_dir / "backup-ready.json").read_text(encoding="utf-8"))
    validate_index(index, allow_partial=allow_partial)
    for item in index["archives"]:
        if (archive_dir / item["archive"]).stat().st_size != item["bytes"]:
            raise ValueError("archive size mismatch")
    receipts = []
    for item in index["archives"]:
        result = restore(archive_dir / item["archive"], output / "restored" / item["part"], item["sha256"])
        if Path(result["run_directory"]).resolve() != (output / "restored" / item["part"] / item["part"]).resolve():
            raise ValueError("unexpected restored root")
        receipts.append({k: v for k, v in result.items() if k != "run_directory"})
    run = output / "run"
    shutil.copytree(output / "restored/evidence/evidence", run)
    for arm in ARMS:
        path = output / "restored" / arm / arm
        if path.exists():
            shutil.copytree(path, run / "training" / arm)
    if json.loads((run / "window-status.json").read_text(encoding="utf-8"))["status"] != index["status"]:
        raise ValueError("restored status differs from archive index")
    complete = index["status"] == "complete"
    if complete:
        result = audit(run, prepared, diagnostic)
        if result != json.loads((run / "comparison.json").read_text(encoding="utf-8")):
            raise ValueError("restored coverage comparison differs")
    verified = {"inventory_digest": index["inventory_digest"], "run_status": index["status"], "archives": receipts,
        "all_archive_files_verified": True, "complete_study_replayed": complete,
        "episodes_replayed": result["episodes_replayed"] if complete else 0,
        "adapter_files_verified": result["adapter_files_verified"] if complete else False, "test_episodes": 0}
    dump_new(run / "backup-index.json", index)
    dump_new(run / "off-instance-verification.json", verified)
    dump_new(output / "off-instance-backup.json", verified)
    return verified


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("archive-dir", "prepared-dir", "diagnostic-dir", "output-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--allow-partial", action="store_true")
    args = p.parse_args()
    print(json.dumps(assemble(args.archive_dir, args.prepared_dir, args.diagnostic_dir, args.output_dir,
                              allow_partial=args.allow_partial), indent=2))
