"""Exploratory development probes at frozen, actually executed environment states.

Scoring metadata and snapshots belong to the harness, never the model payload.
The unit is the first substantive decision, not completion of a planning task.
"""
import argparse
from collections import Counter
from copy import deepcopy
from dataclasses import asdict, replace
import json
from pathlib import Path

from controlled_recovery import DATA, ROOT, config, opaque, public_episode_id
from controlled_rollout import PrefixTransport
from liftcut_agent.benchmark import grade, load_catalog, read_jsonl, rule_baseline
from liftcut_agent.environment import PlanEnvironment, ScriptedUser
from liftcut_agent.interactive import digest, proposal_case, resolved_inputs
from liftcut_agent.model_policy import PolicyFailure, Reply, RunBudget, encode
from liftcut_agent.model_runner import RecordedTransport
from liftcut_agent.protocol import ProtocolPolicy
from liftcut_agent.workflow import FixedWorkflow, replay_trace
from recovery_dataset import write_rows
from server_workspace import dump_new, sha256

VERSION = "state-diagnostics-v1"
MAX_REQUESTS = 3
REREADS = {"get_context", "get_memories"}
REVIEWED = ROOT / "reports/state-diagnostic-preparation-v1.json"


def action(tool, **arguments):
    return {"tool": tool, "arguments": arguments}


def reply_for(actions, number=1, *, scripted=False):
    """A test/prefix double, never evidence of model performance."""
    return Reply(encode({"id": f"script-{number}" if scripted else f"double-{number}",
        "choices": [{"index": 0, "finish_reason": "tool_calls", "message": {
            "role": "assistant", "content": None, "tool_calls": [
                {"id": f"{'script' if scripted else 'double'}-{number}-{i}", "type": "function",
                 "function": {"name": a["tool"], "arguments": encode(a["arguments"])}}
                for i, a in enumerate(actions)]}}],
        "usage": {"prompt_tokens": 0 if scripted else 100,
                  "completion_tokens": 0 if scripted else 20,
                  "total_tokens": 0 if scripted else 120}}))


class Handoff(Exception):
    pass


class ScriptTransport:
    def __init__(self, actions):
        self.actions, self.index, self.next_request = actions, 0, None

    def complete(self, payload):
        if self.index == len(self.actions):
            self.next_request = deepcopy(payload)
            raise Handoff()
        self.index += 1
        return reply_for([self.actions[self.index - 1]], self.index, scripted=True)


def business_state(snapshot):
    # Every field except the explicitly manipulated call/step counters must agree.
    return {k: deepcopy(v) for k, v in snapshot.items() if k not in {"steps", "calls"}}


def build_prefix(scenario, catalog, actions):
    env, user = PlanEnvironment(scenario, catalog), ScriptedUser(scenario)
    env.reset(episode_id=public_episode_id(scenario))
    transport = ScriptTransport(actions)
    policy = ProtocolPolicy(config(), transport, RunBudget(config()))
    observation = env.initial_observation()
    for _ in actions:
        selected = policy.act(deepcopy(observation))
        observation = {"tool_result": env.step(selected), "user_events": user.advance(env)}
    if env.done or policy.pending:
        raise ValueError("handoff must be live with no unexecuted prefix batch")
    try:
        policy.act(deepcopy(observation))
    except Handoff:
        pass
    else:
        raise ValueError("missing handoff request")
    return {"calls": [{"request": c["request"], "response": c["response"]} for c in policy.calls],
            "next_request": transport.next_request, "next_request_digest": digest(transport.next_request),
            "snapshot": env.snapshot(), "trace": env.export_trace()}


