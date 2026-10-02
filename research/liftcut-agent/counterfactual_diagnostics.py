"""D2: eighty frozen development states, first-response and continuation panels.

All prefixes execute real tools. Labels, reference actions and proofs are harness
metadata only. This module performs no model loading, network access or training.
"""
import argparse
from collections import Counter
from copy import deepcopy
from dataclasses import replace
import json
from pathlib import Path

from controlled_recovery import ROOT, config, opaque
from liftcut_agent.benchmark import candidates, feasible, grade, load_catalog, read_jsonl, rule_baseline
from liftcut_agent.interactive import digest, proposal_case
from liftcut_agent.model_policy import PolicyFailure, RunBudget
from liftcut_agent.model_runner import RecordedTransport
from liftcut_agent.workflow import FixedWorkflow, replay_trace
from recovery_dataset import write_rows
from server_workspace import dump_new, sha256
from state_coverage import original
from state_diagnostics import (action, bootstrap, build_prefix, business_state, effective_inputs,
    expected_rule, first_score, reply_for, REREADS)

VERSION = "counterfactual-diagnostics-v2"
PANELS = {"memory": 48, "identity": 12, "consent": 12, "repair": 4, "infeasible": 4}
VALUES = ("bodyweight", "dumbbell", "barbell", "machine")
MAX_REQUESTS_PER_ARM = 72 + 8 * 8


def case_from(scenario, panel, factors, actions, catalog):
    return {"id": scenario["id"], "panel": panel, "factors": factors, "scenario": scenario,
            "prefix": build_prefix(scenario, catalog, actions)}


def projection(case):
    """Semantic invariants for ID/order changes; raw state hashes remain separate."""
    state = case["prefix"]["snapshot"]
    return {"constraints": effective_inputs(case)["constraints"], "answers": state["answers"],
            "writes": state["writes"], "outcome": state["outcome"], "done": state["done"],
            "has_proposal": state["proposal"] is not None, "has_approval": state["approval"] is not None,
            "user_decision": state["user_decision"], "pending_fields": state["pending_fields"]}


