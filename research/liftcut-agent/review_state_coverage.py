"""Reproduce descriptive coverage results without changing any frozen score or gate."""
import argparse
from collections import Counter
import math
from pathlib import Path

from audit_state_coverage import audit
from gpu_state_diagnostics import read
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.model_policy import encode
from liftcut_agent.model_runner import percentile
from review_state_diagnostics import describe
from server_workspace import dump_new
from state_coverage import ARMS
from state_diagnostics import load_prepared


def training_statistics(log, report):
    """Losses are token-weighted within each observed epoch, not accuracy estimates."""
    increments, previous = [], 0
    for row in log:
        count = row["supervised_tokens"] - previous
        if count <= 0:
            raise ValueError("non-increasing training target count")
        increments.append(count)
        previous = row["supervised_tokens"]
    if len(log) != 126 or previous != 41788:
        raise ValueError("wrong coverage training denominator")
    epoch_losses = []
    for start in (0, 63):
        stop = start + 63
        epoch_losses.append(sum(log[i]["loss"] * increments[i] for i in range(start, stop)) /
                            sum(increments[start:stop]))
    # The historical field name says including_checkpoints, but the trainer stops
    # this timer BEFORE adapter saving/reload. Preserve the source field and label
    # this derived duration according to the code's actual timer boundary.
    seconds = report["training_seconds_including_checkpoints"]
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("optimization duration must be positive and finite")
    return {"optimizer_steps": len(log), "sample_uses": report["processed"]["decisions"],
        "supervised_tokens": previous, "input_tokens_including_targets": report["processed"]["input_tokens"],
        "optimization_loop_seconds": seconds,
        "input_tokens_per_optimization_second": report["processed"]["input_tokens"] / seconds,
        "target_weighted_epoch_losses": epoch_losses,
        "peak_allocated_gib": report["peak_allocated_bytes"] / 2**30,
        "peak_reserved_gib": report["peak_reserved_bytes"] / 2**30,
        "reload_max_logit_difference": report["reload_max_logit_difference"],
        "timer_limit": "Excludes model load, longest-example probe, final save and reload; loss is not task success"}


def efficiency(episodes, *, diagnostic):
    calls = [c for e in episodes for c in e["calls"][e["scripted_prefix_calls"] if diagnostic else 0:]]
    latency = [c["response"]["elapsed_seconds"] for c in calls]
    return {"requests": len(calls), "usage_complete": all(c["usage"] is not None for c in calls),
        "prompt_tokens": sum(c["usage"]["prompt_tokens"] for c in calls if c["usage"] is not None),
        "completion_tokens": sum(c["usage"]["completion_tokens"] for c in calls if c["usage"] is not None),
        "generation_seconds": sum(latency), "latency_p50_seconds": percentile(latency, .5),
        "latency_p95_seconds": percentile(latency, .95)}


def describe_normal(episode):
    """Report observed validation feedback without inventing an internal model cause."""
    events = [e for e in episode["trace"]["events"] if e["actor"] == "agent"]
    validations = []
    for event in events:
        if event["action"]["tool"] != "validate_plan":
            continue
        observed = event["observation"]
        if observed["ok"] and observed["result"]["valid"] is False:
            validations.append({"event_index": event["index"], "issues": observed["result"]["issues"],
                "submitted_evidence_ids": event["action"]["arguments"]["plan"].get("evidence_ids", [])})
    return {"scenario_id": episode["scenario_id"],
        "passed": episode["trace"]["score"]["passed"] and episode["policy_failure"] is None,
        "outcome": episode["trace"]["score"]["outcome"], "policy_failure": episode["policy_failure"],
        "action_sequence": [e["action"]["tool"] for e in events],
        "search_equipment": [e["action"]["arguments"].get("equipment") for e in events if e["action"]["tool"] == "search_exercises"],
        "invalid_validations": validations,
        "finish_after_invalid_validation": bool(validations and events[-1]["action"]["tool"] == "finish"
            and events[-1]["index"] > validations[-1]["event_index"]),
        "interpretation": "Validation feedback and subsequent actions are observations, not proof of an internal reasoning mechanism"}


def review(run, prepared, diagnostic, *, audited=None):
    audited = audit(run, prepared, diagnostic, verify_weights=False) if audited is None else audited
    cases, arms = load_prepared(diagnostic), {}
    for arm in ARMS:
        directory = run / "evaluation" / arm
        normal = read_jsonl(directory / "normal/episodes.jsonl")
        probes = read_jsonl(directory / "diagnostic/episodes.jsonl")
        rows = [describe(c, e) for c, e in zip(cases, probes)]
        memory = [r for r in rows if r["panel"] == "memory" and r["factors"]["position"] is not None]
        controls = [r for r in rows if r["panel"] == "memory" and r["factors"]["position"] is None]
        reads = [r for r in rows if r["factors"].get("history") == "read"]
        counts = {"normal": {"correct": audited["arms"][arm]["normal"]["passed"], "total": 12},
            "read_consent": {"correct": sum(r["correct"] for r in reads), "total": 3},
            "main_memory": {"correct": sum(r["correct"] for r in memory), "total": 8},
            "memory_control": {"correct": sum(r["correct"] for r in controls), "total": 1},
            "all_consent": {"correct": audited["arms"][arm]["diagnostic"]["panels"]["consent"]["correct"], "total": 10}}
        contrasts = []
        for status in ("pending", "declined", "revoked"):
            group = [r for r in rows if r["factors"].get("status") == status]
            if len({r["business_state_digest"] for r in group}) != 1:
                raise ValueError("consent history comparison has unequal business states")
            contrasts.append({"status": status, "business_state_equal": True,
                "histories": {r["factors"]["history"]: {k: r[k] for k in
                    ("correct", "first_decision", "policy_failure", "requests")} for r in group}})
        training = run / "training" / arm
        arms[arm] = {"counts": counts, "diagnostic_cases": rows,
            "consent_history_contrasts": contrasts,
            "main_memory_value_match_roles": dict(Counter(m["role"] for r in memory for m in r["observed_value_matches"])),
            "normal_failures": [r for r in audited["arms"][arm]["normal"]["results"] if not r["passed"]],
            "normal_cases": [describe_normal(e) for e in normal],
            "efficiency": {"normal": efficiency(normal, diagnostic=False), "diagnostic": efficiency(probes, diagnostic=True)},
            "actual_model_generations": sum(p["actual_model_generations"] for p in audited["arms"][arm].values()),
            "local_context_guards": sum(p["local_context_guards"] for p in audited["arms"][arm].values()),
            "training": training_statistics(read_jsonl(training / "training.jsonl"), read(training / "report.json"))}
    return {"scope": "Descriptive single-seed reused-development review; frozen scores and gates unchanged",
        "episodes_replayed": audited["episodes_replayed"], "test_episodes": 0, "arms": arms,
        "comparisons": audited["comparisons"],
        "interpretation_limit": "Value matches are not internal causal attribution; correlated probes are not independent test tasks; no significance claim"}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = review(args.run_dir, args.prepared_dir, args.diagnostic_dir)
    if args.output:
        dump_new(args.output, result)
    print(encode({"counts": {a: r["counts"] for a, r in result["arms"].items()}, "comparisons": result["comparisons"]}))
