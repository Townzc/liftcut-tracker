"""Publish verified synthetic four-arm evidence; adapter weights remain off Git."""
import argparse
import json
from pathlib import Path
import shutil

from audit_state_coverage import audit
from gpu_state_diagnostics import read
from liftcut_agent.benchmark import read_jsonl
from restore_state_coverage import validate_index
from review_state_coverage import review
from server_workspace import dump_new, sha256
from state_coverage import ARMS, ROOT


def public_paths():
    paths = ["window-status.json", "comparison.json", "backup-index.json", "off-instance-verification.json",
        "operations.json", "generation-token-audit.json", "preflight/doctor.json", "preflight/tests.log", "preflight/prepare.log",
        "preflight/diagnostic.log", "preflight/preflight-results.json", "preflight/boot-observation.json"]
    for arm in ARMS:
        paths += [f"training/{arm}/{n}" for n in ("manifest.json", "report.json", "memory-probe.json",
                                                   "training.jsonl", "final/adapter_config.json")]
        paths += [f"evaluation/{arm}/{n}" for n in ("manifest.json", "config.json")]
        for panel in ("normal", "diagnostic"):
            paths += [f"evaluation/{arm}/{panel}/{n}" for n in
                      ("report.json", "episodes.jsonl", "calls.jsonl", "generations.jsonl")]
    return paths


def verify_restore_scope(run):
    index, receipt = read(run / "backup-index.json"), read(run / "off-instance-verification.json")
    validate_index(index)
    status = read(run / "window-status.json")
    if (status["status"] != "complete" or status["failures"] or receipt["run_status"] != "complete"
            or receipt["inventory_digest"] != index["inventory_digest"]
            or receipt["all_archive_files_verified"] is not True or receipt["complete_study_replayed"] is not True
            or receipt["episodes_replayed"] != 124 or receipt["adapter_files_verified"] is not True
            or receipt["test_episodes"] != 0):
        raise ValueError("coverage publication requires complete off-instance restore and actual-weight verification")
    if (len(receipt["archives"]) != 5 or any(
            any(saved[k] != expected[k] for k in ("archive", "bytes", "sha256"))
            or saved["all_inventory_files_verified"] is not True or saved["verified_files"] <= 0
            for saved, expected in zip(receipt["archives"], index["archives"]))):
        raise ValueError("coverage restore receipts differ from five-archive inventory")
    return receipt


def verify_token_receipt(run, result):
    receipt = read(run / "generation-token-audit.json")
    if receipt["tokenizer_provenance"] != read(ROOT / "configs/qwen3-4b-tokenizer.json") or receipt["new_model_calls"] != 0:
        raise ValueError("wrong coverage tokenizer receipt provenance")
    for arm in ARMS:
        for panel in ("normal", "diagnostic"):
            row = receipt["panels"][arm][panel]
            directory = run / "evaluation" / arm / panel
            calls = read_jsonl(directory / "calls.jsonl")
            if (row["requests"] != len(calls)
                    or any(row[k] != result["arms"][arm][panel][k] for k in ("actual_model_generations", "local_context_guards"))
                    or row["calls_sha256"] != sha256(directory / "calls.jsonl")
                    or row["generations_sha256"] != sha256(directory / "generations.jsonl")):
                raise ValueError("coverage tokenizer receipt refers to different generation evidence")


