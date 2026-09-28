"""Strict, dependency-free proposal benchmark. This is not a model agent.

Durations are artificial catalogue block costs, not exercise prescriptions.
Case metadata and expected_action belong to the evaluator, never to a policy.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

VERSION = "proposal-v0.1"
DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
EQUIPMENT = {"bodyweight", "dumbbell", "barbell", "machine"}
FIELDS = {
    "available_days", "sessions_per_week", "equipment", "max_minutes",
    "min_exercises", "excluded_exercise_ids",
}
REQUIRED = FIELDS - {"excluded_exercise_ids"}
ACTIONS = {"propose_plan", "request_clarification", "report_infeasible"}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _integer(value: Any, minimum: int, maximum: int) -> bool:
    return type(value) is int and minimum <= value <= maximum


def _strings(value: Any, *, nonempty: bool = False) -> bool:
    return (
        isinstance(value, list)
        and (not nonempty or bool(value))
        and all(isinstance(item, str) and item.strip() for item in value)
        and len(value) == len(set(value))
    )


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        _require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON constant: {value}")


def read_json(text: str) -> Any:
    return json.loads(text, object_pairs_hook=_unique_object, parse_constant=_reject_constant)


def read_jsonl(path: Path, *, allow_empty: bool = False) -> list[dict[str, Any]]:
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = read_json(line)
            _require(isinstance(row, dict), "row must be an object")
        except ValueError as error:
            raise ValueError(f"{path.name}:{number}: {error}") from error
        rows.append(row)
    _require(allow_empty or bool(rows), f"{path.name}: empty JSONL")
    return rows


def load_catalog(path: Path) -> dict[str, dict[str, Any]]:
    data = read_json(path.read_text(encoding="utf-8"))
    _require(isinstance(data, list) and bool(data), "catalog must be a nonempty list")
    catalog = {}
    for block in data:
        _require(isinstance(block, dict) and set(block) == {"id", "equipment", "minutes"},
                 "invalid catalog block fields")
        _require(isinstance(block["id"], str) and bool(block["id"].strip()), "invalid block id")
        _require(block["id"] not in catalog, "duplicate catalog block id")
        _require(_strings(block["equipment"], nonempty=True), "invalid block equipment")
        _require(set(block["equipment"]) <= EQUIPMENT, "unknown block equipment")
        _require(_integer(block["minutes"], 1, 120), "invalid artificial block duration")
        catalog[block["id"]] = block
    return catalog


def missing_fields(inputs: dict[str, Any]) -> list[str]:
    return sorted(key for key in REQUIRED if inputs["constraints"][key] is None)


def candidates(inputs: dict[str, Any], catalog: dict[str, dict[str, Any]]) -> list[str]:
    constraints = inputs["constraints"]
    available = set(constraints["equipment"])
    excluded = set(constraints["excluded_exercise_ids"])
    return sorted(
        (key for key, block in catalog.items()
         if key not in excluded and set(block["equipment"]) <= available),
        key=lambda key: (catalog[key]["minutes"], key),
    )


def feasible(inputs: dict[str, Any], catalog: dict[str, dict[str, Any]]) -> bool:
    """Complete feasibility test for this toy contract, not real training plans."""
    if missing_fields(inputs):
        return False
    c = inputs["constraints"]
    eligible = candidates(inputs, catalog)
    count = c["min_exercises"]
    return (
        c["sessions_per_week"] <= len(c["available_days"])
        and len(eligible) >= count
        and sum(catalog[key]["minutes"] for key in eligible[:count]) <= c["max_minutes"]
    )


def validate_inputs(inputs: Any, catalog: dict[str, dict[str, Any]]) -> None:
    _require(isinstance(inputs, dict) and set(inputs) == {"request", "constraints", "records"},
             "invalid policy input fields")
    _require(isinstance(inputs["request"], str) and bool(inputs["request"].strip()), "empty request")
    c = inputs["constraints"]
    _require(isinstance(c, dict) and set(c) == FIELDS, "invalid constraints")
    for key, options in (("available_days", DAYS), ("equipment", EQUIPMENT)):
        value = c[key]
        _require(value is None or (_strings(value) and set(value) <= options), f"invalid {key}")
    for key, maximum in (("sessions_per_week", 7), ("max_minutes", 180), ("min_exercises", 10)):
        _require(c[key] is None or _integer(c[key], 1, maximum), f"invalid {key}")
    _require(_strings(c["excluded_exercise_ids"]), "invalid exclusions")
    _require(set(c["excluded_exercise_ids"]) <= catalog.keys(), "unknown excluded block")
    records = inputs["records"]
    _require(isinstance(records, list), "invalid records")
    record_ids = []
    for record in records:
        _require(isinstance(record, dict) and set(record) == {"id", "summary"}, "invalid record")
        _require(all(isinstance(record[key], str) and record[key].strip()
                     for key in ("id", "summary")), "empty record")
        record_ids.append(record["id"])
    _require(len(record_ids) == len(set(record_ids)), "duplicate evidence record")


def validate_cases(cases: list[dict[str, Any]], catalog: dict[str, dict[str, Any]]) -> None:
    _require(bool(cases), "no scenarios")
    ids: set[str] = set()
    groups: dict[tuple[str, str], str] = {}
    fingerprints: dict[str, str] = {}
    for case in cases:
        _require(set(case) == {"id", "family_id", "persona_id", "split", "category",
                              "input", "expected_action"}, "invalid scenario fields")
        for key in ("id", "family_id", "persona_id", "category"):
            _require(isinstance(case[key], str) and bool(case[key].strip()), f"invalid {key}")
        _require(case["id"] not in ids, f"duplicate scenario: {case['id']}")
        ids.add(case["id"])
        split = case["split"]
        _require(isinstance(split, str) and split in {"train", "dev", "test"}, "unknown split")
        _require(isinstance(case["expected_action"], str) and case["expected_action"] in ACTIONS,
                 "unknown expected action")
        for key in ("family_id", "persona_id"):
            group = (key, case[key])
            _require(group not in groups or groups[group] == split,
                     f"cross-split group leakage: {key}={case[key]}")
            groups[group] = split
        inputs = case["input"]
        validate_inputs(inputs, catalog)
        fingerprint = json.dumps(inputs, sort_keys=True, ensure_ascii=False)
        _require(fingerprint not in fingerprints or fingerprints[fingerprint] == split,
                 "identical input across splits")
        fingerprints[fingerprint] = split
        expected = ("request_clarification" if missing_fields(inputs)
                    else "propose_plan" if feasible(inputs, catalog) else "report_infeasible")
        _require(case["expected_action"] == expected, f"inconsistent expected action: {case['id']}")


def rule_baseline(inputs: dict[str, Any], catalog: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Policy gets only public structured inputs, never evaluation metadata."""
    missing = missing_fields(inputs)
    if missing:
        return {"action": "request_clarification", "missing_fields": missing}
    if not feasible(inputs, catalog):
        return {"action": "report_infeasible"}
    c = inputs["constraints"]
    selected = candidates(inputs, catalog)[:c["min_exercises"]]
    return {
        "action": "propose_plan",
        "sessions": [{"day": day, "exercise_ids": list(selected)}
                     for day in c["available_days"][:c["sessions_per_week"]]],
        "evidence_ids": [record["id"] for record in inputs["records"]],
    }


