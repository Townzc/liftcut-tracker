"""Hash-bound retrospective clarification audit; zero inference or held-out reads."""
import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path

from analyze_coverage_followup import ARMS, checked, read, sha
from controlled_recovery import ROOT
from liftcut_agent.benchmark import missing_fields, load_catalog, read_jsonl
from liftcut_agent.environment import PlanEnvironment, ScriptedUser
from liftcut_agent.interactive import digest, resolved_inputs
from liftcut_agent.workflow import replay_trace
from state_coverage import original

REPORT = ROOT / "reports/agent-shortfalls-2026-10-02.json"
PUBLICATIONS = {
    42: "qwen-state-coverage-2026-09-29",
    43: "qwen-coverage-replication-seed43-2026-10-01",
    44: "qwen-coverage-replication-seed44-2026-10-02",
}
ERRORS = ("wrong_action", "unknown_evidence", "session_count_mismatch")


def training_row(row, tokens):
    if row["split"] != "train" or (row["source_episode_id"], row["source_call_index"]) != (
            tokens["source_episode_id"], tokens["source_call_index"]):
        raise ValueError("training-only paired token row required")
    calls = row["messages"][-1]["tool_calls"]
    if len(calls) != 1 or row["assistant_target_index"] != len(row["messages"]) - 1:
        raise ValueError("single supervised final action required")
    target = calls[0]["function"]
    observed = set()
    for message in row["messages"][:-1]:
        if message["role"] == "tool":
            response = json.loads(message["content"])
            observed.update(response.get("result", {}).get("issues", []))
            details = response.get("error", {}).get("details", [])
            if isinstance(details, list):
                observed.update(details)
    return {"category": row["category"], "tool": target["name"],
            "fields": target["arguments"].get("fields", []),
            "outcome": target["arguments"].get("outcome"),
            "after_errors": sorted(observed.intersection(ERRORS)),
            "target_tokens": tokens["target_tokens"]}


def training_audit(rows, tokens):
    if len(rows) != 504 or len(tokens) != 504:
        raise ValueError("expected exact 504-decision pool")
    paired = [training_row(r, t) for r, t in zip(rows, tokens)]
    tools = {}
    for tool in sorted({r["tool"] for r in paired}):
        selected = [r for r in paired if r["tool"] == tool]
        tools[tool] = {"unique_decisions": len(selected), "two_epoch_uses": 2 * len(selected),
                       "two_epoch_target_tokens": 2 * sum(r["target_tokens"] for r in selected)}
    clarify = [r for r in paired if r["tool"] == "request_clarification"]
    return {"unique_decisions": 504, "two_epoch_uses": 1008,
        "two_epoch_target_tokens": 2 * sum(t["target_tokens"] for t in tokens), "target_tools": tools,
        "clarification_fields": dict(sorted(Counter(f for r in clarify for f in r["fields"]).items())),
        "clarification_categories": dict(sorted(Counter(r["category"] for r in clarify).items())),
        "finish_outcomes": dict(sorted(Counter(r["outcome"] for r in paired if r["tool"] == "finish").items())),
        "decisions_after_validation_error": {e: sum(e in r["after_errors"] for r in paired) for e in ERRORS},
        "unit_note": "Unique pool rows and two-epoch token exposure; not loss weight, gradient contribution or causal attribution"}


def trace_audit(scenario, catalog, trace):
    replay_trace(scenario, catalog, trace)
    env = PlanEnvironment(scenario, catalog)
    env.reset(episode_id=trace["episode_id"])
    decisions, validations, requested, interventions = [], [], [], []
    for event in trace["events"]:
        if event["actor"] == "user":
            env.user_event(event["action"])
            continue
        inputs = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"], env.snapshot()["answers"])
        missing = missing_fields(inputs)
        selected = event["action"]
        # Off-policy CPU intervention: execute only the fixture-permitted
        # clarification before the *same* failed validation. No model rerun,
        # invented answer, plan edit or claim that the model would recover.
        if (missing and selected["tool"] == "validate_plan" and env.snapshot()["proposal"] is None
                and event["observation"]["ok"] and not event["observation"]["result"]["valid"]):
            counterfactual = deepcopy(env)
            before = digest(counterfactual.snapshot())
            clarification = counterfactual.step({"tool": "request_clarification", "arguments": {"fields": missing}})
            user_events = ScriptedUser(scenario).advance(counterfactual)
            after_inputs = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"], counterfactual.snapshot()["answers"])
            after = counterfactual.step(selected)
            interventions.append({"at_event": event["index"], "original_action_sha256": digest(selected),
                "before_state_sha256": before, "clarification_response": clarification,
                "real_fixture_user_events": user_events, "remaining_missing_fields": missing_fields(after_inputs),
                "same_validation_after_clarification": after, "after_state_sha256": digest(counterfactual.snapshot())})
        obs = env.step(selected)
        tool, args = selected["tool"], selected["arguments"]
        if tool == "request_clarification":
            requested.append({"fields": args["fields"], "accepted": obs["ok"]})
        if tool in {"search_exercises", "validate_plan", "propose_plan", "finish"}:
            decisions.append({"index": event["index"], "tool": tool, "missing_fields_before": missing,
                "selected_equipment": args.get("equipment"), "effective_equipment": inputs["constraints"]["equipment"],
                "outcome": args.get("outcome")})
        if tool == "validate_plan" and obs["ok"] and not obs["result"]["valid"]:
            validations.append({"index": event["index"], "issues": obs["result"]["issues"]})
    premature = [d for d in decisions if d["missing_fields_before"] and d["tool"] in {"search_exercises", "validate_plan", "propose_plan"}]
    return {"scenario_id": scenario["id"], "category": scenario["category"],
        "passed": trace["score"]["passed"], "outcome": trace["score"]["outcome"],
        "requested_clarifications": requested, "decisions": decisions,
        "planning_with_missing_fields": bool(premature), "invalid_validations": validations,
        "cpu_clarification_interventions": interventions,
        "tool_errors": trace["score"]["tool_errors"]}


