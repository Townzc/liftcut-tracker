"""CPU-only descriptive review of audited controlled-recovery artifacts."""
import argparse
from collections import Counter
import json
from pathlib import Path

from audit_controlled import audit
from controlled_rollout import evaluation_cases
from liftcut_agent.benchmark import missing_fields, read_jsonl
from liftcut_agent.interactive import resolved_inputs
from liftcut_agent.model_runner import percentile
from server_workspace import dump_new


def describe_episode(scenario, prefix, episode):
    count = len(prefix["calls"]) if prefix else 0
    events = [e for e in episode["trace"]["events"] if e["actor"] == "agent"][count:]
    effective = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"])
    missing = set(missing_fields(effective))
    accepted_fields, fields_before_plan, first_plan, first_question = set(), set(), None, None
    invalid = []
    for i, event in enumerate(events):
        action, obs = event["action"], event["observation"]
        if action["tool"] in {"validate_plan", "propose_plan", "apply_plan"} and first_plan is None:
            first_plan = i
        if action["tool"] == "request_clarification" and obs["ok"]:
            accepted_fields.update(action["arguments"]["fields"])
            if first_plan is None:
                fields_before_plan.update(action["arguments"]["fields"])
            if first_question is None:
                first_question = i
        if action["tool"] == "validate_plan" and obs["ok"] and not obs["result"]["valid"]:
            invalid.append({"agent_event_index": i, "arguments": action["arguments"], "result": obs["result"]})
    return {"scenario_id": scenario["id"], "category": scenario["category"],
        "panel": "continuation" if prefix else "normal", "missing_fields_at_start": sorted(missing),
        "effective_equipment": effective["constraints"].get("equipment"),
        "first_autonomous_action": events[0]["action"] if events else None,
        "accepted_clarification_fields": sorted(accepted_fields),
        "clarified_before_planning": (bool(missing) and missing <= fields_before_plan and first_question is not None
                                      and (first_plan is None or first_question < first_plan)),
        "autonomous_action_sequence": [e["action"]["tool"] for e in events],
        "invalid_validations": invalid, "policy_failure": episode["policy_failure"],
        "score": episode["trace"]["score"]}


def review(root, prepared):
    audited = audit(root, prepared, verify_weights=False)
    scenarios, prefixes = evaluation_cases(prepared)
    descriptions, efficiency, failures = {}, {}, {}
    for arm in ("unadapted", "clean", "mixed"):
        episodes = read_jsonl(root / "evaluation" / arm / "episodes.jsonl")
        rows = [describe_episode(s, prefixes.get(s["id"]), e) for s, e in zip(scenarios, episodes)]
        descriptions[arm] = rows
        efficiency[arm], failures[arm] = {}, {}
        for panel in ("normal", "continuation"):
            selected = [e for e, row in zip(episodes, rows) if row["panel"] == panel]
            calls = [c for e in selected for c in e["calls"][len(prefixes[e["scenario_id"]]["calls"])
                     if e["scenario_id"] in prefixes else 0:]]
            latency = [c["response"]["elapsed_seconds"] for c in calls]
            efficiency[arm][panel] = {"model_calls": len(calls),
                "latency_p50_seconds": percentile(latency, .5), "latency_p95_seconds": percentile(latency, .95),
                "generation_seconds": sum(latency),
                "policy_failures": dict(Counter(e["policy_failure"] for e in selected if e["policy_failure"]))}
            failures[arm][panel] = [r["scenario_id"] for r in audited["arms"][arm]["results"]
                                    if r["panel"] == panel and not r["passed"]]
    normal = {r["category"]: r for r in descriptions["clean"] if r["panel"] == "normal"}
    single = ("missing_time", "missing_equipment", "missing_days")
    clarification_failures = [name for name in single if not normal[name]["clarified_before_planning"]]
    clean, mixed = audited["arms"]["clean"], audited["arms"]["mixed"]
    paired = audited["paired_clean_mixed"]
    recovery_changes = paired["continuation"]["changes"]
    winning_ids = {x["scenario_id"] for x in recovery_changes if x["mixed"]}
    winning_types = sorted({r["error_kind"] for r in mixed["results"] if r["scenario_id"] in winning_ids})
    pending_regression = any(a["category"] == "pending" and a["passed"] and not b["passed"]
                             for a, b in zip(clean["results"], mixed["results"]))
    new_blocked = [a["scenario_id"] for a, b in zip(clean["results"], mixed["results"])
                   if b["autonomous_blocked_writes"] > a["autonomous_blocked_writes"]]
    recovery_net = mixed["panels"]["continuation"]["passed"] - clean["panels"]["continuation"]["passed"]
    normal_net = mixed["panels"]["normal"]["passed"] - clean["panels"]["normal"]["passed"]
    return {"scope": "Descriptive DEVELOPMENT review; shared-author single bundle/seed; no additional model calls",
        "episodes_replayed": audited["episodes_replayed"], "test_episodes": 0,
        "panels": {a: v["panels"] for a, v in audited["arms"].items()}, "paired": paired,
        "efficiency": efficiency, "failures": failures, "diagnostics": descriptions,
        "preregistered_gate_inputs": {"clean_single_field_clarification_failures": clarification_failures,
            "pause_recovery_expansion_for_clarification": len(clarification_failures) >= 2,
            "recovery_success_net": recovery_net, "normal_success_net": normal_net,
            "recovery_winning_error_types": winning_types, "pending_regression": pending_regression,
            "new_autonomous_blocked_write_cases": new_blocked,
            "recovery_signal_threshold_met": recovery_net >= 2 and len(winning_types) >= 2
                and normal_net >= -1 and not pending_regression and not new_blocked},
        "gate_note": "These are descriptive inputs to the preregistered review, not a substitute for raw-format, provenance and authorization checks"}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run-dir", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = review(args.run_dir, args.prepared_dir)
    if args.output:
        dump_new(args.output, result)
    print(json.dumps({"panels": result["panels"], "gates": result["preregistered_gate_inputs"]}, indent=2))
