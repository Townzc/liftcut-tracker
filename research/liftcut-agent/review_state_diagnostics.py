"""Descriptive, reproducible review; never changes the frozen first-decision score."""
import argparse
from collections import Counter
from pathlib import Path

from audit_state_diagnostics import audit
from state_diagnostics import ROOT, REREADS, business_state, effective_inputs, load_prepared
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import encode
from liftcut_agent.model_runner import percentile
from server_workspace import dump_new


def describe(case, episode):
    boundary = len(case["prefix"]["trace"]["events"])
    events = [e for e in episode["trace"]["events"][boundary:] if e["actor"] == "agent"]
    first = next((e for e in events if e["action"]["tool"] not in REREADS), None)
    if (first["index"] if first else None) != episode["decision"]["first_event_index"]:
        raise ValueError("descriptive decision boundary differs from frozen scorer")
    calls = episode["calls"][episode["scripted_prefix_calls"]:]
    eligible = [m for m in case["scenario"]["memories"] if m["confirmed"]
                and (m["expires_on"] is None or m["expires_on"] > case["scenario"]["as_of"])]
    current = max(eligible, key=lambda m: m["revision"]) if eligible else None
    matches = []
    for identity in episode["decision"]["source_matches"]:
        if identity == "raw_context":
            matches.append({"id": identity, "role": "raw_context"})
            continue
        memory = next(m for m in case["scenario"]["memories"] if m["id"] == identity)
        role = ("unconfirmed_memory" if not memory["confirmed"] else
                "expired_memory" if memory["expires_on"] and memory["expires_on"] <= case["scenario"]["as_of"] else
                "current_confirmed_memory" if memory == current else "older_confirmed_memory")
        matches.append({**memory, "role": role})
    return {"case_id": case["id"], "panel": case["panel"], "factors": case["factors"],
        "correct": episode["decision"]["correct"], "policy_failure": episode["policy_failure"],
        "stop_reason": episode["stop_reason"],
        "business_state_digest": digest(business_state(case["prefix"]["snapshot"])),
        "expected_reference": case["expected"]["reference_action"],
        "first_decision": first["action"] if first else None,
        "first_observation": first["observation"] if first else None,
        "raw_context_equipment": case["scenario"]["input"]["constraints"]["equipment"],
        "effective_equipment": effective_inputs(case)["constraints"]["equipment"],
        "observed_value_matches": matches,
        "rereads_before_decision": sum(e["action"]["tool"] in REREADS and
            (first is None or e["index"] < first["index"]) for e in events),
        "autonomous_actions": [e["action"] for e in events],
        "additional_task_decisions": [e["action"] for e in events if first is not None and e["index"] > first["index"]
                                      and e["action"]["tool"] not in REREADS],
        "autonomous_errors": dict(Counter(e["observation"]["error"]["code"] for e in events if not e["observation"]["ok"])),
        "requests": len(calls), "generation_seconds": sum(c["response"]["elapsed_seconds"] for c in calls)}


def review(run, prepared):
    audited, cases = audit(run, prepared), load_prepared(prepared)
    rows, efficiency, contrasts = {}, {}, {}
    for arm in ("clean", "mixed"):
        episodes = read_jsonl(run / "evaluation" / arm / "episodes.jsonl")
        rows[arm] = [describe(c, e) for c, e in zip(cases, episodes)]
        calls = [c for e in episodes for c in e["calls"][e["scripted_prefix_calls"]:]]
        latency = [c["response"]["elapsed_seconds"] for c in calls]
        efficiency[arm] = {"requests": len(calls),
            "actual_model_generations": audited["arms"][arm]["actual_model_generations"],
            "local_context_guards": audited["arms"][arm]["local_context_guards"],
            "prompt_tokens": sum(c["usage"]["prompt_tokens"] for c in calls if c["usage"] is not None),
            "completion_tokens": sum(c["usage"]["completion_tokens"] for c in calls if c["usage"] is not None),
            "usage_complete": all(c["usage"] is not None for c in calls),
            "generation_seconds": sum(latency), "latency_p50_seconds": percentile(latency, .5),
            "latency_p95_seconds": percentile(latency, .95)}
        contrasts[arm] = []
        for status in ("pending", "declined", "revoked"):
            group = [r for r in rows[arm] if r["factors"].get("status") == status]
            if len({r["business_state_digest"] for r in group}) != 1:
                raise ValueError("consent contrast has unequal business states")
            contrasts[arm].append({"status": status, "business_state_equal": True,
                "histories": {r["factors"]["history"]: {k: r[k] for k in
                    ("correct", "first_decision", "policy_failure", "requests")} for r in group},
                "different_first_decisions": len({digest(r["first_decision"]) for r in group}) > 1})
    paired_cases = {panel: {"clean_only": [], "mixed_only": [], "both_correct": [], "both_wrong": []}
                    for panel in ("consent", "memory")}
    for c, r in zip(rows["clean"], rows["mixed"]):
        key = "both_correct" if c["correct"] and r["correct"] else "clean_only" if c["correct"] else "mixed_only" if r["correct"] else "both_wrong"
        paired_cases[c["panel"]][key].append(c["case_id"])
    return {"scope": "Descriptive first-decision DEVELOPMENT review; no additional model calls or score changes",
        "states_replayed": audited["total_states_replayed"], "test_episodes": 0,
        "panels": {arm: data["panels"] for arm, data in audited["arms"].items()},
        "paired_case_ids": paired_cases, "consent_history_contrasts": contrasts, "efficiency": efficiency,
        "cases": rows,
        "interpretation_limit": "Value matches do not establish internal causal provenance; correlated states are not independent test tasks"}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run-dir", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = review(args.run_dir, args.prepared_dir)
    if args.output:
        dump_new(args.output, result)
    print(encode({"panels": result["panels"], "paired_case_ids": result["paired_case_ids"]}))