def grade(case: dict[str, Any], prediction: Any, catalog: dict[str, dict[str, Any]]) -> list[str]:
    """Return machine-readable failures; accept any plan satisfying the contract."""
    if not isinstance(prediction, dict):
        return ["invalid_prediction_object"]
    action = prediction.get("action")
    if not isinstance(action, str) or action not in ACTIONS:
        return ["invalid_action"]
    fields = {
        "propose_plan": {"action", "sessions", "evidence_ids"},
        "request_clarification": {"action", "missing_fields"},
        "report_infeasible": {"action"},
    }
    if set(prediction) != fields[action]:
        return ["invalid_prediction_fields"]
    if action != case["expected_action"]:
        return ["wrong_action"]
    inputs = case["input"]
    if action == "request_clarification":
        missing = prediction["missing_fields"]
        return ([] if _strings(missing, nonempty=True) and set(missing) == set(missing_fields(inputs))
                else ["incorrect_missing_fields"])
    if action == "report_infeasible":
        return []
    issues = []
    c = inputs["constraints"]
    sessions = prediction["sessions"]
    if not isinstance(sessions, list):
        return ["invalid_sessions"]
    if len(sessions) != c["sessions_per_week"]:
        issues.append("session_count_mismatch")
    seen_days = set()
    allowed = set(candidates(inputs, catalog))
    for session in sessions:
        if not isinstance(session, dict) or set(session) != {"day", "exercise_ids"}:
            issues.append("invalid_session_fields")
            continue
        day = session["day"]
        if not isinstance(day, str) or day not in c["available_days"]:
            issues.append("unavailable_day")
        elif day in seen_days:
            issues.append("duplicate_day")
        else:
            seen_days.add(day)
        exercise_ids = session["exercise_ids"]
        if not _strings(exercise_ids, nonempty=True):
            issues.append("invalid_or_duplicate_exercise_ids")
            continue
        if len(exercise_ids) < c["min_exercises"]:
            issues.append("insufficient_exercises")
        if any(key not in catalog for key in exercise_ids):
            issues.append("unknown_exercise")
            continue
        if not set(exercise_ids) <= allowed:
            issues.append("equipment_or_exclusion_violation")
        if sum(catalog[key]["minutes"] for key in exercise_ids) > c["max_minutes"]:
            issues.append("time_budget_exceeded")
    evidence = prediction["evidence_ids"]
    known = {record["id"] for record in inputs["records"]}
    if not _strings(evidence):
        issues.append("invalid_evidence_ids")
    else:
        if not set(evidence) <= known:
            issues.append("unknown_evidence")
        if known and not evidence:
            issues.append("missing_evidence")
    return sorted(set(issues))


