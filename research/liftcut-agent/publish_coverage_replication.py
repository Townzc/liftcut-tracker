"""Publish one completely restored R1 seed; weights stay private, token replay is real.

This CPU-only entrypoint is separate from the frozen GPU execution sources. It
requires the actual restored weights when publishing. Public verification must
explicitly acknowledge omitted weights and preserves the original attestation.
"""
import argparse
import json
from pathlib import Path
import shutil

from audit_coverage_replication import audit
from prepare_coverage_replication import ARMS, RUN_SEEDS, read, require_seed, require_binding, run_binding, verify_prepared
from publish_recovery import adapter_metadata
from restore_coverage_replication import validate_index
from server_workspace import dump_new, sha256

EXECUTION_COMMIT = "f18cb5820881a048b19b6007fc4ca231dfd64de9"
PUBLIC_SCOPE = "One R1 training seed on synthetic reused development states; private weights omitted"


def public_paths():
    paths = ["run-binding.json", "window-status.json", "comparison.json", "backup-index.json",
             "off-instance-verification.json", "generation-token-audit.json"]
    for arm in ARMS:
        paths += [f"training/{arm}/{name}" for name in (
            "manifest.json", "report.json", "initialization.json", "memory-probe.json",
            "runtime.json", "training.jsonl", "final/adapter_config.json")]
        paths += [f"evaluation/{arm}/{name}" for name in ("manifest.json", "config.json", "runtime.json")]
        for panel in ("normal", "diagnostic"):
            paths += [f"evaluation/{arm}/{panel}/{name}" for name in (
                "report.json", "episodes.jsonl", "calls.jsonl", "generations.jsonl")]
    return paths


def verify_restore_scope(run, plan):
    """Historical receipts are consistency evidence, not a substitute for rehashing."""
    binding = run_binding(plan, EXECUTION_COMMIT)
    require_binding(read(run / "run-binding.json"), binding)
    index, receipt = read(run / "backup-index.json"), read(run / "off-instance-verification.json")
    validate_index(index, plan, EXECUTION_COMMIT)
    status = read(run / "window-status.json")
    for item in (receipt, status):
        require_binding(item.get("run_binding"), binding)
    if (status["status"] != "complete" or status.get("failures") != []
            or status.get("code_commit") != EXECUTION_COMMIT or status.get("test_episodes") != 0
            or receipt["run_status"] != "complete" or receipt["inventory_digest"] != index["inventory_digest"]
            or receipt["all_archive_files_verified"] is not True or receipt["complete_study_replayed"] is not True
            or receipt["episodes_replayed"] != 124 or receipt["adapter_files_verified"] is not True
            or receipt["token_ids_verified"] is not True or receipt["test_episodes"] != 0):
        raise ValueError("R1 publication requires complete actual-weight/native/token off-instance verification")
    if (len(receipt["archives"]) != 5 or any(
            any(saved[k] != expected[k] for k in ("archive", "bytes", "sha256"))
            or saved["all_inventory_files_verified"] is not True
            or type(saved["verified_files"]) is not int or saved["verified_files"] <= 0
            for saved, expected in zip(receipt["archives"], index["archives"]))):
        raise ValueError("R1 restore receipts differ from five-archive inventory")
    return receipt


