"""Offline audit of complete model runs and a deduplicated cost ledger.

Audit is independent of network access. It replays saved responses before trusting
the report and keeps per-run task denominators separate from aggregate spending.
"""

from collections import Counter
from dataclasses import asdict
from decimal import Decimal
from pathlib import Path

from .benchmark import read_json, read_jsonl, sha256
from .interactive import digest
from .model_policy import RunBudget
from .protocol import load_config
from .model_runner import replay_model_suite, summarize

VERSION = "run-audit-v0.1"


def _check(condition, message):
    if not condition:
        raise ValueError(message)


def _object(path):
    value = read_json(path.read_text(encoding="utf-8"))
    _check(isinstance(value, dict), f"{path.name} must be an object")
    return value


def episode_metrics(scenario, episode):
    trace, calls = episode["trace"], episode["calls"]
    agents = [event for event in trace["events"] if event["actor"] == "agent"]
    validations, candidates, retries = [], [], 0
    for index, event in enumerate(agents):
        action, observation = event["action"], event["observation"]
        tool = action.get("tool") if isinstance(action, dict) else None
        if tool == "validate_plan" and observation["ok"]:
            result = observation["result"]
            candidates.append(result["valid"])
            if not result["valid"]:
                validations.append({"step": index + 1, "tool": tool, "issues": result["issues"]})
        elif tool == "propose_plan":
            error = observation.get("error", {})
            # A timeout gives no candidate-validity observation.
            if observation["ok"] or error.get("code") == "invalid_plan":
                candidates.append(observation["ok"])
                if not observation["ok"]:
                    validations.append({"step": index + 1, "tool": tool, "issues": error.get("details", [])})
        if index:
            previous = agents[index - 1]
            if (previous["observation"].get("error", {}).get("code") == "tool_timeout"
                    and digest(previous["action"]) == digest(action)):
                retries += 1
    known = [call for call in calls if call["usage"] is not None]
    cost = sum((Decimal(call["estimated_cost_usd"]) for call in known), Decimal(0))
    passed = trace["score"]["passed"] and episode["policy_failure"] is None
    failed_response_tools = None
    if episode["policy_failure"] == "expected_single_tool_call" and calls:
        body = read_json(calls[-1]["response"]["body"])
        tool_calls = body["choices"][0]["message"].get("tool_calls")
        if isinstance(tool_calls, list):
            failed_response_tools = [call["function"].get("name") if isinstance(call, dict)
                                     and isinstance(call.get("function"), dict) else None for call in tool_calls]
    return {"scenario_id": scenario["id"], "category": scenario["category"],
            "family_id": scenario["family_id"], "split": scenario["split"],
            "expected_terminal": scenario["expected_terminal"], **trace["score"], "passed": passed,
            "policy_failure": episode["policy_failure"], "requests": len(calls),
            "failed_response_tools": failed_response_tools,
            "first_candidate_valid": candidates[0] if candidates else None,
            "candidate_rejections": validations,
            "recovered_after_candidate_rejection": passed and bool(validations),
            "immediate_identical_timeout_retries": retries,
            "observed_request_seconds_total": sum(call["response"]["elapsed_seconds"] for call in calls),
            "input_tokens": sum(call["usage"]["prompt_tokens"] for call in known),
            "output_tokens": sum(call["usage"]["completion_tokens"] for call in known),
            "known_usage_cost_usd": str(cost),
            "estimated_cost_usd": str(cost) if len(known) == len(calls) else None}