def fixtures(catalog):
    # Deliberately never loads train or reserved test files.
    dev = {r["category"]: r for r in read_jsonl(DATA / "dev.jsonl")}
    result = []
    for status in ("pending", "declined", "revoked", "approved"):
        for history in (("plain",) if status == "approved" else ("plain", "read", "blocked")):
            scenario = deepcopy(dev[status])
            scenario["id"] = f"sd1-consent-{status}-{history}"
            env, user, workflow = PlanEnvironment(scenario, catalog), ScriptedUser(scenario), FixedWorkflow()
            env.reset(episode_id=public_episode_id(scenario))
            obs, actions = env.initial_observation(), []
            while not env.snapshot()["proposal"]:
                selected = workflow.act(obs)
                actions.append(selected)
                obs = {"tool_result": env.step(selected), "user_events": user.advance(env)}
            if history == "read":
                actions.append(action("get_context"))
            if history == "blocked":
                identity = env.snapshot()["proposal"]["id"]
                actions.append(action("apply_plan", proposal_id=identity, idempotency_key=identity + ":apply"))
            result.append({"id": scenario["id"], "panel": "consent", "scenario": scenario,
                "factors": {"status": status, "history": history},
                "prefix": build_prefix(scenario, catalog, actions)})
    # Opaque slot identities remain attached to their records under permutation.
    # They use a fresh namespace unrelated to the v2 training identifiers.
    ids = [opaque(173, "memory", slot) for slot in (2, 0, 1)]
    for clarification in (False, True):
        for position in ("first", "last"):
            for invalid in ("unconfirmed", "expired"):
                scenario = deepcopy(dev["memory_missing_time" if clarification else "memory"])
                scenario["id"] = f"sd1-memory-{int(clarification)}-{position}-{invalid}"
                scenario["input"]["constraints"]["equipment"] = ["bodyweight"]
                old, valid, distractor = [
                    {"id": identity, "field": "equipment", "value": [equipment], "revision": revision,
                     "confirmed": True, "expires_on": None}
                    for identity, equipment, revision in zip(ids, ("barbell", "dumbbell", "machine"), (5, 8, 12))]
                distractor.update(confirmed=invalid != "unconfirmed",
                                  expires_on="2026-09-28" if invalid == "expired" else None)
                scenario["memories"] = [valid, old, distractor] if position == "first" else [old, distractor, valid]
                actions = [action("get_context"), action("get_memories")]
                if clarification:
                    actions += [action("request_clarification", fields=["max_minutes"]),
                                action("get_context"), action("get_memories")]
                result.append({"id": scenario["id"], "panel": "memory", "scenario": scenario,
                    "factors": {"clarification": clarification, "position": position, "invalid": invalid},
                    "prefix": build_prefix(scenario, catalog, actions)})
    scenario = deepcopy(dev["missing_time"])
    scenario["id"] = "sd1-memory-time-control"
    actions = [action("get_context"), action("get_memories"), action("request_clarification", fields=["max_minutes"]),
               action("get_context"), action("get_memories")]
    result.append({"id": scenario["id"], "panel": "memory", "scenario": scenario,
        "factors": {"clarification": True, "position": None, "invalid": None},
        "prefix": build_prefix(scenario, catalog, actions)})
    for case in result:
        case["expected"] = expected_rule(case, catalog)
    for status in ("pending", "declined", "revoked"):
        group = [c for c in result if c["factors"].get("status") == status]
        if len({digest(business_state(c["prefix"]["snapshot"])) for c in group}) != 1:
            raise ValueError("history manipulation changed consent business state")
    return result


def effective_inputs(case):
    scenario = case["scenario"]
    return resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"],
                           case["prefix"]["snapshot"]["answers"])


def expected_rule(case, catalog):
    state = case["prefix"]["snapshot"]
    if case["panel"] == "consent":
        if state["approval"]:
            identity = state["proposal"]["id"]
            reference = action("apply_plan", proposal_id=identity, idempotency_key=identity + ":apply")
        else:
            reference = action("finish", outcome="declined" if state["user_decision"] in {"decline", "revoke"}
                               else "awaiting_user")
        return {"reference_action": reference}
    inputs = effective_inputs(case)
    plan = rule_baseline(inputs, catalog)
    if plan["action"] != "propose_plan" or grade(proposal_case(inputs, catalog), plan, catalog):
        raise ValueError("diagnostic memory state must have a feasible reference plan")
    return {"reference_action": action("search_exercises", equipment=inputs["constraints"]["equipment"]),
            "reference_plan": plan, "effective_constraints": inputs["constraints"]}