def markdown(result):
    seed = result["run_binding"]["seed"]
    lines = [f"# R1 state-coverage replication: seed{seed}", "",
        "Four adapters, 12 complete development tasks and 19 fixed-state probes per arm.",
        "These are reused development states; another training seed does not add independent tasks.", "",
        "| Arm | Full task | Read-history consent | Main memory | All consent | Blocked unapproved writes |",
        "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for arm in ARMS:
        normal, diagnostic = result["arms"][arm]["normal"], result["arms"][arm]["diagnostic"]
        rows = diagnostic["results"]
        reads = [r for r in rows if r["panel"] == "consent" and r["factors"].get("history") == "read"]
        memory = [r for r in rows if r["panel"] == "memory" and r["factors"]["position"] is not None]
        consent = [r for r in rows if r["panel"] == "consent"]
        scores = [f"{normal['passed']}/{len(normal['results'])}"] + [
            f"{sum(r['correct'] for r in group)}/{len(group)}" for group in (reads, memory, consent)]
        blocked = normal["blocked_write_attempts"] + sum(p["autonomous_blocked_writes"] for p in diagnostic["panels"].values())
        lines.append("| " + arm.upper() + " | " + " | ".join(scores) + f" | {blocked} |")
    lines += ["", "Original development screening gates: " + json.dumps(result["comparisons"]["factor_screen_passed"]) + ".", "",
        "- `comparison.json` preserves the original complete actual-weight audit and all 124 episode replays.",
        "- `training/*` includes initialization fingerprints, all updates, runtime records and adapter configurations; weight bytes are omitted.",
        "- `evaluation/*` preserves native responses, saved output token IDs and environment traces, including failures.",
        "- `generation-token-audit.json` is independently reconstructed with the pinned tokenizer during publication and public verification.",
        "- `backup-index.json` and `off-instance-verification.json` preserve the five-archive index and successful off-instance receipt.",
        "- `adapter-verification.json` records actual weight hashes and tensor metadata checked before publication.",
        "- `publication-manifest.json` specifies the exact public inventory.", "",
        "Public verification requires explicit acceptance of omitted weights: it replays metadata/native/token evidence,",
        "while the unchanged original comparison records historical actual-weight verification. It cannot rehash absent weights.",
        "This single-seed report does not establish three-seed replication or candidate promotion. All original gates remain unchanged.",
        "No reserved test evaluation or new model call occurs in publication.", ""]
    return "\n".join(lines)


def verify_adapter_metadata(run):
    metadata = read(run / "adapter-verification.json")
    expected = {a: read(run / "training" / a / "report.json")["adapter_sha256"] for a in ARMS}
    if metadata["weights_published"] is not False or metadata["files_verified"] != expected:
        raise ValueError("R1 public adapter metadata mismatch")
    tensors = metadata["saved_tensor_metadata"]
    if set(tensors) != set(ARMS) or any(
            tensors[a]["sha256"] != expected[a]["adapter_model.safetensors"]
            or any(type(tensors[a][k]) is not int or tensors[a][k] <= 0
                   for k in ("adapter_bytes", "tensor_count", "parameter_count"))
            or tensors[a]["dtypes"] != ["F32"]
            or any(tensors[a][k] != tensors["s0"][k] for k in ("tensor_count", "parameter_count", "dtypes"))
            for a in ARMS):
        raise ValueError("R1 saved tensor metadata differs across adapters or weight hashes")


def publish(run, prepared, diagnostic, replication, seed, tokenizer, output):
    require_seed(seed, executing=True)
    if output.exists():
        raise ValueError("new publication directory required")
    if run.is_symlink() or any(p.is_symlink() for p in run.rglob("*")):
        raise ValueError("run artifacts must not be linked")
    plan = verify_prepared(prepared, diagnostic, replication, seed)
    verify_restore_scope(run, plan)
    # Full audit rehashes actual private weights and reconstructs native/token evidence.
    result = audit(run, prepared, diagnostic, replication, seed, tokenizer)
    if result != read(run / "comparison.json"):
        raise ValueError("R1 comparison differs from actual-weight/native/token replay")
    metadata = {"weights_published": False,
        "scope": "Actual off-instance weights rehashed before publication; public replay cannot rehash omitted bytes",
        "files_verified": {a: read(run / "training" / a / "report.json")["adapter_sha256"] for a in ARMS},
        "saved_tensor_metadata": {a: adapter_metadata(run / "training" / a / "final/adapter_model.safetensors") for a in ARMS}}
    for name in public_paths():
        if not (run / name).is_file():
            raise ValueError("missing public artifact: " + name)
    output.mkdir(parents=True, exist_ok=False)
    for name in public_paths():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(run / name, target)
    dump_new(output / "adapter-verification.json", metadata)
    verify_adapter_metadata(output)
    (output / "README.md").write_text(markdown(result), encoding="utf-8", newline="\n")
    dump_new(output / "publication-manifest.json", {"scope": PUBLIC_SCOPE,
        "run_binding": result["run_binding"], "copied_files": public_paths(),
        "files": {p.relative_to(output).as_posix(): sha256(p) for p in sorted(output.rglob("*")) if p.is_file()}})
    return result


def verify_publication(run, prepared, diagnostic, replication, seed, tokenizer, *, allow_missing_weights=False):
    require_seed(seed, executing=True)
    if not allow_missing_weights:
        raise ValueError("public replay requires explicit allow_missing_weights; private weights are omitted")
    if run.is_symlink() or any(p.is_symlink() for p in run.rglob("*")):
        raise ValueError("public artifacts must not be linked")
    manifest = read(run / "publication-manifest.json")
    files = {p.relative_to(run).as_posix(): sha256(p) for p in run.rglob("*")
             if p.is_file() and p.relative_to(run).as_posix() != "publication-manifest.json"}
    expected = set(public_paths()) | {"adapter-verification.json", "README.md"}
    if (manifest.get("scope") != PUBLIC_SCOPE or files != manifest["files"] or set(files) != expected
            or manifest["copied_files"] != public_paths()):
        raise ValueError("R1 public inventory mismatch")
    plan = verify_prepared(prepared, diagnostic, replication, seed)
    require_binding(manifest.get("run_binding"), run_binding(plan, EXECUTION_COMMIT))
    verify_restore_scope(run, plan)
    result = audit(run, prepared, diagnostic, replication, seed, tokenizer, verify_weights=False)
    historical = read(run / "comparison.json")
    if historical["adapter_files_verified"] is not True or result != {**historical, "adapter_files_verified": False}:
        raise ValueError("R1 public comparison differs from native/token replay or lost weight attestation")
    verify_adapter_metadata(run)
    if (run / "README.md").read_text(encoding="utf-8") != markdown(result):
        raise ValueError("R1 public summary differs from replay")
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir", "replication-dir", "tokenizer-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--seed", type=int, choices=RUN_SEEDS, required=True)
    p.add_argument("--output-dir", type=Path)
    p.add_argument("--check-publication", action="store_true")
    p.add_argument("--allow-missing-weights", action="store_true")
    args = p.parse_args()
    inputs = (args.run_dir, args.prepared_dir, args.diagnostic_dir, args.replication_dir, args.seed, args.tokenizer_dir)
    if args.check_publication:
        if args.output_dir or not args.allow_missing_weights:
            p.error("public verification requires --allow-missing-weights and no output directory")
        result = verify_publication(*inputs, allow_missing_weights=True)
    else:
        if not args.output_dir or args.allow_missing_weights:
            p.error("publication requires actual weights and a fresh output directory")
        result = publish(*inputs, args.output_dir)
    print(json.dumps({"publication_verified": True, "seed": args.seed,
        "episodes_replayed": result["episodes_replayed"], "adapter_files_verified_now": result["adapter_files_verified"],
        "token_ids_verified": result["token_ids_verified"], "new_model_calls": 0}))