def audit_run(run_dir: Path, scenarios: list[dict], catalog: dict, *, cases_sha256: str, catalog_sha256: str):
    config_data = _object(run_dir / "config.json")
    config = load_config(config_data)
    manifest = _object(run_dir / "manifest.json")
    report = _object(run_dir / "report.json")
    episodes = read_jsonl(run_dir / "episodes.jsonl", allow_empty=True)
    calls = read_jsonl(run_dir / "calls.jsonl", allow_empty=True)
    mode = manifest.get("mode")
    _check(mode in {"mock", "live"}, "unknown run mode")
    _check(isinstance(manifest.get("started_at"), str) and isinstance(manifest.get("code"), dict),
           "missing run provenance metadata")
    _check(digest(config_data) == digest(asdict(config)), "configuration is not explicit and complete")
    _check(digest(manifest.get("config")) == digest(config_data), "manifest configuration mismatch")
    _check(manifest.get("cases_sha256") == cases_sha256 and manifest.get("catalog_sha256") == catalog_sha256,
           "manifest input file hashes mismatch")
    for key, value in manifest.items():
        _check(key in report and digest(report[key]) == digest(value), f"report metadata mismatch: {key}")
    ids = manifest.get("scenario_ids")
    known = {scenario["id"]: scenario for scenario in scenarios}
    _check(isinstance(ids, list) and bool(ids) and all(isinstance(identity, str) and identity in known for identity in ids),
           "invalid scenario selection")
    _check(len(ids) == len(set(ids)), "duplicate selected scenario")
    selected = [known[identity] for identity in ids]
    for name in ("episodes", "calls"):
        _check(report.get(f"{name}_sha256") == sha256(run_dir / f"{name}.jsonl"), f"{name} artifact hash mismatch")
    replay = replay_model_suite(selected, catalog, config, episodes)
    _check(replay["replayed"] == len(selected), "cannot audit an incomplete run")
    episode_ids = [episode["trace"]["episode_id"] for episode in episodes]
    _check(len(episode_ids) == len(set(episode_ids)), "duplicate episode IDs within run")
    flattened = [{"scenario_id": episode["scenario_id"], **call} for episode in episodes for call in episode["calls"]]
    _check(digest(calls) == digest(flattened), "call log and episode records disagree")
    budget = RunBudget(config)
    budget.requests = len(calls)
    budget.reserved_output_tokens = sum(call["reservation"]["output_token_reserve"] for call in calls)
    budget.reserved_usd = sum((Decimal(call["reservation"]["reserved_usd"]) for call in calls), Decimal(0))
    computed = summarize(selected, catalog, config, episodes, budget, mode=mode)
    for key, value in computed.items():
        _check(key in report and digest(report[key]) == digest(value), f"report summary mismatch: {key}")
    metrics = [episode_metrics(scenario, episode) for scenario, episode in zip(selected, episodes)]
    observed = [row for row in metrics if row["first_candidate_valid"] is not None]
    served_models = set()
    for call in calls:
        if call["response"]["body"] is not None:
            try:
                body = read_json(call["response"]["body"])
            except ValueError:
                continue
            if isinstance(body, dict) and isinstance(body.get("model"), str):
                served_models.add(body["model"])
    return {"run_id": digest({"mode": mode, "endpoint": manifest.get("endpoint"), "calls": report["calls_sha256"],
                              "episodes": report["episodes_sha256"]}),
            "mode": mode, "started_at": manifest["started_at"], "source_code": manifest["code"],
            "requested_model": config.model, "served_models": sorted(served_models),
            "scenario_ids": ids, "scenario_digest": report["scenario_digest"],
            "episodes_sha256": report["episodes_sha256"], "calls_sha256": report["calls_sha256"],
            "episode_ids": episode_ids,
            "replayed": replay["replayed"], "total": report["total"], "passed": report["passed"],
            "clean_completions": report["clean_completions"], "paired_with_fixed": report["paired_with_fixed"],
            "requests": len(calls), "input_tokens": report["observed_prompt_tokens"],
            "output_tokens": report["observed_completion_tokens"], "usage_complete": report["usage_complete"],
            "known_usage_cost_usd": report["known_usage_cost_usd"], "estimated_cost_usd": report["estimated_cost_usd"],
            "reserved_usd": report["reserved_usd"], "configured_reservation_guard_usd": config.max_reserved_usd,
            "request_latency_p50_seconds": report["request_latency_p50_seconds"],
            "request_latency_p95_seconds": report["request_latency_p95_seconds"],
            "first_candidate_observations": len(observed),
            "first_candidate_valid": sum(row["first_candidate_valid"] for row in observed),
            "episodes_recovered_after_candidate_rejection": sum(row["recovered_after_candidate_rejection"] for row in metrics),
            "candidate_issue_counts": dict(Counter(issue for row in metrics for rejection in row["candidate_rejections"]
                                                   for issue in rejection["issues"])),
            "policy_failures": report["policy_failures"], "tool_errors": report["tool_errors"],
            "blocked_write_attempts": report["blocked_write_attempts"], "scenarios": metrics}


def build_ledger(audits):
    _check(bool(audits), "no audited runs")
    run_ids, episodes, artifacts = set(), set(), set()
    for audit in audits:
        _check(audit["run_id"] not in run_ids and audit["episodes_sha256"] not in artifacts,
               "duplicate run artifacts would double-count spending")
        _check(not episodes.intersection(audit["episode_ids"]), "overlapping episode IDs across runs")
        run_ids.add(audit["run_id"])
        artifacts.add(audit["episodes_sha256"])
        episodes.update(audit["episode_ids"])
    live = [audit for audit in audits if audit["mode"] == "live"]
    complete = all(audit["usage_complete"] for audit in live)
    cost = sum((Decimal(audit["known_usage_cost_usd"]) for audit in live), Decimal(0))
    return {"audit_version": VERSION,
            "scope": "audited selected completed runs only; not an account balance or provider bill; accuracy is per run",
            "live_runs": len(live), "mock_runs": len(audits) - len(live),
            "live_requests": sum(audit["requests"] for audit in live), "live_usage_complete": complete,
            "live_known_usage_cost_usd": str(cost), "live_estimated_cost_usd": str(cost) if complete else None,
            "live_reserved_usd": str(sum((Decimal(audit["reserved_usd"]) for audit in live), Decimal(0))),
            "runs": audits}
