"""Publish only the replayed synthetic diagnostic evidence, never weights or keys."""
import argparse
import json
from pathlib import Path
import shutil

from audit_state_diagnostics import audit
from gpu_state_diagnostics import expected_adapter, read, verify_adapter
from review_state_diagnostics import review
from server_workspace import dump_new, sha256


def public_paths():
    paths = ["window-status.json", "comparison.json", "server-doctor.json", "server-tests.log",
             "server-preparation.log", "boot-observation.json", "backup-source.json",
             "off-instance-verification.json", "operations.json"]
    for arm in ("clean", "mixed"):
        paths += [f"evaluation/{arm}/{name}" for name in
                  ("manifest.json", "config.json", "report.json", "episodes.jsonl", "generations.jsonl", "calls.jsonl")]
    return paths


def markdown(result):
    lines = ["# Fixed-state development diagnostics", "",
        "Existing recovery-v2 adapters; 19 authored development states per arm, one greedy run each.",
        "These are first-decision diagnostics, not full-task success or held-out evaluation.", "",
        "| Arm | Consent decision | Memory decision | Real model generations |",
        "| --- | ---: | ---: | ---: |"]
    for arm, data in result["arms"].items():
        lines.append(f"| {arm} | {data['panels']['consent']['correct']}/10 | {data['panels']['memory']['correct']}/9 | "
                     f"{data['actual_model_generations']} |")
    lines += ["", "Every accepted tool batch is fully executed. Only its first substantive decision is scored.",
        "Scripted prefixes have zero model usage; live prompts include the prefix tokens.",
        "All failed decisions, parse failures and absent decisions remain in the denominator.", "",
        "- `comparison.json`: recorded server replay and native-generation audit, reproduced on CPU.",
        "- `review.json`: exact first actions, same-state consent contrasts, value matches and usage.",
        "- `adapter-verification.json`: actual saved v2 adapter files checked before publication; weights omitted.",
        "- `backup-source.json` and `off-instance-verification.json`: archive SHA and complete restore/replay receipt.",
        "- `operations.json`: observed timing/cost proxy and limits of shutdown/billing observation.",
        "- `publication-manifest.json`: exact public file inventory and hashes.", "",
        "Value matches are not proof of internal causal attribution. These related probes provide no independent generalization estimate.",
        "[Research journal](../../../../docs/research/EXPERIMENT_LOG.md)",
        "[Diagnostic design](../../../../docs/research/2026-09-29-state-diagnostic-plan.md)", ""]
    return "\n".join(lines)


def publish(run, prepared, adapters, output):
    if output.exists():
        raise ValueError("publication destination must be new")
    result = audit(run, prepared)
    status, receipt, backup = read(run / "window-status.json"), read(run / "off-instance-verification.json"), read(run / "backup-source.json")
    if (status["status"] != "complete" or status["failures"] or result != read(run / "comparison.json")
            or receipt["all_inventory_files_verified"] is not True or receipt["complete_pair_replayed"] is not True
            or receipt["sha256"] != backup["sha256"]):
        raise ValueError("publication requires a completely restored, replayed diagnostic pair")
    checked = {arm: verify_adapter(arm, adapters / arm / "final") for arm in ("clean", "mixed")}
    for name in public_paths():
        if not (run / name).is_file() or (run / name).is_symlink():
            raise ValueError("missing or linked public artifact: " + name)
    output.mkdir(parents=True, exist_ok=False)
    for name in public_paths():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(run / name, target)
    dump_new(output / "adapter-verification.json", {"scope": "Actual off-instance v2 adapter files rehashed before this publication",
        "files_verified": checked, "weights_published": False})
    dump_new(output / "review.json", review(output, prepared))
    (output / "README.md").write_text(markdown(result), encoding="utf-8", newline="\n")
    dump_new(output / "publication-manifest.json", {"scope": "Synthetic exploratory development logs only",
        "copied_files": public_paths(),
        "files": {p.relative_to(output).as_posix(): sha256(p) for p in sorted(output.rglob("*")) if p.is_file()}})
    return result


def verify_publication(run, prepared):
    manifest = read(run / "publication-manifest.json")
    if any(p.is_symlink() for p in run.rglob("*")):
        raise ValueError("public artifacts must not be linked")
    files = {p.relative_to(run).as_posix(): sha256(p) for p in sorted(run.rglob("*"))
             if p.is_file() and p.name != "publication-manifest.json"}
    expected_names = set(public_paths()) | {"adapter-verification.json", "review.json", "README.md"}
    if files != manifest["files"] or set(files) != expected_names or manifest["copied_files"] != public_paths():
        raise ValueError("public diagnostic inventory mismatch")
    result = audit(run, prepared)
    if result != read(run / "comparison.json") or review(run, prepared) != read(run / "review.json"):
        raise ValueError("published diagnostic review differs from replay")
    metadata = read(run / "adapter-verification.json")
    if metadata["weights_published"] is not False or metadata["files_verified"] != {a: expected_adapter(a) for a in ("clean", "mixed")}:
        raise ValueError("wrong published adapter metadata")
    status, receipt, backup = read(run / "window-status.json"), read(run / "off-instance-verification.json"), read(run / "backup-source.json")
    if (status["status"] != "complete" or status["failures"] or receipt["complete_pair_replayed"] is not True
            or receipt["all_inventory_files_verified"] is not True or receipt["sha256"] != backup["sha256"]):
        raise ValueError("published restore scope mismatch")
    if (run / "README.md").read_text(encoding="utf-8") != markdown(result):
        raise ValueError("published summary differs from replay")
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run-dir", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--adapters-root", type=Path)
    p.add_argument("--output-dir", type=Path)
    p.add_argument("--check-publication", action="store_true")
    args = p.parse_args()
    if args.check_publication:
        if args.output_dir or args.adapters_root:
            p.error("public replay does not write or recheck private weights")
        result = verify_publication(args.run_dir, args.prepared_dir)
    else:
        if not args.output_dir or not args.adapters_root:
            p.error("publication requires a fresh directory and actual saved adapter files")
        result = publish(args.run_dir, args.prepared_dir, args.adapters_root, args.output_dir)
    print(json.dumps({"publication_verified": True, "states_replayed": result["total_states_replayed"]}))
