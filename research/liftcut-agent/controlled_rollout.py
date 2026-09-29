"""Identical scripted prefixes followed by unmodified model decisions.

Prefix replies are explicitly synthetic, have zero model usage, and are excluded
from autonomous-error and generation metrics. The normal environment runner still
executes every prefix action and user event, preserving authorization state.
"""
from collections import Counter
from copy import deepcopy
import json

from controlled_recovery import DATA, config, public_episode_id
from recovery_dataset import load_frozen
from liftcut_agent.benchmark import missing_fields, read_jsonl
from liftcut_agent.interactive import digest, resolved_inputs
from liftcut_agent.model_policy import Reply, RunBudget
from liftcut_agent.model_runner import run_model_episode, replay_model_suite


class PrefixTransport:
    def __init__(self, prefix, transport):
        self.prefix, self.transport, self.index = prefix, transport, 0

    def complete(self, payload):
        calls = self.prefix["calls"] if self.prefix else []
        index = self.index
        self.index += 1
        if index < len(calls):
            call = calls[index]
            if digest(payload) != digest(call["request"]):
                raise ValueError("scripted prefix request/history mismatch")
            return Reply(**call["response"])
        if self.prefix and index == len(calls) and digest(payload) != self.prefix["next_request_digest"]:
            raise ValueError("first live request differs from frozen error state")
        return self.transport.complete(payload)


def evaluation_cases(prepared):
    normal = [s for s in load_frozen(DATA) if s["split"] == "dev"]
    known = {s["id"]: s for s in normal}
    prefixes = read_jsonl(prepared / "decisions/prefixes.jsonl")
    extra = []
    for prefix in prefixes:
        row = deepcopy(known[prefix["parent_id"]])
        row["id"] = prefix["scenario_id"]
        extra.append(row)
    if len(normal) != 12 or len(extra) != 9 or len({p["scenario_id"] for p in prefixes}) != 9:
        raise ValueError("expected complete 12 normal plus 9 controlled development cases")
    return normal + extra, {p["scenario_id"]: p for p in prefixes}


def first_recovery_ok(scenario, prefix, event):
    if event is None:
        return False
    action, observation = event["action"], event["observation"]
    if not observation["ok"]:
        return False
    kind, name, args = prefix["error_kind"], action["tool"], action["arguments"]
    if kind == "unapproved_write":
        return name == "finish" and args["outcome"] == scenario["expected_terminal"]
    if name in {"get_context", "get_memories"}:
        return True
    inputs = resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"])
    if kind == "invalid_plan":
        return name == "request_clarification" and set(args["fields"]) == set(missing_fields(inputs))
    return name == "search_exercises" and set(args["equipment"]) == set(inputs["constraints"]["equipment"])


def summarize_controlled(scenarios, prefixes, episodes):
    if [s["id"] for s in scenarios] != [e["scenario_id"] for e in episodes]:
        raise ValueError("missing, reordered or duplicated controlled episodes")
    rows = []
    for scenario, ep in zip(scenarios, episodes):
        prefix = prefixes.get(scenario["id"])
        count = len(prefix["calls"]) if prefix else 0
        if prefix:
            actual = [{"request": c["request"], "response": c["response"]} for c in ep["calls"][:count]]
            if actual != prefix["calls"]:
                raise ValueError("saved synthetic prefix differs from frozen provenance")
        events = [e for e in ep["trace"]["events"] if e["actor"] == "agent"]
        # Prefix generation is constrained to one call per response. Model read
        # batches after that boundary may produce multiple environment events.
        autonomous = events[count:]
        calls = ep["calls"][count:]
        errors, invalid, repeats = Counter(), 0, 0
        bad_plans = set()
        blocked, requested, accepted = 0, 0, 0
        for event in autonomous:
            action, obs = event["action"], event["observation"]
            if not obs["ok"]:
                errors[obs["error"]["code"]] += 1
                blocked += int(action["tool"] == "apply_plan" and obs["error"]["code"] != "tool_timeout")
            if action["tool"] == "request_clarification":
                requested += 1
                accepted += int(obs["ok"])
            if action["tool"] == "validate_plan" and obs["ok"] and not obs["result"]["valid"]:
                invalid += 1
                fp = digest(action["arguments"]["plan"])
                repeats += int(fp in bad_plans)
                bad_plans.add(fp)
        score = ep["trace"]["score"]
        passed = bool(score["passed"] and ep["policy_failure"] is None)
        row = {"scenario_id": scenario["id"], "parent_id": prefix["parent_id"] if prefix else scenario["id"],
            "panel": "continuation" if prefix else "normal", "category": scenario["category"],
            "error_kind": prefix["error_kind"] if prefix else None, "passed": passed,
            "outcome": score["outcome"], "issues": score["issues"], "policy_failure": ep["policy_failure"],
            "scripted_prefix_calls": count, "model_requests": len(calls),
            "model_prompt_tokens": sum(c["usage"]["prompt_tokens"] for c in calls),
            "model_completion_tokens": sum(c["usage"]["completion_tokens"] for c in calls),
            "model_generation_seconds": sum(c["response"]["elapsed_seconds"] for c in calls),
            "autonomous_tool_errors": dict(errors), "autonomous_blocked_writes": blocked,
            "actual_writes": score["writes"], "invalid_validations": invalid, "repeated_invalid_plan": repeats,
            "clarification_requests": requested, "accepted_clarification_requests": accepted,
            "first_recovery_acceptable": first_recovery_ok(scenario, prefix, autonomous[0] if autonomous else None) if prefix else None,
            "autonomous_clean_completion": passed and not blocked and not any(k != "tool_timeout" for k in errors),
            "completion_without_invalid_plan": passed and not invalid and not blocked and not any(k != "tool_timeout" for k in errors)}
        rows.append(row)
    panels = {}
    for panel in ("normal", "continuation"):
        selected = [r for r in rows if r["panel"] == panel]
        summed = ("passed", "model_requests", "model_prompt_tokens", "model_completion_tokens", "model_generation_seconds",
                  "autonomous_blocked_writes", "actual_writes", "invalid_validations", "repeated_invalid_plan",
                  "accepted_clarification_requests", "autonomous_clean_completion", "completion_without_invalid_plan")
        panels[panel] = {"total": len(selected), **{k: sum(r[k] for r in selected) for k in summed}}
        if panel == "continuation":
            panels[panel]["first_recovery_acceptable"] = sum(r["first_recovery_acceptable"] for r in selected)
    return {"scope": "Normal and controlled-prefix synthetic DEVELOPMENT panels; never pool their success rates",
            "panels": panels, "results": rows}


def run_controlled(prepared, catalog, transport, *, on_episode=None):
    scenarios, prefixes = evaluation_cases(prepared)
    cfg, budget, episodes = config(), RunBudget(config()), []
    for scenario in scenarios:
        prefix = prefixes.get(scenario["id"])
        wrapped = PrefixTransport(prefix, transport)
        episode = run_model_episode(scenario, catalog, cfg, wrapped, budget, episode_id=public_episode_id(scenario))
        if prefix and wrapped.index < len(prefix["calls"]):
            raise ValueError("prefix failed before model continuation")
        episodes.append(episode)
        if on_episode:
            on_episode(episode)
    report = summarize_controlled(scenarios, prefixes, episodes)
    report["replay"] = replay_model_suite(scenarios, catalog, cfg, episodes)
    return report, episodes
