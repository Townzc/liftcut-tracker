"""Retrospective design evidence from frozen dev results and exact training decisions.

No model calls, new evaluation, revised old gates, or reserved-test reads.
The published inputs have already undergone native/environment replay; hash checks
here bind this secondary analysis to that evidence, not an independent re-audit.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARMS = ("s0", "t", "m", "tm")
PUBLISHED = ROOT / "reports/qwen-state-coverage-2026-09-29"
REPORT = ROOT / "reports/state-coverage-followup-analysis-2026-09-29.json"
REPAIR_ERRORS = {"unknown_evidence", "session_count_mismatch"}


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked(path, expected):
    if sha(path) != expected:
        raise ValueError(f"analysis input hash mismatch: {path.name}")
    return path


def tally(rows):
    return {"correct": sum(r["correct"] for r in rows), "total": len(rows)}


def training_summary(rows):
    tools, outcomes, errors = Counter(), Counter(), Counter()
    for row in rows:
        if row["split"] != "train":
            raise ValueError("secondary analysis accepts training decisions only")
        for call in row["messages"][-1]["tool_calls"]:
            function = call["function"]
            tools[function["name"]] += 1
            if function["name"] == "finish":
                outcomes[function["arguments"]["outcome"]] += 1
        observed = set()
        for message in row["messages"][:-1]:
            if message["role"] != "tool":
                continue
            result = json.loads(message["content"]).get("result", {})
            observed.update(REPAIR_ERRORS.intersection(result.get("issues", [])))
        errors.update(observed)
    return {"decision_rows": len(rows), "target_tools": dict(sorted(tools.items())),
            "finish_outcomes": dict(sorted(outcomes.items())),
            "decisions_after_named_validation_error": {e: errors[e] for e in sorted(REPAIR_ERRORS)},
            "counting_unit": "Unique exported decisions, before two-epoch reuse; histories may overlap"}


def describe_arm(arm):
    memory = [r for r in arm["diagnostic_cases"] if r["panel"] == "memory" and r["factors"]["position"] is not None]
    if len(memory) != 8 or len({r["case_id"] for r in memory}) != 8:
        raise ValueError("expected exactly eight paired main-memory development cases")
    if len(arm["normal_cases"]) != 12:
        raise ValueError("expected twelve normal development cases")
    subgroups = {}
    for factor in ("position", "invalid", "clarification"):
        subgroups[factor] = {str(value).lower(): tally([r for r in memory if r["factors"][factor] == value])
                            for value in sorted({r["factors"][factor] for r in memory})}
    failures = []
    for row in arm["normal_cases"]:
        issues = {i for event in row["invalid_validations"] for i in event["issues"]}
        if not row["passed"] and issues.intersection(REPAIR_ERRORS):
            failures.append({"scenario_id": row["scenario_id"], "validation_issues": sorted(issues),
                             "outcome": row["outcome"], "finish_after_invalid_validation": row["finish_after_invalid_validation"]})
    return {"memory_subgroups": subgroups,
            "main_memory_effective_values": sorted({tuple(r["effective_equipment"]) for r in memory}),
            "failed_tasks_with_named_validation_errors": failures,
            "limit": "A named validation error does not prove a single-field repair suffices; see scripted-repair evidence"}


def analyze(prepared):
    inventory = read(PUBLISHED / "publication-manifest.json")["files"]
    review_path = checked(PUBLISHED / "review.json", inventory["review.json"])
    review = read(review_path)
    preparation_path = ROOT / "reports/state-coverage-preparation-v1.json"
    preparation = read(preparation_path)
    result = {"scope": "Retrospective seed42 development/training audit for a future design; no new model evidence",
              "source_sha256": {"review.json": sha(review_path), "state-coverage-preparation-v1.json": sha(preparation_path)},
              "arms": {}, "old_gates_changed": False, "new_model_calls": 0, "reserved_test_reads": 0}
    for arm in ARMS:
        name = f"decisions/{arm}/decisions.jsonl"
        path = checked(prepared / name, preparation["files"][name])
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        if len(rows) != 504:
            raise ValueError("wrong training decision denominator")
        result["source_sha256"][name] = sha(path)
        result["arms"][arm] = {**describe_arm(review["arms"][arm]), "training": training_summary(rows)}
    # Keep both conditional effects; averaging alone hides their opposite directions.
    pairs = review["comparisons"]["pairs"]
    result["conditional_effects"] = {key: {"factor": row["factor"],
        "normal_net": row["normal"]["net"], "read_consent_net": row["read_consent"]["net"],
        "memory_net": row["main_memory"]["net"], "new_blocked_cases": row["cases_with_added_blocked_writes"],
        "original_screen_passed": row["development_gate_passed"]} for key, row in pairs.items()}
    result["descriptive_average_factor_effects_in_case_counts"] = {
        factor: {metric: sum(result["conditional_effects"][key][metric] for key in keys) / 2
                 for metric in ("normal_net", "read_consent_net", "memory_net")}
        for factor, keys in {"T": ("s0->t", "m->tm"), "M": ("s0->m", "t->tm")}.items()}
    result["interpretation_limit"] = "Correlated probes and one training seed; no significance, attention attribution, or generalization claim"
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared-dir", required=True, type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = analyze(args.prepared_dir)
    # Normalize tuples as JSON arrays for identical write/check behavior.
    serialized = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if json.loads(serialized) != read(REPORT):
            raise ValueError("secondary analysis differs from published report")
    else:
        with REPORT.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(serialized)
    print(json.dumps({"report": REPORT.name, "checked": args.check, "new_model_calls": 0,
                      "conditional_effects": result["conditional_effects"]}, ensure_ascii=False))