def fixtures(catalog):
    dev = {r["category"]: r for r in original("dev")}
    cases = []
    for rotation in range(4):
        raw, old_value, valid_value, invalid_value = VALUES[rotation:] + VALUES[:rotation]
        for clarification in (False, True):
            for position in ("first", "middle", "last"):
                for invalid in ("unconfirmed", "expired"):
                    scenario = deepcopy(dev["memory_missing_time" if clarification else "memory"])
                    scenario["id"] = f"d2-memory-v{rotation}-c{int(clarification)}-{position}-{invalid}"
                    scenario["input"]["constraints"].update(equipment=[raw], max_minutes=None if clarification else 30)
                    if clarification:
                        scenario["clarification_answers"]["max_minutes"] = 30
                    # Identities are assigned before position/value interventions.
                    old, valid, distractor = [
                        {"id": opaque(281, "memory", slot), "field": "equipment", "value": [value],
                         "revision": revision, "confirmed": True, "expires_on": None}
                        for slot, value, revision in zip((2, 0, 1), (old_value, valid_value, invalid_value), (5, 8, 12))]
                    distractor.update(confirmed=invalid != "unconfirmed",
                                      expires_on="2026-09-28" if invalid == "expired" else None)
                    memories = [old, distractor]
                    memories.insert(("first", "middle", "last").index(position), valid)
                    scenario["memories"] = memories
                    actions = [action("get_context"), action("get_memories")]
                    if clarification:
                        actions += [action("request_clarification", fields=["max_minutes"]),
                                    action("get_context"), action("get_memories")]
                    factors = {"rotation": rotation, "clarification": clarification, "position": position, "invalid": invalid}
                    case = case_from(scenario, "memory", factors, actions, catalog)
                    case["expected"] = expected_rule(case, catalog)
                    cases.append(case)
    for source in cases[:12]:
        scenario = deepcopy(source["scenario"])
        scenario["id"] = source["id"].replace("memory", "identity", 1)
        identities = sorted(r["id"] for r in scenario["input"]["records"] + scenario["memories"])
        mapping = {identity: opaque(389, identity.split("-")[0], i) for i, identity in enumerate(identities)}
        for record in scenario["input"]["records"] + scenario["memories"]:
            record["id"] = mapping[record["id"]]
        actions = [e["action"] for e in source["prefix"]["trace"]["events"] if e["actor"] == "agent"]
        case = case_from(scenario, "identity", deepcopy(source["factors"]), actions, catalog)
        case.update(paired_case_id=source["id"], identity_bijection=mapping)
        case["expected"] = expected_rule(case, catalog)
        if projection(case) != projection(source):
            raise ValueError("identity-only manipulation changed task semantics")
        cases.append(case)
    for status in ("pending", "declined", "revoked", "approved"):
        for history in ("plain", "context", "memories"):
            scenario = deepcopy(dev[status])
            scenario["id"] = f"d2-consent-{status}-{history}"
            # Use only the successful prefix of the existing deterministic policy.
            from liftcut_agent.environment import PlanEnvironment, ScriptedUser
            from controlled_recovery import public_episode_id
            env, user, workflow = PlanEnvironment(scenario, catalog), ScriptedUser(scenario), FixedWorkflow()
            env.reset(episode_id=public_episode_id(scenario))
            obs, actions = env.initial_observation(), []
            while not env.snapshot()["proposal"]:
                selected = workflow.act(obs)
                actions.append(selected)
                obs = {"tool_result": env.step(selected), "user_events": user.advance(env)}
            if history != "plain":
                actions.append(action("get_" + history))
            case = case_from(scenario, "consent", {"status": status, "history": history}, actions, catalog)
            case["expected"] = expected_rule(case, catalog)
            cases.append(case)
    for error in ("unknown_evidence", "session_count_mismatch"):
        for variant in range(2):
            scenario = deepcopy(dev["preview"])
            scenario["id"] = f"d2-repair-{error}-v{variant}"
            scenario["input"]["constraints"].update(equipment=[VALUES[variant]], max_minutes=30)
            plan = rule_baseline(scenario["input"], catalog)
            bad = deepcopy(plan)
            if error == "unknown_evidence":
                unknown = opaque(451, "record", variant)
                bad["evidence_ids"] = bad["evidence_ids"] + [unknown] if variant == 0 else [unknown]
            else:
                bad["sessions"] = bad["sessions"][:1] if variant == 0 else []
            if grade(proposal_case(scenario["input"], catalog), bad, catalog) != [error]:
                raise ValueError("repair intervention must introduce exactly the named issue")
            actions = [action("get_context"), action("get_memories"),
                       action("search_exercises", equipment=[VALUES[variant]]), action("validate_plan", plan=bad)]
            case = case_from(scenario, "repair", {"error": error, "variant": variant}, actions, catalog)
            case["expected"] = {"reference_plan": plan, "corrupted_plan": bad,
                "reference_actions": [action("validate_plan", plan=plan), action("propose_plan", plan=plan),
                                      action("finish", outcome="previewed")]}
            cases.append(case)
            impossible = deepcopy(scenario)
            impossible["id"] = scenario["id"].replace("repair", "infeasible", 1)
            eligible = candidates(scenario["input"], catalog)
            count = scenario["input"]["constraints"]["min_exercises"]
            minimum = sum(catalog[k]["minutes"] for k in eligible[:count])
            impossible["input"]["constraints"]["max_minutes"] = minimum - 1
            impossible["expected_terminal"] = "infeasible"
            if feasible(impossible["input"], catalog):
                raise ValueError("paired negative control is feasible")
            negative = case_from(impossible, "infeasible", {"error": error, "variant": variant}, actions, catalog)
            negative.update(paired_case_id=case["id"], expected={"reference_actions": [action("finish", outcome="infeasible")],
                "proof": {"eligible_exercises": eligible, "min_exercises": count, "minimum_minutes": minimum,
                          "max_minutes": minimum - 1, "complete_for_this_synthetic_contract": True}})
            cases.append(negative)
    # Stable panel-major order, no data-dependent sorting after inference.
    cases.sort(key=lambda c: list(PANELS).index(c["panel"]))
    if dict(Counter(c["panel"] for c in cases)) != PANELS or len({c["id"] for c in cases}) != 80:
        raise ValueError("D2 panel denominator mismatch")
    for status in ("pending", "declined", "revoked", "approved"):
        group = [c for c in cases if c["panel"] == "consent" and c["factors"]["status"] == status]
        if len({digest(business_state(c["prefix"]["snapshot"])) for c in group}) != 1:
            raise ValueError("read history changed consent business state")
    for case in cases:
        case["contract"] = {"max_requests": 8 if case["panel"] in {"repair", "infeasible"} else 1,
            "mode": "continuation" if case["panel"] in {"repair", "infeasible"} else "first_response",
            "state_sha256": digest(case["prefix"]["snapshot"]), "projection_sha256": digest(projection(case))}
    return cases


