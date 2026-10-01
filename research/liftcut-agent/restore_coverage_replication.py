"""R1: restore seed-bound bytes/actual weights, replay, then issue a shutdown ACK."""
import argparse
from pathlib import Path
import shutil

from prepare_coverage_replication import RUN_SEEDS, ARMS, read, verify_prepared, run_binding, arm_binding, require_binding
from audit_coverage_replication import audit
from liftcut_agent.interactive import digest
from restore_recovery import restore
from server_workspace import dump_new


def validate_index(index, plan, commit, *, allow_partial=False):
    binding = run_binding(plan, commit)
    require_binding(index.get("run_binding"), binding)
    payload = {k: index[k] for k in ("archives", "status", "run_binding")}
    if index.get("inventory_digest") != digest(payload) or index["status"] not in {"complete", "failed"}:
        raise ValueError("invalid replication archive index")
    parts = [a["part"] for a in index["archives"]]
    if (len(parts) != len(set(parts)) or "evidence" not in parts or not set(parts) <= set(ARMS) | {"evidence"}
            or (index["status"] == "complete" and set(parts) != set(ARMS) | {"evidence"})
            or (index["status"] != "complete" and not allow_partial)):
        raise ValueError("missing, duplicate or incomplete replication backup parts")
    for item in index["archives"]:
        part = item["part"]
        name = part + ".tar.gz"
        if item["archive"] != name or item["path"] != ("" if part == "evidence" else "training/") + name:
            raise ValueError("unexpected replication archive path")
        require_binding(item.get("binding"), binding if part == "evidence" else arm_binding(plan, commit, part))


def assemble(archive_dir, prepared, diagnostic, replication, seed, tokenizer, commit, output, *, allow_partial=False):
    if output.exists():
        raise ValueError("new restore directory required")
    plan = verify_prepared(prepared, diagnostic, replication, seed)
    index = read(archive_dir / "backup-ready.json")
    validate_index(index, plan, commit, allow_partial=allow_partial)
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
    require_binding(read(run / "run-binding.json"), index["run_binding"])
    status = read(run / "window-status.json")
    require_binding(status.get("run_binding"), index["run_binding"])
    if status["status"] != index["status"]:
        raise ValueError("restored status differs from archive index")
    for arm in ARMS:
        path = output / "restored" / arm / arm
        if path.exists():
            shutil.copytree(path, run / "training" / arm)
            # Partial artifacts prove saved bytes only, but cannot silently mix known provenance.
            for name in ("manifest.json", "report.json", "initialization.json", "memory-probe.json", "runtime.json"):
                if (path / name).exists():
                    require_binding(read(path / name).get("binding"), arm_binding(plan, commit, arm))
    complete = index["status"] == "complete"
    if complete:
        result = audit(run, prepared, diagnostic, replication, seed, tokenizer)
        if result != read(run / "comparison.json"):
            raise ValueError("restored replication comparison differs")
    verified = {"inventory_digest": index["inventory_digest"], "run_status": index["status"],
        "run_binding": index["run_binding"], "archives": receipts,
        "all_archive_files_verified": True, "complete_study_replayed": complete,
        "episodes_replayed": result["episodes_replayed"] if complete else 0,
        "adapter_files_verified": result["adapter_files_verified"] if complete else False,
        "token_ids_verified": result["token_ids_verified"] if complete else False, "test_episodes": 0}
    dump_new(run / "backup-index.json", index)
    dump_new(run / "off-instance-verification.json", verified)
    dump_new(output / "off-instance-backup.json", verified)
    return verified


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("archive-dir", "prepared-dir", "diagnostic-dir", "replication-dir", "tokenizer-dir", "output-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--seed", type=int, choices=RUN_SEEDS, required=True)
    p.add_argument("--expected-code-commit", required=True)
    p.add_argument("--allow-partial", action="store_true")
    args = p.parse_args()
    print(assemble(args.archive_dir, args.prepared_dir, args.diagnostic_dir, args.replication_dir, args.seed,
                   args.tokenizer_dir, args.expected_code_commit, args.output_dir, allow_partial=args.allow_partial))