def analyze(prepared):
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    dev = {r["id"]: r for r in original("dev")}
    preparation = ROOT / "reports/state-coverage-preparation-v1.json"
    inventory = read(preparation)["files"]
    sources = {str(preparation.relative_to(ROOT)): sha(preparation),
               **{name: sha(ROOT / name) for name in ("benchmark/catalog.json", "benchmark/recovery-v2/dev.jsonl")}}
    training = {}
    for arm in ARMS:
        paths = [checked(prepared / name, inventory[name]) for name in (
            f"decisions/{arm}/decisions.jsonl", f"tokens/{arm}/tokens.jsonl")]
        training[arm] = training_audit(*(read_jsonl(p) for p in paths))
        sources.update({f"prepared/{p.relative_to(prepared).as_posix()}": sha(p) for p in paths})
    seeds = {}
    for seed, folder in PUBLICATIONS.items():
        published = ROOT / "reports" / folder
        manifest = published / "publication-manifest.json"
        inv = read(manifest)["files"]
        sources[str(manifest.relative_to(ROOT))] = sha(manifest)
        arms = {}
        for arm in ARMS:
            training_name = f"training/{arm}/report.json"
            training_path = checked(published / training_name, inv[training_name])
            sources[str(training_path.relative_to(ROOT))] = sha(training_path)
            processed = read(training_path)["processed"]
            if (processed["decisions"] != training[arm]["two_epoch_uses"] or
                    processed["supervised_tokens"] != training[arm]["two_epoch_target_tokens"]):
                raise ValueError("recorded training exposure differs from the two-epoch pool audit")
            name = f"evaluation/{arm}/normal/episodes.jsonl"
            path = checked(published / name, inv[name])
            sources[str(path.relative_to(ROOT))] = sha(path)
            episodes = read_jsonl(path)
            if len(episodes) != 12 or {e["scenario_id"] for e in episodes} != set(dev):
                raise ValueError("normal development denominator mismatch")
            cases = [trace_audit(dev[e["scenario_id"]], catalog, e["trace"]) for e in episodes]
            arms[arm] = {"cases": cases, "passed": sum(c["passed"] for c in cases),
                "planning_with_missing_fields": sum(c["planning_with_missing_fields"] for c in cases),
                "validation_error_occurrences": dict(sorted(Counter(i for c in cases for v in c["invalid_validations"] for i in v["issues"]).items()))}
        seeds[str(seed)] = arms
    interventions = [i for arms in seeds.values() for arm in arms.values() for c in arm["cases"] for i in c["cpu_clarification_interventions"]]
    return {"version": "agent-shortfalls-v1", "scope": "Retrospective reused-development evidence, not independent generalization",
        "source_sha256": sources, "training": training, "seeds": seeds,
        "normal_traces_replayed": 144, "new_model_calls": 0, "reserved_test_reads": 0,
        "cpu_intervention_summary": {"validations": len(interventions),
            "same_plan_now_valid": sum(i["same_validation_after_clarification"]["result"]["valid"] for i in interventions),
            "no_user_answer": sum(not i["real_fixture_user_events"] for i in interventions),
            "answered_but_plan_still_invalid": sum(bool(i["real_fixture_user_events"]) and not i["same_validation_after_clarification"]["result"]["valid"] for i in interventions),
            "interpretation": "Environment intervention with unchanged emitted plan; not autonomous model recovery"},
        "limits": ["Exposure counts do not identify the cause of model behavior",
                   "Seed changes initialization and shuffle together; no isolated shuffle explanation",
                   "Memory value match is observable; attention and reasoning mechanism are not"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared-dir", required=True, type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = analyze(args.prepared_dir)
    if args.check:
        if result != read(REPORT):
            raise ValueError("shortfall audit differs from published report")
    else:
        with REPORT.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"traces_replayed": result["normal_traces_replayed"], "new_model_calls": 0,
                      "training": result["training"]["s0"]}, ensure_ascii=False))
