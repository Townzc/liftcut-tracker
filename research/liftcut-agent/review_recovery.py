"""Reproduce the recovery pilot's coverage and failure review, entirely offline.

Counterfactual grading changes the grader input only. It is NOT a model rerun or
evidence that a model would recover after receiving the missing information.
Historical fixtures, traces, scores and training artifacts are never rewritten.
"""

import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path

from audit_identifier_probe import audit_probe
from audit_recovery import ROOT, audit, read
from blind_recovery_ids import PROBE
from liftcut_agent.benchmark import grade, load_catalog, missing_fields, read_jsonl, rule_baseline
from liftcut_agent.environment import PlanEnvironment
from liftcut_agent.interactive import digest, proposal_case, resolved_inputs
from prepare_recovery import REVIEWED, schedules
from recovery_dataset import DATA, load_frozen
from server_workspace import dump_new, sha256

RUN = ROOT / "reports/qwen-recovery-pilot-2026-09-28"
REPORT = ROOT / "reports/recovery-forensics-2026-09-29.json"


def target(row):
    return row["messages"][-1]["tool_calls"][0]["function"]


def training_coverage(prepared):
    schedule, tokens, decisions = schedules(prepared)
    rows = decisions["clean"]
    action_counts, target_counts, clarification_fields = Counter(), Counter(), Counter()
    for row, encoded in zip(rows, tokens["clean"]):
        action = target(row)
        action_counts[action["name"]] += 1
        target_counts[action["name"]] += encoded["target_tokens"]
        if action["name"] == "request_clarification":
            clarification_fields.update(action["arguments"]["fields"])
    changed, immediate = Counter(), Counter()
    for item in schedule["mixed"]:
        index = item["index"]
        if (item["variant"] != "recovery"
                or tokens["clean"][index]["input_ids"] == tokens["recovery"][index]["input_ids"]):
            continue
        row = decisions["recovery"][index]
        key = row["category"] + "/" + target(row)["name"]
        changed[key] += 1
        last = row["messages"][-2]
        if last["role"] == "tool" and not json.loads(last["content"])["ok"]:
            immediate[key] += 1
    episodes = read_jsonl(prepared / "decisions/recovery/episodes.jsonl")
    rejected = Counter()
    invalid = 0
    for episode in episodes:
        for event in episode["trace"]["events"]:
            if event["actor"] != "agent":
                continue
            response = event["observation"]
            if not response["ok"]:
                rejected[response["error"]["code"]] += 1
            elif event["action"]["tool"] == "validate_plan" and not response["result"]["valid"]:
                invalid += 1
    return {"unique_decisions": len(rows), "unique_target_tokens": sum(target_counts.values()),
            "decisions_by_action": dict(sorted(action_counts.items())),
            "target_tokens_by_action": dict(sorted(target_counts.items())),
            "clarification_fields": dict(clarification_fields),
            "scripted_rejected_actions": dict(rejected), "scripted_invalid_validations": invalid,
            "mixed_scheduled_decisions": len(schedule["mixed"]),
            "mixed_changed_histories": sum(changed.values()),
            "mixed_immediate_post_error_decisions": sum(immediate.values()),
            "changed_histories_by_category_action": dict(sorted(changed.items())),
            "immediate_post_error_by_category_action": dict(sorted(immediate.items()))}


def fixture_coverage(cases):
    train = [row for row in cases if row["split"] == "train"]
    missing = [row for row in train if missing_fields(resolved_inputs(
        row["input"], row["memories"], row["as_of"]))]
    memory = [row for row in train if row["memories"]]
    return {"train_cases": len(train), "missing_constraint_cases": len(missing),
            "missing_cases_with_memory_update": sum(bool(row["memories"]) for row in missing),
            "missing_cases_without_answer": sum(not row["clarification_answers"] for row in missing),
            "memory_cases": len(memory),
            "memory_cases_with_highest_revision_last": sum(
                row["memories"][-1]["revision"] == max(m["revision"] for m in row["memories"]) for row in memory),
            "unconfirmed_memory_records": sum(not m["confirmed"] for row in train for m in row["memories"]),
            "expired_memory_records": sum(bool(m["expires_on"] and m["expires_on"] <= row["as_of"])
                                          for row in train for m in row["memories"]),
            "after_preview_update_cases": sum(bool(row["after_preview_update"]) for row in train),
            "fixture_faults_by_split": {split: sum(len(row["faults"]) for row in cases if row["split"] == split)
                                        for split in ("train", "dev", "test")}}


def partial_diagnostic(scenario, episode, catalog):
    events = [event for event in episode["trace"]["events"] if event["actor"] == "agent"]
    validations = [event for event in events if event["action"]["tool"] == "validate_plan"]
    if not validations:
        return {"scenario_id": scenario["id"], "first_validation": None}
    first = validations[0]
    before = [event for event in events if event["index"] < first["index"]]
    # Restrict the counterfactual to the observed missed-clarification histories.
    if any(e["action"]["tool"] == "request_clarification" and e["observation"]["ok"] for e in before):
        raise ValueError("counterfactual requires no prior accepted clarification")
    if any(e["actor"] == "user" and e["index"] < first["index"] for e in episode["trace"]["events"]):
        raise ValueError("counterfactual requires unchanged pre-validation context")
    actual_inputs = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"])
    plan = first["action"]["arguments"]["plan"]
    observed = first["observation"]["result"]["issues"]
    if grade(proposal_case(actual_inputs, catalog), plan, catalog) != observed:
        raise ValueError("first validation does not match the original contract")
    supplied = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"],
                               scenario["clarification_answers"])
    return {"scenario_id": scenario["id"], "first_validation": first["index"],
            "effective_equipment": actual_inputs["constraints"]["equipment"],
            "searched_equipment": [e["action"]["arguments"]["equipment"] for e in before
                                   if e["action"]["tool"] == "search_exercises"],
            "missing_fields_at_first_validation": missing_fields(actual_inputs),
            "original_issues": observed,
            "same_plan_issues_if_fixture_answer_supplied_to_grader_only": grade(
                proposal_case(supplied, catalog), plan, catalog)}


