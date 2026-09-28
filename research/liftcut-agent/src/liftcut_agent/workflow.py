"""Observation-only fixed workflow, fixture runner and deterministic trace replay."""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from statistics import mean
from typing import Protocol

from .benchmark import missing_fields, rule_baseline
from .environment import PlanEnvironment, ScriptedUser
from .interactive import VERSION, digest, resolved_inputs, validate_scenarios


class Policy(Protocol):
    def act(self, observation: dict) -> dict: ...


class FixedWorkflow:
    """No scenario, catalogue or oracle access; all facts arrive via tools.

    no-memory and no-retry are deliberately limited controls for harness smoke
    checks, not trained-model ablations.
    """

    def __init__(self, *, use_memories: bool = True, retry_timeouts: bool = True):
        self._use_memories = use_memories
        self._retry_timeouts = retry_timeouts
        self._last = None
        self._retries = 0

    def _action(self, tool: str, **arguments) -> dict:
        self._last = {"tool": tool, "arguments": deepcopy(arguments)}
        return deepcopy(self._last)

    def act(self, observation: dict) -> dict:
        if self._last is None:
            self._intent = observation["intent"]
            return self._action("get_context")
        response = observation["tool_result"]
        if not response["ok"]:
            if (response["error"]["retryable"] and self._retry_timeouts and self._retries < 2):
                self._retries += 1
                return deepcopy(self._last)
            return self._action("finish", outcome="awaiting_user")
        self._retries = 0
        result = response["result"]
        tool = self._last["tool"]
        users = [item["event"] for item in observation["user_events"]]
        if tool == "get_context":
            self._context = deepcopy(result)
            return self._action("get_memories")
        if tool == "get_memories":
            memories = result["memories"] if self._use_memories else []
            self._inputs = resolved_inputs(self._context["input"], memories, self._context["as_of"],
                                           self._context["user_corrections"])
            missing = missing_fields(self._inputs)
            if missing:
                return self._action("request_clarification", fields=missing)
            return self._action("search_exercises", equipment=self._inputs["constraints"]["equipment"])
        if tool == "request_clarification":
            if any(event["type"] == "clarification" for event in users):
                return self._action("get_context")
            return self._action("finish", outcome="awaiting_user")
        if tool == "search_exercises":
            catalog = {block["id"]: block for block in result["blocks"]}
            self._plan = rule_baseline(self._inputs, catalog)
            if self._plan["action"] == "report_infeasible":
                return self._action("finish", outcome="infeasible")
            return self._action("validate_plan", plan=self._plan)
        if tool == "validate_plan":
            return (self._action("propose_plan", plan=self._plan) if result["valid"] else
                    self._action("finish", outcome="awaiting_user"))
        if tool == "propose_plan":
            if any(event["type"] == "update_constraints" for event in users):
                return self._action("get_context")
            if self._intent == "preview":
                return self._action("finish", outcome="previewed")
            decision = users[-1]["type"] if users else None
            if decision == "approve":
                proposal_id = result["proposal"]["id"]
                return self._action("apply_plan", proposal_id=proposal_id,
                                    idempotency_key=f"{proposal_id}:apply")
            return self._action("finish", outcome="declined" if decision in {"decline", "revoke"} else "awaiting_user")
        if tool == "apply_plan":
            return self._action("finish", outcome="applied")
        raise ValueError("workflow received an unexpected tool response")


def run_episode(scenario: dict, catalog: dict, policy: Policy) -> dict:
    environment = PlanEnvironment(scenario, catalog)
    user = ScriptedUser(scenario)
    observation = environment.initial_observation()
    while not environment.done:
        action = policy.act(deepcopy(observation))
        response = environment.step(action)
        events = user.advance(environment)
        observation = {"tool_result": response, "user_events": events}
    return environment.export_trace()


def run_suite(scenarios: list[dict], catalog: dict, policy_name: str = "fixed") -> tuple[dict, list[dict]]:
    if policy_name not in {"fixed", "no-memory", "no-retry"}:
        raise ValueError("unknown workflow policy")
    validate_scenarios(scenarios, catalog)
    traces = [run_episode(scenario, catalog, FixedWorkflow(use_memories=policy_name != "no-memory",
                                                        retry_timeouts=policy_name != "no-retry"))
              for scenario in scenarios]
    results = [{"scenario_id": scenario["id"], "category": scenario["category"], **trace["score"]}
               for scenario, trace in zip(scenarios, traces)]
    errors = Counter()
    categories = {}
    for result in results:
        errors.update(result["tool_errors"])
        counts = categories.setdefault(result["category"], {"total": 0, "passed": 0})
        counts["total"] += 1
        counts["passed"] += int(result["passed"])
    report = {
        "environment_version": VERSION, "policy": policy_name,
        "scope": "scripted interactive development fixtures; no LLM or training result",
        "scenario_digest": digest(scenarios), "catalog_digest": digest(catalog),
        "total": len(results), "passed": sum(row["passed"] for row in results),
        "clean_completions": sum(row["clean_completion"] for row in results),
        "mean_steps": mean(row["steps"] for row in results),
        "writes": sum(row["writes"] for row in results),
        "blocked_write_attempts": sum(row["blocked_write_attempts"] for row in results),
        "tool_errors": dict(sorted(errors.items())), "by_category": categories, "results": results,
    }
    return report, traces


def replay_trace(scenario: dict, catalog: dict, trace: dict) -> dict:
    """Re-execute actions and fixture-driven user responses; distrust saved scores.

    Hashes check identity/integrity, not authorship or cryptographic provenance.
    Replaying an incomplete or unsuccessful episode does not make it successful.
    """
    fields = {"environment_version", "scenario_id", "scenario_digest", "catalog_digest",
              "episode_id", "initial_observation", "events", "score"}
    if not isinstance(trace, dict) or set(trace) != fields:
        raise ValueError("invalid trace fields")
    if (trace["environment_version"] != VERSION or trace["scenario_id"] != scenario["id"]
            or trace["scenario_digest"] != digest(scenario) or trace["catalog_digest"] != digest(catalog)):
        raise ValueError("trace version or input digest mismatch")
    environment = PlanEnvironment(scenario, catalog)
    environment.reset(episode_id=trace["episode_id"])
    user = ScriptedUser(scenario)
    if digest(trace["initial_observation"]) != digest(environment.initial_observation()):
        raise ValueError("initial observation mismatch")
    events = trace["events"]
    if not isinstance(events, list):
        raise ValueError("invalid event list")
    index = 0
    while index < len(events):
        event = events[index]
        if environment.done or not isinstance(event, dict) or event.get("actor") != "agent" or "action" not in event:
            raise ValueError(f"unexpected event at {index}")
        environment.step(event["action"])
        user.advance(environment)
        generated = environment.export_trace()["events"]
        end = len(generated)
        if digest(generated[index:end]) != digest(events[index:end]):
            raise ValueError(f"trace observation or state mismatch at {index}")
        index = end
    score = environment.score()
    if digest(score) != digest(trace["score"]):
        raise ValueError("terminal score mismatch")
    return {"scenario_id": scenario["id"], "replay_valid": True, "score": score}
