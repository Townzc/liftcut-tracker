"""Replay the post-hoc opaque-ID diagnostic against the unchanged original arms."""

import argparse
from collections import Counter
import json
from pathlib import Path

from audit_recovery import ROOT, audit_rollout, invalid_validations, read
from blind_recovery_ids import PROBE, blind, identifier_hints
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.interactive import digest
from recovery_dataset import load_frozen
from server_workspace import dump_new, sha256


def paired(before, after):
    if [r["scenario_id"] for r in before] != [r["scenario_id"] for r in after]:
        raise ValueError("paired scenario identity/order mismatch")
    counts = Counter({"both_passed": 0, "before_only": 0, "after_only": 0, "both_failed": 0})
    changes = []
    for a, b in zip(before, after):
        counts["both_passed" if a["passed"] and b["passed"] else "before_only" if a["passed"] else
               "after_only" if b["passed"] else "both_failed"] += 1
        if a["passed"] != b["passed"]:
            changes.append({"scenario_id": a["scenario_id"], "before_passed": a["passed"], "after_passed": b["passed"]})
    return {"counts": dict(counts), "changes": changes}


def verify_intervention(original, probe):
    if probe != [blind(row) for row in original] or any(identifier_hints(row) for row in probe):
        raise ValueError("probe changes fields beyond the frozen identifier intervention")


def audit_probe(run):
    original_all, probe_all = load_frozen(), load_frozen(PROBE)
    verify_intervention(original_all, probe_all)
    original = [r for s in ("dev", "test") for r in original_all if r["split"] == s]
    scenarios = [r for s in ("dev", "test") for r in probe_all if r["split"] == s]
    root = run / "identifier-probe"
    if read(root / "status.json")["status"] != "complete":
        raise ValueError("partial probe is not a complete three-arm comparison")
    for name in ("manifest.json", "train.jsonl", "dev.jsonl", "test.jsonl"):
        if sha256(root / "cases" / name) != sha256(PROBE / name):
            raise ValueError("executed probe differs from frozen files")
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    arms, original_to_opaque, configs = {}, {}, {}
    for arm in ("unadapted", "clean", "mixed"):
        directory = root / arm
        manifest, original_manifest = read(directory / "manifest.json"), read(run / "evaluation" / arm / "manifest.json")
        for key in ("code_commit", "model", "catalog_sha256", "precision", "parser_version", "adapter_sha256"):
            if manifest[key] != original_manifest[key]:
                raise ValueError("probe changed original model/source/precision")
        expected = [{"name": f"{s}.jsonl", "sha256": sha256(PROBE / f"{s}.jsonl")} for s in ("dev", "test")]
        if manifest["case_files"] != expected:
            raise ValueError("probe case-file manifest mismatch")
        episodes, report, config = audit_rollout(directory, scenarios, catalog)
        _, original_report, original_config = audit_rollout(run / "evaluation" / arm, original, catalog)
        if config != original_config:
            raise ValueError("probe changed original evaluation settings")
        if [e["trace"]["episode_id"] for e in episodes] != [digest(s)[:32] for s in scenarios]:
            raise ValueError("probe episode ID provenance mismatch")
        configs[arm] = config
        original_to_opaque[arm] = paired(original_report["results"], report["results"])
        arms[arm] = {key: report[key] for key in ("total", "passed", "clean_completions", "blocked_write_attempts",
            "requests", "tool_errors", "policy_failures", "by_category", "observed_prompt_tokens",
            "observed_completion_tokens", "request_latency_p50_seconds", "request_latency_p95_seconds", "replay", "results")}
        arms[arm]["invalid_validate_plan_results"] = invalid_validations(episodes)
        arms[arm]["splits"] = {}
        for split in ("dev", "test"):
            rows = [r for r, s in zip(report["results"], scenarios) if s["split"] == split]
            arms[arm]["splits"][split] = {"total": len(rows), "passed": sum(r["passed"] for r in rows),
                "clean_completions": sum(r["passed"] and r["clean_completion"] for r in rows),
                "blocked_write_attempts": sum(r["blocked_write_attempts"] for r in rows),
                "actual_writes": sum(r["writes"] for r in rows)}
    if len({digest(c.manifest()) for c in configs.values()}) != 1:
        raise ValueError("probe arms used different configurations")
    return {"scope": "Post-hoc opaque-ID robustness diagnostic on reused tasks; original hinted training unchanged",
        "limitations": ["Not an independent held-out or corrected-training study", "Opaque IDs change tokenization and derived proposal IDs",
                        "Single training seed and shared-author/template scenarios", "Log consistency, not independent hardware provenance"],
        "arms": arms, "original_to_opaque": original_to_opaque,
        "opaque_clean_to_mixed": paired(arms["clean"]["results"], arms["mixed"]["results"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit_probe(args.run_dir)
    if args.output:
        dump_new(args.output, result)
    print(json.dumps({"scope": result["scope"], "paired": result["opaque_clean_to_mixed"]}, indent=2))