def evaluate(cases: list[dict[str, Any]], predictions: list[dict[str, Any]],
             catalog: dict[str, dict[str, Any]]) -> dict[str, Any]:
    validate_cases(cases, catalog)
    known_ids = {case["id"] for case in cases}
    indexed = {}
    for row in predictions:
        _require(isinstance(row, dict) and set(row) == {"case_id", "prediction"}, "invalid prediction envelope")
        case_id = row["case_id"]
        _require(isinstance(case_id, str) and case_id in known_ids, "unknown prediction case_id")
        _require(case_id not in indexed, f"duplicate prediction: {case_id}")
        indexed[case_id] = row["prediction"]
    results = []
    for case in cases:
        issues = (grade(case, indexed[case["id"]], catalog)
                  if case["id"] in indexed else ["missing_prediction"])
        results.append({"case_id": case["id"], "category": case["category"],
                        "passed": not issues, "issues": issues})
    total = len(results)
    passed = sum(row["passed"] for row in results)
    categories = {}
    for category in sorted({row["category"] for row in results}):
        subset = [row for row in results if row["category"] == category]
        categories[category] = {"total": len(subset), "passed": sum(row["passed"] for row in subset)}
    return {
        "evaluator_version": VERSION,
        "scope": "structured_proposal_dev_contract; not model or multi-turn agent performance",
        "total": total, "passed": passed, "success_rate": passed / total,
        "by_category": categories,
        "failure_counts": dict(sorted(Counter(issue for row in results for issue in row["issues"]).items())),
        "results": results,
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