def evaluation_summary(episodes, generations, scenarios, catalog):
    categories, diagnoses = {}, []
    for ep in episodes:
        scenario = scenarios[ep["scenario_id"]]
        count = categories.setdefault(scenario["category"], Counter())
        count.update({"cases": 1, "passed": int(ep["trace"]["score"]["passed"]), "requests": len(ep["calls"])})
        invalid_plans = Counter()
        for event in ep["trace"]["events"]:
            if event["actor"] != "agent":
                continue
            action, response = event["action"], event["observation"]
            if action["tool"] == "request_clarification":
                count["clarification_requests"] += 1
                count["accepted_clarification_requests"] += int(response["ok"])
            if action["tool"] == "validate_plan" and response["ok"] and not response["result"]["valid"]:
                count["invalid_validations"] += 1
                fingerprint = digest(action["arguments"]["plan"])
                count["repeated_identical_invalid_plan"] += int(invalid_plans[fingerprint] > 0)
                invalid_plans[fingerprint] += 1
        if scenario["category"] == "partial_clarification":
            diagnoses.append(partial_diagnostic(scenario, ep, catalog))
    return {"recorded_generation_seconds": sum(g["elapsed_seconds"] for g in generations),
            "by_category": {key: dict(value) for key, value in sorted(categories.items())},
            "partial_clarification_diagnostics": diagnoses}


def contract_probes(cases, catalog):
    """Executable limitations of existing v0.1 grading; not fixes or model scores."""
    case = next(row for row in cases if row["category"] == "memory_supersession")
    inputs = resolved_inputs(case["input"], case["memories"], case["as_of"])
    plan = rule_baseline(inputs, catalog)
    plan["evidence_ids"] = [case["input"]["records"][0]["id"]]
    validation = PlanEnvironment(case, catalog).step({"tool": "validate_plan", "arguments": {"plan": plan}})
    approved = deepcopy(next(row for row in cases if row["category"] == "approved"))
    pending = deepcopy(approved)
    pending.update(approval_behavior="none", expected_terminal="awaiting_user")
    a, b = PlanEnvironment(approved, catalog), PlanEnvironment(pending, catalog)
    a.reset(episode_id=digest(approved)[:32])
    b.reset(episode_id=digest(pending)[:32])
    initial_equal = a.initial_observation() == b.initial_observation()
    reads_equal = all(a.step({"tool": tool, "arguments": {}}) == b.step({"tool": tool, "arguments": {}})
                      for tool in ("get_context", "get_memories"))
    plan = rule_baseline(resolved_inputs(approved["input"], approved["memories"], approved["as_of"]), catalog)
    proposals = [env.step({"tool": "propose_plan", "arguments": {"plan": plan}})["result"]["proposal"]["id"]
                 for env in (a, b)]
    return {"selected_memory_evidence_omitted_but_plan_valid": validation["result"]["valid"],
            "hidden_approval_change_preserves_initial_and_reads": initial_equal and reads_equal,
            "hidden_approval_change_alters_scenario_derived_proposal_id": proposals[0] != proposals[1],
            "scope": "Harness-only counterexamples. Hash dependence is not proof a model decodes hidden outcomes."}


def build_review(run, prepared):
    # Fail closed on altered/missing evidence before deriving new interpretations.
    audit(run, prepared, verify_weights=False)
    audit_probe(run)
    cases = load_frozen()
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    suites = {}
    for suite, directory in (("evaluation", DATA), ("identifier-probe", PROBE)):
        known = {row["id"]: row for row in load_frozen(directory)}
        suites[suite] = {}
        for arm in ("unadapted", "clean", "mixed"):
            folder = run / suite / arm
            suites[suite][arm] = evaluation_summary(read_jsonl(folder / "episodes.jsonl"),
                read_jsonl(folder / "generations.jsonl"), known, catalog)
    sources = [REVIEWED, DATA / "manifest.json", PROBE / "manifest.json"]
    for suite in ("evaluation", "identifier-probe"):
        for arm in ("unadapted", "clean", "mixed"):
            sources.extend(run / suite / arm / name for name in ("episodes.jsonl", "generations.jsonl"))
    replayed = sum(sum(count["cases"] for count in arm["by_category"].values())
                   for suite in suites.values() for arm in suite.values())
    return {"scope": "Offline forensic review of existing contaminated/reused-task diagnostics; no new model calls",
            "verification": {"episodes_replayed": replayed, "actual_adapter_weights_verified_in_this_review": False},
            "sources_sha256": {path.relative_to(ROOT).as_posix(): sha256(path) for path in sources},
            "fixture_coverage": fixture_coverage(cases), "training_coverage": training_coverage(prepared),
            "evaluation": suites, "contract_probes": contract_probes(cases, catalog),
            "counterfactual_scope": "Grade the recorded first plan after supplying the fixture's missing answer. "
                                    "Never change the actual episode score; never infer an unobserved model response."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared-dir", required=True, type=Path)
    parser.add_argument("--run-dir", default=RUN, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = build_review(args.run_dir, args.prepared_dir)
    if args.check and result != read(REPORT):
        raise ValueError("forensic review differs from the published result")
    if args.output:
        dump_new(args.output, result)
    print(json.dumps({"verification": result["verification"], "fixture_coverage": result["fixture_coverage"],
                      "contract_probes": result["contract_probes"]}, indent=2))