def arm_budget():
    return RunBudget(replace(config(), max_requests=MAX_REQUESTS_PER_ARM,
                             max_reserved_output_tokens=MAX_REQUESTS_PER_ARM * 512))


def repair_score(case, catalog, events):
    """Target repair is separate from full completion and unrelated failures."""
    error = case["factors"]["error"]
    field = "evidence_ids" if error == "unknown_evidence" else "sessions"
    original = case["expected"]["corrupted_plan"]
    first_repair = None
    for event in events:
        selected = event["action"]
        if selected["tool"] not in {"validate_plan", "propose_plan"}:
            continue
        proposed = selected["arguments"].get("plan", {})
        if not isinstance(proposed, dict) or proposed.get("action") != "propose_plan" or field not in proposed:
            continue
        isolated = deepcopy(original)
        isolated[field] = proposed[field]
        # Replacing only the targeted field must repair the entire original
        # error; an unrelated malformed plan cannot count as a field repair.
        if not grade(proposal_case(effective_inputs(case), catalog), isolated, catalog):
            first_repair = event["index"]
            break
    early = any(e["action"] == action("finish", outcome="infeasible") and
                (first_repair is None or e["index"] < first_repair) for e in events)
    return {"target_field_repaired": first_repair is not None, "first_repair_event": first_repair,
            "premature_infeasible_before_repair": early}


def run_case(case, catalog, transport, budget, *, on_call=None):
    env, user, policy, obs = bootstrap(case, catalog, transport)
    prefix_count, event_start = len(policy.calls), len(env.export_trace()["events"])
    policy.budget, policy.on_call = budget, on_call
    failure, stop = None, None
    while not env.done:
        if not policy.pending and len(policy.calls) - prefix_count >= case["contract"]["max_requests"]:
            stop = "first_response_complete" if case["contract"]["mode"] == "first_response" else "request_limit"
            break
        try:
            selected = policy.act(deepcopy(obs))
        except PolicyFailure as error:
            failure, stop = error.code, "policy_failure"
            break
        obs = {"tool_result": env.step(selected), "user_events": user.advance(env)}
    if policy.pending:
        raise ValueError("cannot discard accepted batch members")
    trace = env.export_trace()
    events = [e for e in trace["events"][event_start:] if e["actor"] == "agent"]
    calls = policy.calls[prefix_count:]
    blocked = sum(e["action"]["tool"] == "apply_plan" and not e["observation"]["ok"] for e in events)
    meaningful = [e for e in events if e["action"]["tool"] not in REREADS]
    if case["contract"]["mode"] == "first_response":
        scores = [first_score(case, catalog, e) for e in meaningful]
        # A batch containing a correct decision and a contradictory/wrong one
        # is not credited just because its first member looked correct.
        correct = bool(scores) and all(s["correct"] for s in scores) and not blocked and failure is None
        defer = not meaningful and bool(events) and failure is None and all(e["observation"]["ok"] for e in events)
        decision = {"correct": correct, "defer": defer, "member_scores": scores}
    else:
        decision = {"correct": trace["score"]["passed"] and not blocked and failure is None, "defer": False}
        if case["panel"] == "repair":
            decision.update(repair_score(case, catalog, events))
    decision.update(model_requests=len(calls), autonomous_actions=len(events), autonomous_blocked_writes=blocked,
        usage_complete=all(c["usage"] is not None for c in calls),
        prompt_tokens=sum(c["usage"]["prompt_tokens"] for c in calls if c["usage"] is not None),
        completion_tokens=sum(c["usage"]["completion_tokens"] for c in calls if c["usage"] is not None))
    return {"artifact_version": VERSION, "case_id": case["id"], "case_digest": digest(case),
        "model_manifest": config().manifest(), "scripted_prefix_calls": prefix_count,
        "stop_reason": stop or "environment_done", "policy_failure": failure,
        "calls": policy.calls, "trace": trace, "decision": decision}