def markdown(result):
    lines = ["# Four-arm state-coverage development experiment", "",
        "One seed (42), four newly trained adapters, unchanged 12 full development tasks and 19 fixed-state probes per arm.",
        "The same development states informed this intervention; these are not held-out or independent generalization scores.", "",
        "| Arm | Full task | Read-history consent | Main memory | All consent | Memory control |",
        "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for arm in ARMS:
        counts = result["arms"][arm]["counts"]
        scores = [f"{counts[k]['correct']}/{counts[k]['total']}" for k in
                  ("normal", "read_consent", "main_memory", "all_consent", "memory_control")]
        lines.append("| " + arm.upper() + " | " + " | ".join(scores) + " |")
    lines += ["", "Prespecified development gates: " + json.dumps(result["comparisons"]["factor_screen_passed"]) + ".", "",
        "- `comparison.json`: full server audit, including actual private adapter-file hashes; all 124 traces replayed.",
        "- `review.json`: reproducible descriptive counts, all paired gains/losses, interactions, first actions, value matches and cost proxies.",
        "- `training/*`: all 126 update records per arm, memory probes, provenance and adapter configurations; weights omitted.",
        "- `evaluation/*`: durable calls, original generated text and complete environment traces, including failures.",
        "- `generation-token-audit.json`: CPU re-tokenization of every model request and decoding of saved output IDs; independently repeated by tokenizer CI.",
        "- `backup-index.json` and `off-instance-verification.json`: five-archive inventory and historical restore receipt.",
        "- `operations.json`: observed timing, assumed compute price, shutdown observations and billing uncertainty.",
        "- `publication-manifest.json`: exact public file inventory; CPU verification replays native responses and scores.", "",
        "Public replay verifies metadata and traces; it cannot rehash the omitted private weights.",
        "Value matches do not establish internal causal provenance; single-seed effects and interactions are descriptive.",
        "[Frozen specification](../../../../docs/research/2026-09-29-state-coverage-experiment.md)",
        "[Research journal](../../../../docs/research/EXPERIMENT_LOG.md)", ""]
    return "\n".join(lines)


def publish(run, prepared, diagnostic, output):
    if output.exists():
        raise ValueError("new publication directory required")
    if any(p.is_symlink() for p in run.rglob("*")):
        raise ValueError("run artifacts must not be linked")
    result = audit(run, prepared, diagnostic)
    verify_restore_scope(run)
    verify_token_receipt(run, result)
    if result != read(run / "comparison.json"):
        raise ValueError("server comparison differs from actual-weight replay")
    described = review(run, prepared, diagnostic, audited=result)
    for name in public_paths():
        path = run / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("missing or linked public artifact: " + name)
    output.mkdir(parents=True, exist_ok=False)
    for name in public_paths():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(run / name, target)
    dump_new(output / "adapter-verification.json", {"weights_published": False,
        "scope": "Actual off-instance adapter files rehashed before publication; public replay verifies metadata only",
        "files_verified": {a: read(run / "training" / a / "report.json")["adapter_sha256"] for a in ARMS}})
    dump_new(output / "review.json", described)
    (output / "README.md").write_text(markdown(described), encoding="utf-8", newline="\n")
    dump_new(output / "publication-manifest.json", {"scope": "Synthetic reused-development evidence, no weights or credentials",
        "copied_files": public_paths(), "files": {p.relative_to(output).as_posix(): sha256(p)
            for p in sorted(output.rglob("*")) if p.is_file()}})
    return described


def verify_publication(run, prepared, diagnostic):
    manifest = read(run / "publication-manifest.json")
    if any(p.is_symlink() for p in run.rglob("*")):
        raise ValueError("public artifacts must not be linked")
    files = {p.relative_to(run).as_posix(): sha256(p) for p in run.rglob("*")
             if p.is_file() and p.relative_to(run).as_posix() != "publication-manifest.json"}
    expected = set(public_paths()) | {"adapter-verification.json", "review.json", "README.md"}
    if files != manifest["files"] or set(files) != expected or manifest["copied_files"] != public_paths():
        raise ValueError("public coverage inventory mismatch")
    verify_restore_scope(run)
    result = audit(run, prepared, diagnostic, verify_weights=False)
    verify_token_receipt(run, result)
    historical = read(run / "comparison.json")
    if historical["adapter_files_verified"] is not True or result != {**historical, "adapter_files_verified": False}:
        raise ValueError("public coverage comparison differs from replay")
    metadata = read(run / "adapter-verification.json")
    if (metadata["weights_published"] is not False or metadata["files_verified"] !=
            {a: read(run / "training" / a / "report.json")["adapter_sha256"] for a in ARMS}):
        raise ValueError("public adapter metadata mismatch")
    described = review(run, prepared, diagnostic, audited=result)
    if described != read(run / "review.json") or (run / "README.md").read_text(encoding="utf-8") != markdown(described):
        raise ValueError("public coverage review differs from replay")
    return described


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--output-dir", type=Path)
    p.add_argument("--check-publication", action="store_true")
    args = p.parse_args()
    if args.check_publication:
        if args.output_dir:
            p.error("public verification does not write or rehash private weights")
        result = verify_publication(args.run_dir, args.prepared_dir, args.diagnostic_dir)
    else:
        if not args.output_dir:
            p.error("publication requires a fresh output directory")
        result = publish(args.run_dir, args.prepared_dir, args.diagnostic_dir, args.output_dir)
    print(json.dumps({"publication_verified": True, "episodes_replayed": result["episodes_replayed"],
                      "factor_screen_passed": result["comparisons"]["factor_screen_passed"]}))
