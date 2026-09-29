"""Unchanged normal development tasks plus separately scored fixed-state probes."""
from collections import Counter

from state_coverage import ROOT, original
from controlled_recovery import config, public_episode_id
from liftcut_agent.model_policy import RunBudget
from liftcut_agent.model_runner import replay_model_suite, run_model_episode


def normal_report(scenarios, catalog, episodes):
    if [e["scenario_id"] for e in episodes] != [s["id"] for s in scenarios]:
        raise ValueError("missing, duplicate or reordered normal development tasks")
    if [e["trace"]["episode_id"] for e in episodes] != [public_episode_id(s) for s in scenarios]:
        raise ValueError("normal evaluation must preserve frozen public identity")
    checked = replay_model_suite(scenarios, catalog, config(), episodes)
    if checked["replayed"] != 12:
        raise ValueError("normal development denominator must be twelve")
    rows = [{"scenario_id": s["id"], "category": s["category"], "policy_failure": e["policy_failure"],
        **e["trace"]["score"], "passed": e["trace"]["score"]["passed"] and e["policy_failure"] is None}
        for s, e in zip(scenarios, episodes)]
    calls = [c for e in episodes for c in e["calls"]]
    return {"scope": "Reused recovery-v2 normal DEVELOPMENT tasks; full episodes, not independent test",
        "total": 12, "passed": sum(r["passed"] for r in rows), "results": rows, "replay": checked,
        "blocked_write_attempts": sum(r["blocked_write_attempts"] for r in rows),
        "policy_failures": dict(Counter(r["policy_failure"] for r in rows if r["policy_failure"])),
        "requests": len(calls), "usage_complete": all(c["usage"] is not None for c in calls),
        "prompt_tokens": sum(c["usage"]["prompt_tokens"] for c in calls if c["usage"] is not None),
        "completion_tokens": sum(c["usage"]["completion_tokens"] for c in calls if c["usage"] is not None)}


def run_normal(catalog, transport_factory, *, on_episode=None, on_call=None):
    scenarios, cfg = original("dev"), config()
    budget, episodes = RunBudget(cfg), []
    for scenario in scenarios:
        callback = (lambda call: on_call(scenario["id"], call)) if on_call else None
        episode = run_model_episode(scenario, catalog, cfg, transport_factory(), budget,
            episode_id=public_episode_id(scenario), on_call=callback)
        episodes.append(episode)
        if on_episode:
            on_episode(episode)
    return normal_report(scenarios, catalog, episodes), episodes
