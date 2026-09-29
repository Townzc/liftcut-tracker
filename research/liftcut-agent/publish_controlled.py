"""Publish an explicitly selected, audited synthetic v2 log bundle locally."""
import argparse
import json
from pathlib import Path
import shutil

from audit_controlled import audit
from publish_recovery import adapter_metadata
from review_controlled import review
from server_workspace import dump_new, sha256


def public_paths():
    paths = ["window-status.json", "comparison.json", "server-doctor.json", "server-tests.log",
             "server-preparation.log", "boot-observation.json", "window-revision.json",
             "backup-index.json", "off-instance-verification.json"]
    for arm in ("clean", "mixed"):
        paths.extend(f"training/{arm}/{name}" for name in
                     ("manifest.json", "report.json", "training.jsonl", "memory-probe.json", "final/adapter_config.json"))
    for arm in ("unadapted", "clean", "mixed"):
        paths.extend(f"evaluation/{arm}/{name}" for name in
                     ("manifest.json", "config.json", "report.json", "episodes.jsonl", "generations.jsonl"))
    return paths


def summary_markdown(result):
    lines = ["# Corrected recovery-v2 development study", "",
        "Three model arms, one seed, one authored development bundle. The 48 reserved test tasks were not run.",
        "Normal and fixed-error continuation panels have different starting states and must not be pooled.", "",
        "| Arm | Normal success | Continuation success | Acceptable first recovery | Autonomous blocked writes |",
        "| --- | ---: | ---: | ---: | ---: |"]
    for arm, data in result["arms"].items():
        normal, continuation = data["panels"]["normal"], data["panels"]["continuation"]
        lines.append(f"| {arm} | {normal['passed']}/12 | {continuation['passed']}/9 | "
                     f"{continuation['first_recovery_acceptable']}/9 | "
                     f"{normal['autonomous_blocked_writes'] + continuation['autonomous_blocked_writes']} |")
    lines += ["", "Both SFT arms consumed 648 decisions, 81 optimizer updates and 26,052 supervised tokens.",
        "Every paired target and sampler position matches. Extra context tokens and compute time differ.", "",
        "- `comparison.json`: original server audit with actual adapter files.",
        "- `backed-up-adapter-audit.json`: re-audit of actual restored off-instance weights.",
        "- `public-log-audit.json`: reproducible public metadata/log replay; weights are omitted.",
        "- `review.json`: per-task action order, clarification, validation and descriptive gate inputs.",
        "- `publication-manifest.json`: hashes of all selected and generated public artifacts.", "",
        "Synthetic prefixes have zero model usage; only subsequent actions contribute to autonomous metrics.",
        "These audits verify log consistency and artifact hashes, not independent hardware or supplier billing.",
        "[Execution specification](../../../../docs/research/2026-09-29-controlled-recovery-experiment.md)", ""]
    return "\n".join(lines)


def publish(root, prepared, output):
    if output.exists():
        raise ValueError("publication destination must be new")
    verified = audit(root, prepared)
    status = json.loads((root / "window-status.json").read_text(encoding="utf-8"))
    original = json.loads((root / "comparison.json").read_text(encoding="utf-8"))
    if status["status"] != "complete" or status["failures"] or original != verified:
        raise ValueError("cannot publish an incomplete or inconsistent experiment as complete")
    for name in public_paths():
        source = root / name
        if not source.is_file() or source.is_symlink():
            raise ValueError("missing or linked public artifact: " + name)
    output.mkdir(parents=True, exist_ok=False)
    for name in public_paths():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / name, destination)
    dump_new(output / "backed-up-adapter-audit.json", verified)
    dump_new(output / "adapter-metadata.json", {arm: adapter_metadata(root / "training" / arm / "final/adapter_model.safetensors")
                                              for arm in ("clean", "mixed")})
    public = audit(output, prepared, verify_weights=False)
    dump_new(output / "public-log-audit.json", public)
    dump_new(output / "review.json", review(output, prepared))
    (output / "README.md").write_text(summary_markdown(public), encoding="utf-8", newline="\n")
    dump_new(output / "publication-manifest.json", {
        "scope": "Synthetic development evidence; adapter weights and credentials excluded",
        "files": {p.relative_to(output).as_posix(): sha256(p) for p in sorted(output.rglob("*")) if p.is_file()},
        "copied_files": public_paths(), "adapter_files_verified_before_publication": True,
        "public_audit_verifies_adapter_metadata_only": True})
    return public


def verify_publication(root, prepared):
    manifest = json.loads((root / "publication-manifest.json").read_text(encoding="utf-8"))
    paths = [p for p in root.rglob("*") if p.is_file() and p.name != "publication-manifest.json"]
    if any(p.is_symlink() for p in root.rglob("*")):
        raise ValueError("public artifacts must not contain links")
    if ({p.relative_to(root).as_posix(): sha256(p) for p in paths} != manifest["files"]
            or manifest["copied_files"] != public_paths()):
        raise ValueError("public file inventory mismatch")
    result = audit(root, prepared, verify_weights=False)
    for name in ("public-log-audit.json", "backed-up-adapter-audit.json", "comparison.json"):
        saved = json.loads((root / name).read_text(encoding="utf-8"))
        expected_flag = name != "public-log-audit.json"
        if saved["adapter_files_verified"] is not expected_flag:
            raise ValueError("incorrect adapter verification scope")
        saved["adapter_files_verified"] = False
        if saved != result:
            raise ValueError("published audit differs from replay")
    if review(root, prepared) != json.loads((root / "review.json").read_text(encoding="utf-8")):
        raise ValueError("published review differs from replay")
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run-dir", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--output-dir", type=Path)
    p.add_argument("--check-publication", action="store_true")
    args = p.parse_args()
    if args.check_publication:
        if args.output_dir:
            p.error("publication check does not write an output directory")
        result = verify_publication(args.run_dir, args.prepared_dir)
    else:
        if not args.output_dir:
            p.error("publication requires a new output directory")
        result = publish(args.run_dir, args.prepared_dir, args.output_dir)
    print(json.dumps({"publication_verified": True, "episodes_replayed": result["episodes_replayed"]}))