class ReferenceTransport:
    """Explicit oracle contract check, never a deployable/model policy."""
    def __init__(self, case):
        self.actions = case["expected"].get("reference_actions", [case["expected"].get("reference_action")])
        self.index = 0

    def complete(self, payload):
        selected = self.actions[self.index]
        self.index += 1
        return reply_for([selected], self.index)


def summary(cases, episodes):
    if (dict(Counter(c["panel"] for c in cases)) != PANELS or len({c["id"] for c in cases}) != 80
            or [c["id"] for c in cases] != [e["case_id"] for e in episodes]):
        raise ValueError("complete ordered 80-case denominator required")
    panels = {}
    for panel in PANELS:
        selected = [e for c, e in zip(cases, episodes) if c["panel"] == panel]
        panels[panel] = {"total": len(selected), **{k: sum(e["decision"][k] for e in selected) for k in (
            "correct", "defer", "model_requests", "autonomous_blocked_writes", "prompt_tokens", "completion_tokens")},
            "policy_failures": dict(sorted(Counter(e["policy_failure"] for e in selected if e["policy_failure"]).items()))}
    return {"version": VERSION, "cases_digest": digest(cases), "panels": panels,
            "scope": "Reused-development diagnosis; panels have different units and must not be pooled as task accuracy"}


def replay(cases, catalog, episodes):
    summary(cases, episodes)
    budget = arm_budget()
    for case, saved in zip(cases, episodes):
        live = saved["calls"][len(case["prefix"]["calls"]):]
        transport = RecordedTransport(live)
        actual = run_case(case, catalog, transport, budget)
        if actual != saved or transport.index != len(live):
            raise ValueError("D2 response/accounting/score mismatch")
        replay_trace(case["scenario"], catalog, saved["trace"])
    return {"replayed": 80}


def prepare(output):
    if output.exists():
        raise ValueError("new preparation directory required")
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    cases, budget, episodes = fixtures(catalog), arm_budget(), []
    for case in cases:
        episodes.append(run_case(case, catalog, ReferenceTransport(case), budget))
    report = summary(cases, episodes)
    report["scope"] = "Scripted reference contracts ONLY, not model performance"
    report["replay"] = replay(cases, catalog, episodes)
    if any(p["correct"] != p["total"] for p in report["panels"].values()):
        raise ValueError("D2 reference contract failed")
    write_rows(output / "cases.jsonl", cases)
    write_rows(output / "reference-episodes.jsonl", episodes)
    dump_new(output / "reference-report.json", report)
    dump_new(output / "manifest.json", {"version": VERSION, "panels": PANELS, "max_requests_per_arm": MAX_REQUESTS_PER_ARM,
        "max_requests_four_arms": 544, "fixed_adapter_seed": 42, "reserved_test_reads": 0,
        "catalog_sha256": sha256(ROOT / "benchmark/catalog.json"),
        "dev_sha256": sha256(ROOT / "benchmark/recovery-v2/dev.jsonl"),
        "files": {p.name: sha256(p) for p in sorted(output.iterdir()) if p.is_file()}})
    return report


def load_prepared(output):
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    if (manifest["version"] != VERSION or manifest["panels"] != PANELS or manifest["fixed_adapter_seed"] != 42
            or manifest["max_requests_four_arms"] != 544 or manifest["max_requests_per_arm"] != MAX_REQUESTS_PER_ARM
            or manifest["reserved_test_reads"] != 0
            or manifest["dev_sha256"] != sha256(ROOT / "benchmark/recovery-v2/dev.jsonl")
            or manifest["catalog_sha256"] != sha256(ROOT / "benchmark/catalog.json")
            or set(manifest["files"]) != {"cases.jsonl", "reference-episodes.jsonl", "reference-report.json"}
            or any(sha256(output / name) != expected for name, expected in manifest["files"].items())):
        raise ValueError("D2 manifest/hash mismatch")
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    cases = read_jsonl(output / "cases.jsonl")
    if cases != fixtures(catalog):
        raise ValueError("D2 fixtures differ from authored intervention")
    episodes = read_jsonl(output / "reference-episodes.jsonl")
    check = summary(cases, episodes)
    check.update(scope="Scripted reference contracts ONLY, not model performance", replay=replay(cases, catalog, episodes))
    if check != json.loads((output / "reference-report.json").read_text(encoding="utf-8")):
        raise ValueError("D2 reference report mismatch")
    return cases


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({"verified_cases": len(load_prepared(args.output_dir))} if args.check else prepare(args.output_dir)["panels"]))