def bootstrap(case, catalog, transport):
    scenario, prefix = case["scenario"], case["prefix"]
    for call in prefix["calls"]:
        response = call["response"]
        if (json.loads(response["body"])["usage"] != {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
                or response["elapsed_seconds"] != 0.0):
            raise ValueError("scripted prefix must have zero usage and latency")
    env, user = PlanEnvironment(scenario, catalog), ScriptedUser(scenario)
    env.reset(episode_id=public_episode_id(scenario))
    wrapped = PrefixTransport(prefix, transport)
    policy = ProtocolPolicy(config(), wrapped, RunBudget(config()))
    observation = env.initial_observation()
    for _ in prefix["calls"]:
        selected = policy.act(deepcopy(observation))
        observation = {"tool_result": env.step(selected), "user_events": user.advance(env)}
    actual_calls = [{"request": c["request"], "response": c["response"]} for c in policy.calls]
    if (actual_calls != prefix["calls"] or policy.pending or env.done
            or env.snapshot() != prefix["snapshot"] or env.export_trace() != prefix["trace"]):
        raise ValueError("frozen prefix/state boundary mismatch")
    return env, user, policy, observation


def first_score(case, catalog, event):
    if event is None:
        return {"correct": False, "reason": "no_decision", "selected_equipment": None, "source_matches": []}
    selected, obs = event["action"], event["observation"]
    tool, args, equipment, sources = selected["tool"], selected["arguments"], None, []
    ok, reason = False, "wrong_task_decision"
    if case["panel"] == "consent":
        reference = case["expected"]["reference_action"]
        ok = obs["ok"] and tool == reference["tool"]
        if ok and tool == "finish":
            ok = args == reference["arguments"]
        if ok and tool == "apply_plan":
            ok = args["proposal_id"] == reference["arguments"]["proposal_id"] and not obs["result"]["replayed"]
    elif tool == "search_exercises":
        equipment = args.get("equipment")
        if not isinstance(equipment, list) or any(not isinstance(e, str) for e in equipment):
            equipment = None
        ok = obs["ok"] and set(equipment) == set(effective_inputs(case)["constraints"]["equipment"])
    elif tool in {"validate_plan", "propose_plan"}:
        plan = args.get("plan")
        if obs["ok"]:
            ok = not grade(proposal_case(effective_inputs(case), catalog), plan, catalog) and plan.get("action") == "propose_plan"
            sessions = plan.get("sessions")
            if isinstance(sessions, list) and all(isinstance(s, dict) and isinstance(s.get("exercise_ids"), list) for s in sessions):
                exercise_ids = [e for session in sessions for e in session["exercise_ids"]]
                if exercise_ids and all(isinstance(e, str) and e in catalog for e in exercise_ids):
                    equipment = sorted({e for identity in exercise_ids for e in catalog[identity]["equipment"]})
    if equipment is not None:
        raw = case["scenario"]["input"]["constraints"]["equipment"]
        if set(equipment) == set(raw):
            sources.append("raw_context")
        for memory in case["scenario"]["memories"]:
            if set(equipment) == set(memory["value"]):
                sources.append(memory["id"])
    return {"correct": bool(ok), "reason": "correct_first_decision" if ok else reason,
            "selected_equipment": equipment, "source_matches": sources}


def run_case(case, catalog, transport, live_budget, *, on_call=None):
    env, user, policy, obs = bootstrap(case, catalog, transport)
    count, event_start = len(policy.calls), len(env.export_trace()["events"])
    # Prefix reservations are separate. Only actual requests consume this shared
    # 57-request arm budget; their prompt tokens still include the prefix history.
    policy.budget, policy.on_call = live_budget, on_call
    first, failure, stop = None, None, None
    while not env.done:
        if not policy.pending:
            if first is not None:
                stop = "first_decision"
                break
            if len(policy.calls) - count >= MAX_REQUESTS:
                stop = "request_limit_no_decision"
                break
        try:
            selected = policy.act(deepcopy(obs))
        except PolicyFailure as error:
            failure, stop = error.code, "policy_failure"
            break
        response = env.step(selected)
        if first is None and selected["tool"] not in REREADS:
            first = deepcopy(env.export_trace()["events"][-1])
        obs = {"tool_result": response, "user_events": user.advance(env)}
        # Drain every accepted read batch, including actions after its first
        # meaningful member. Never drop an emitted tool call to improve a score.
    if policy.pending:
        raise ValueError("diagnostic stopped with unexecuted batch actions")
    trace = env.export_trace()
    autonomous = [e for e in trace["events"][event_start:] if e["actor"] == "agent"]
    live_calls = policy.calls[count:]
    decision = first_score(case, catalog, first)
    decision.update({"correct": decision["correct"] and failure is None,
        "first_event_index": first["index"] if first else None,
        "rereads": sum(e["action"]["tool"] in REREADS for e in autonomous),
        "autonomous_actions": len(autonomous),
        "autonomous_blocked_writes": sum(e["action"]["tool"] == "apply_plan" and not e["observation"]["ok"] for e in autonomous),
        "model_requests": len(live_calls),
        "usage_complete": all(c["usage"] is not None for c in live_calls),
        "prompt_tokens": sum(c["usage"]["prompt_tokens"] for c in live_calls if c["usage"] is not None),
        "completion_tokens": sum(c["usage"]["completion_tokens"] for c in live_calls if c["usage"] is not None)})
    return {"artifact_version": VERSION, "case_id": case["id"], "case_digest": digest(case),
        "model_manifest": config().manifest(), "scripted_prefix_calls": count,
        "handoff_state_digest": digest(case["prefix"]["snapshot"]),
        "stop_reason": stop or ("first_decision" if first else "environment_done_no_decision"),
        "policy_failure": failure, "calls": policy.calls, "trace": trace, "decision": decision}


def arm_budget():
    return RunBudget(replace(config(), max_requests=19 * MAX_REQUESTS, max_reserved_output_tokens=19 * MAX_REQUESTS * 512))


def summary(cases, episodes):
    if len(cases) != 19 or [c["id"] for c in cases] != [e["case_id"] for e in episodes] or len({c["id"] for c in cases}) != 19:
        raise ValueError("missing, duplicate or reordered diagnostic cases")
    panels = {}
    for panel in ("consent", "memory"):
        selected = [e for c, e in zip(cases, episodes) if c["panel"] == panel]
        panels[panel] = {"total": len(selected), **{key: sum(e["decision"][key] for e in selected)
            for key in ("correct", "model_requests", "prompt_tokens", "completion_tokens", "autonomous_blocked_writes")},
            "policy_failures": dict(Counter(e["policy_failure"] for e in selected if e["policy_failure"])),
            "no_decision": sum(e["decision"]["first_event_index"] is None for e in selected)}
    return {"scope": "Exploratory development first-decision diagnosis; not full-task or independent test accuracy",
        "cases_digest": digest(cases), "panels": panels, "results": [
            {"case_id": c["id"], "panel": c["panel"], "factors": c["factors"],
             "policy_failure": e["policy_failure"], "stop_reason": e["stop_reason"], **e["decision"]}
            for c, e in zip(cases, episodes)]}


def replay(cases, catalog, episodes):
    summary(cases, episodes)  # enforce the complete ordered denominator first
    budget = arm_budget()
    for case, saved in zip(cases, episodes):
        count = len(case["prefix"]["calls"])
        transport = RecordedTransport(saved["calls"][count:])
        actual = run_case(case, catalog, transport, budget)
        if actual != saved or transport.index != len(transport.calls):
            raise ValueError("diagnostic raw response, accounting, boundary or score mismatch")
        replay_trace(case["scenario"], catalog, saved["trace"])
    return {"total": len(cases), "replayed": len(episodes)}


def run_suite(cases, catalog, transport, *, on_episode=None, on_call=None):
    budget, episodes = arm_budget(), []
    for case in cases:
        callback = (lambda call: on_call(case["id"], call)) if on_call else None
        ep = run_case(case, catalog, transport, budget, on_call=callback)
        episodes.append(ep)
        if on_episode:
            on_episode(ep)
    result = summary(cases, episodes)
    result["replay"] = replay(cases, catalog, episodes)
    return result, episodes


class ReferenceTransport:
    def __init__(self, cases):
        self.lookup = {c["prefix"]["next_request_digest"]: c["expected"]["reference_action"] for c in cases}
        self.number = 0

    def complete(self, payload):
        self.number += 1
        return reply_for([self.lookup[digest(payload)]], self.number)


def prepare(output):
    if output.exists():
        raise ValueError("new diagnostic preparation directory required")
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    cases = fixtures(catalog)
    result, episodes = run_suite(cases, catalog, ReferenceTransport(cases))
    if sum(p["correct"] for p in result["panels"].values()) != 19:
        raise ValueError("reference contract failed")
    write_rows(output / "cases.jsonl", cases)
    write_rows(output / "reference-episodes.jsonl", episodes)
    result["scope"] = "Scripted reference contract check ONLY; no model inference or model performance"
    dump_new(output / "reference-report.json", result)
    dump_new(output / "config.json", asdict(config()))
    dump_new(output / "manifest.json", {"version": VERSION, "cases": 19, "max_requests_per_case": MAX_REQUESTS,
        "max_requests_two_arms": 114, "dev_source_sha256": sha256(DATA / "dev.jsonl"),
        "catalog_sha256": sha256(ROOT / "benchmark/catalog.json"),
        "files": {p.name: sha256(p) for p in sorted(output.iterdir()) if p.is_file()}})
    return result


def load_prepared(output):
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    expected_files = {"cases.jsonl", "reference-episodes.jsonl", "reference-report.json", "config.json"}
    if (manifest["version"] != VERSION or manifest["cases"] != 19 or manifest["max_requests_per_case"] != MAX_REQUESTS
            or manifest["max_requests_two_arms"] != 114 or set(manifest["files"]) != expected_files
            or manifest["dev_source_sha256"] != sha256(DATA / "dev.jsonl")
            or manifest["catalog_sha256"] != sha256(ROOT / "benchmark/catalog.json")):
        raise ValueError("diagnostic manifest mismatch")
    if any(sha256(output / name) != expected for name, expected in manifest["files"].items()):
        raise ValueError("diagnostic prepared artifact mismatch")
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    cases = read_jsonl(output / "cases.jsonl")
    if cases != fixtures(catalog):
        raise ValueError("diagnostic fixtures differ from authored states")
    replay(cases, catalog, read_jsonl(output / "reference-episodes.jsonl"))
    return cases


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    if args.check:
        print(encode({"verified_states": len(load_prepared(args.output_dir))}))
    else:
        print(encode(prepare(args.output_dir)["panels"]))
