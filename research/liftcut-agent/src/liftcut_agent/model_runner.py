"""Account for every scenario, compare fixed workflow, and replay model artifacts."""

from collections import Counter
from copy import deepcopy
from decimal import Decimal
import math

from .environment import PlanEnvironment, ScriptedUser
from .interactive import digest, validate_scenarios
from .model_policy import ModelConfig, ModelPolicy, PolicyFailure, Reply, RunBudget
from .protocol import ProtocolConfig, ProtocolPolicy
from .workflow import FixedWorkflow, replay_trace, run_episode

ARTIFACT_VERSION = "model-episode-v0.1"


def run_model_episode(scenario, catalog, config, transport, budget, *, episode_id=None, on_call=None):
    environment = PlanEnvironment(scenario, catalog)
    if episode_id is not None:
        environment.reset(episode_id=episode_id)
    user = ScriptedUser(scenario)
    policy_type = ProtocolPolicy if isinstance(config, ProtocolConfig) else ModelPolicy
    policy = policy_type(config, transport, budget, on_call=on_call)
    observation = environment.initial_observation()
    failure = None
    while not environment.done:
        try:
            action = policy.act(deepcopy(observation))
        except PolicyFailure as error:
            failure = error.code
            break
        response = environment.step(action)
        observation = {"tool_result": response, "user_events": user.advance(environment)}
    trace = environment.export_trace()
    return {"artifact_version": ARTIFACT_VERSION, "scenario_id": scenario["id"],
            "model_manifest": config.manifest(), "calls": policy.calls, "policy_failure": failure,
            "trace": trace}


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def summarize(scenarios, catalog, config, episodes, budget, *, mode):
    rows, calls = [], []
    paired = Counter({"both_passed": 0, "model_only": 0, "fixed_only": 0, "both_failed": 0})
    for scenario, episode in zip(scenarios, episodes):
        score = episode["trace"]["score"]
        fixed = run_episode(scenario, catalog, FixedWorkflow())["score"]["passed"]
        passed = score["passed"] and episode["policy_failure"] is None
        paired["both_passed" if passed and fixed else "model_only" if passed else "fixed_only" if fixed else "both_failed"] += 1
        rows.append({"scenario_id": scenario["id"], "category": scenario["category"],
                     **score, "passed": passed, "policy_failure": episode["policy_failure"],
                     "requests": len(episode["calls"]), "fixed_passed": fixed})
        calls.extend(episode["calls"])
    accounted = [call for call in calls if call["usage"] is not None]
    complete_usage = len(accounted) == len(calls)
    cost = sum((Decimal(call["estimated_cost_usd"]) for call in accounted), Decimal(0))
    passed = sum(row["passed"] for row in rows)
    latencies = [call["response"]["elapsed_seconds"] for call in calls]
    return {"scope": "offline protocol smoke; synthetic responses, usage and latency; not model performance"
            if mode == "mock" else "live model on public development fixtures; not held-out evaluation",
            "mode": mode, "model_manifest": config.manifest(),
            "scenario_digest": digest(scenarios), "catalog_digest": digest(catalog),
            "total": len(scenarios), "passed": passed,
            "clean_completions": sum(row["passed"] and row["clean_completion"] for row in rows),
            "requests": len(calls), "reserved_output_tokens": budget.reserved_output_tokens,
            "reserved_usd": str(budget.reserved_usd), "accounted_requests": len(accounted),
            "unknown_usage_requests": len(calls) - len(accounted), "usage_complete": complete_usage,
            "observed_prompt_tokens": sum(call["usage"]["prompt_tokens"] for call in accounted),
            "observed_completion_tokens": sum(call["usage"]["completion_tokens"] for call in accounted),
            "known_usage_cost_usd": str(cost), "estimated_cost_usd": str(cost) if complete_usage else None,
            "estimated_cost_per_success_usd": str(cost / passed) if complete_usage and passed else None,
            "request_latency_p50_seconds": percentile(latencies, .5),
            "request_latency_p95_seconds": percentile(latencies, .95),
            "policy_failures": dict(Counter(row["policy_failure"] for row in rows if row["policy_failure"])),
            "tool_errors": dict(sum((Counter(row["tool_errors"]) for row in rows), Counter())),
            "blocked_write_attempts": sum(row["blocked_write_attempts"] for row in rows),
            "by_category": {category: {"total": sum(row["category"] == category for row in rows),
                "passed": sum(row["category"] == category and row["passed"] for row in rows)}
                for category in sorted({row["category"] for row in rows})},
            "paired_with_fixed": dict(paired), "results": rows}


def run_model_suite(scenarios, catalog, config, transport_factory, *, mode="mock", on_episode=None, on_call=None):
    if mode not in {"mock", "live"}:
        raise ValueError("unknown model runner mode")
    validate_scenarios(scenarios, catalog)
    budget = RunBudget(config)
    episodes = []
    for scenario in scenarios:
        callback = (lambda call: on_call(scenario["id"], call)) if on_call else None
        episode = run_model_episode(scenario, catalog, config, transport_factory(), budget, on_call=callback)
        episodes.append(episode)
        if on_episode:
            on_episode(deepcopy(episode))
    return summarize(scenarios, catalog, config, episodes, budget, mode=mode), episodes


class RecordedTransport:
    def __init__(self, calls):
        self.calls = deepcopy(calls)
        self.index = 0

    def complete(self, payload):
        if self.index >= len(self.calls):
            raise ValueError("missing model response during replay")
        call = self.calls[self.index]
        self.index += 1
        if not isinstance(call, dict) or digest(payload) != digest(call.get("request")):
            raise ValueError("model request/history mismatch")
        try:
            return Reply(**call["response"])
        except (KeyError, TypeError) as error:
            raise ValueError("invalid recorded response") from error


def replay_model_suite(scenarios, catalog, config, episodes):
    """Rebuild messages, parse raw replies, execute tools and regenerate user events.

    This validates consistency, not provider provenance or real billing/latency.
    Replay requires the full ordered run because the budget is shared across cases.
    """
    validate_scenarios(scenarios, catalog)
    known = {scenario["id"] for scenario in scenarios}
    ids = [episode.get("scenario_id") for episode in episodes]
    if any(not isinstance(identity, str) or identity not in known for identity in ids) or len(set(ids)) != len(ids):
        raise ValueError("duplicate or unknown model scenario_id")
    if len(episodes) != len(scenarios):
        return {"total": len(scenarios), "replayed": 0, "task_passed": 0,
                "error": "incomplete_run_cannot_replay_shared_budget", "missing": len(scenarios) - len(episodes)}
    if ids != [scenario["id"] for scenario in scenarios]:
        raise ValueError("model replay requires original scenario order")
    budget = RunBudget(config)
    passed = 0
    for scenario, saved in zip(scenarios, episodes):
        if (saved.get("artifact_version") != ARTIFACT_VERSION
                or digest(saved.get("model_manifest")) != digest(config.manifest())):
            raise ValueError("model artifact version or configuration mismatch")
        try:
            transport = RecordedTransport(saved["calls"])
            actual = run_model_episode(scenario, catalog, config, transport, budget,
                                       episode_id=saved["trace"]["episode_id"])
        except (KeyError, TypeError) as error:
            raise ValueError("malformed model artifact") from error
        if transport.index != len(transport.calls) or digest(actual) != digest(saved):
            raise ValueError("model artifact action, accounting or trace mismatch")
        replay_trace(scenario, catalog, saved["trace"])
        passed += saved["trace"]["score"]["passed"] and saved["policy_failure"] is None
    return {"total": len(scenarios), "replayed": len(episodes), "task_passed": passed}
