"""Audit a complete two-factor protocol comparison; never fill missing cells."""

from pathlib import Path

from .benchmark import read_json, read_jsonl
from .interactive import digest
from .run_audit import audit_run, build_ledger

ARMS = ("single-original", "batch-original", "single-clarified", "batch-clarified")
FACTORS = {"single-original": ("single", "original"), "batch-original": ("read_batch", "original"),
           "single-clarified": ("single", "pending_approval_v1"), "batch-clarified": ("read_batch", "pending_approval_v1")}


def paired(left, right):
    if left["scenario_ids"] != right["scenario_ids"]:
        raise ValueError("unmatched scenario selections")
    counts = {"both_passed": 0, "left_only": 0, "right_only": 0, "both_failed": 0}
    changed = []
    for a, b in zip(left["scenarios"], right["scenarios"]):
        counts["both_passed" if a["passed"] and b["passed"] else "left_only" if a["passed"] else
               "right_only" if b["passed"] else "both_failed"] += 1
        if a["passed"] != b["passed"]:
            changed.append({"scenario_id": a["scenario_id"], "left_passed": a["passed"], "right_passed": b["passed"]})
    return {**counts, "changed": changed, "pass_count_difference": right["passed"] - left["passed"]}


def compare_runs(parent: Path, scenarios, catalog, **hashes):
    audits, common, source = {}, None, None
    for arm in ARMS:
        directory = parent / arm
        config = read_json((directory / "config.json").read_text(encoding="utf-8"))
        if (config.pop("tool_protocol"), config.pop("prompt_revision")) != FACTORS[arm]:
            raise ValueError("arm configuration does not match declared factors")
        if common is not None and digest(config) != common:
            raise ValueError("comparison changes more than the two declared factors")
        common = digest(config)
        audit = audit_run(directory, scenarios, catalog, **hashes)
        identity = {key: audit[key] for key in ("mode", "source_code", "scenario_ids", "scenario_digest")}
        manifest = read_json((directory / "manifest.json").read_text(encoding="utf-8"))
        identity["endpoint"] = manifest["endpoint"]
        if source is not None and digest(identity) != source:
            raise ValueError("comparison source, mode, endpoint or scenario order differs")
        source = digest(identity)
        episodes = read_jsonl(directory / "episodes.jsonl")
        audit["executed_tool_steps"] = sum(row["steps"] for row in audit["scenarios"])
        audit["accepted_batch_responses"] = sum(len(call.get("actions", [])) > 1 for ep in episodes for call in ep["calls"])
        audits[arm] = audit
    ledger = build_ledger(list(audits.values()))
    return {"scope": "single-run public-development protocol comparison; not training gains or causal significance",
            "arms": audits, "spending": {key: value for key, value in ledger.items() if key != "runs"},
            "paired_comparisons": {f"{a}__to__{b}": paired(audits[a], audits[b]) for a, b in (
                (ARMS[0], ARMS[1]), (ARMS[2], ARMS[3]), (ARMS[0], ARMS[2]), (ARMS[1], ARMS[3]))}}
