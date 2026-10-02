"""D2 execution contract: fixed ordering, time estimate, partial denominators.

No network, GPU import, process launch or billing action occurs on import.
"""
from collections import Counter
from datetime import datetime, timedelta, timezone
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import re
import time

from counterfactual_diagnostics import (ROOT, PANELS, MAX_REQUESTS_PER_ARM, arm_budget,
                                       load_prepared, run_case, summary)
from prepare_counterfactual_diagnostics import REVIEWED as CPU_PLAN, read, verify_prepared
from liftcut_agent.interactive import digest
from server_workspace import dump_new, sha256

VERSION = "d2-execution-v1"
ARMS = ("s0", "t", "m", "tm")
REVIEWED = ROOT / "reports/d2-execution-readiness-v2.json"
# Ten first-response cases and two full continuations, all inside the 80 cases.
CALIBRATION_INDICES = (0, 1, 6, 12, 24, 36, 48, 59, 60, 68, 72, 76)
BUDGET = {"hourly_cny": 2.18, "reserve_cny": 5, "compute_proxy_limit_cny": 4.36,
          "work_minutes_from_boot": 90, "hard_minutes_from_boot": 120,
          "launch_minutes_from_boot": 10, "paid_api_calls": 0, "storage": "separate; no expansion"}
ESTIMATE = {"quantile": .95, "safety_factor": 1.5, "request_seconds_floor": 2,
            "future_load_seconds_floor": 120, "audit_margin_seconds": 300,
            "minimum_actual_calibration_generations": {"first_response": 6, "continuation": 2}}
PARSER = "qwen-native-content-v2"
PRECISION = "NF4 double quantization/BF16 compute; fp32 nonquantized layers in every arm"
SOURCE_FILES = (
    "d2_execution.py", "gpu_counterfactual_diagnostics.py", "audit_counterfactual_diagnostics.py",
    "run_counterfactual_window.py", "restore_counterfactual_diagnostics.py", "d2_receipt_transfer.py",
    "monitor_counterfactual_diagnostics.py", "prepare_d2_execution.py", "d2_setup.py",
    "stage_d2_execution.py", "drill_d2_execution.py", "d2_bundle.py",
    "shutdown_guard.py", "run_recovery_window.py", "restore_recovery.py", "run_controlled_window.py",
    "replication_receipt_transfer.py", "monitor_coverage_replication.py", "server_workspace.py",
    "src/liftcut_agent/qwen_transport.py", "audit_controlled.py", "audit_coverage_tokens.py",
)


def utcnow():
    return datetime.now(timezone.utc)


def aware(value):
    result = datetime.fromisoformat(value)
    if result.utcoffset() is None:
        raise ValueError("timezone-aware time required")
    return result


class Clock:
    """Clock rollback cannot extend a budget initialized against an absolute time."""
    def __init__(self, now=utcnow, monotonic=time.monotonic):
        self.clock, self.tick = now, monotonic
        self.started, self.started_tick = now(), monotonic()

    def now(self):
        return max(self.clock(), self.started + timedelta(seconds=self.tick() - self.started_tick))


def deadlines(booted_at, now, *, launching=True):
    boot = aware(booted_at)
    if now.utcoffset() is None or boot > now:
        raise ValueError("boot proxy cannot be future or timezone-naive")
    if launching and (now - boot).total_seconds() > 60 * BUDGET["launch_minutes_from_boot"]:
        raise ValueError("late launch; original budget must not be reset")
    return boot + timedelta(minutes=90), boot + timedelta(minutes=120)


def ordered_cases(cases):
    if len(cases) != 80 or len({c["id"] for c in cases}) != 80:
        raise ValueError("exact D2 eighty-case source required")
    return [cases[i] for i in CALIBRATION_INDICES] + [c for i, c in enumerate(cases) if i not in CALIBRATION_INDICES]


def expected_adapters():
    return read(CPU_PLAN)["adapter_sha256"]


def verify_adapters(root):
    expected = expected_adapters()
    for arm in ARMS:
        for name, value in expected[arm].items():
            path = root / arm / "final" / name
            if path.is_symlink() or not path.is_file() or sha256(path) != value:
                raise ValueError("D2 requires the actual original seed42 adapter bytes: " + arm + "/" + name)
    return expected


def expected_runtime():
    doctor = read(ROOT / "reports/qwen-state-coverage-2026-09-29/preflight/doctor.json")
    return {"packages": doctor["packages"], "python": doctor["python"],
                "cuda_build": doctor["torch_runtime"]["cuda_build"], "gpu_name": "NVIDIA GeForce RTX 4090"}


def runtime(torch):
    expected = expected_runtime()
    actual = {"packages": {n: importlib.metadata.version(n) for n in expected["packages"]},
              "python": platform.python_version(), "cuda_build": torch.version.cuda,
              "gpu_name": torch.cuda.get_device_name(0)}
    if actual != expected:
        raise ValueError("D2 runtime differs from original seed42")
    return actual


def build_plan(prepared):
    cpu = verify_prepared(prepared)
    original = load_prepared(prepared)
    cases = ordered_cases(original)
    return {"version": VERSION, "cpu_plan_sha256": sha256(CPU_PLAN),
        "source_sha256": {n: sha256(ROOT / n) for n in SOURCE_FILES},
        "original_cases_digest": digest(original), "execution_cases_digest": digest(cases),
        "execution_case_ids": [c["id"] for c in cases],
        "calibration_case_ids": [c["id"] for c in cases[:len(CALIBRATION_INDICES)]],
        "panels": PANELS, "arms": list(ARMS), "fixed_adapter_seed": 42,
        "adapter_sha256": cpu["adapter_sha256"], "model": read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json"),
        "max_requests_per_arm": MAX_REQUESTS_PER_ARM, "max_requests": 544,
        "budget": BUDGET, "estimate": ESTIMATE, "training_steps": 0, "reserved_test_reads": 0,
        "calibration_rule": "12 registered cases per arm, included in the 80-case denominator; no extra generation",
        "estimate_rule": "sum over first_response/continuation: max(2, 1.5 * nearest-rank P95 observed generation seconds in that mode) * remaining mode request caps; plus max(120, 1.5 * maximum observed load seconds) * future arm loads + 300",
        "stop_rule": "Insufficient measured calibration or estimate exceeds work time remaining: preserve partial evidence and stop; never extend or resample",
        "scope": "Execution contract, not new model results; repeated development states"}


def verify_plan(prepared):
    plan = build_plan(prepared)
    if plan != read(REVIEWED):
        raise ValueError("D2 execution sources or contract differ from reviewed readiness")
    return plan


def binding(plan, commit, booted_at):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("full execution commit required")
    work, hard = deadlines(booted_at, aware(booted_at))
    return {"version": VERSION, "execution_plan_sha256": digest(plan), "cpu_plan_sha256": plan["cpu_plan_sha256"],
            "code_commit": commit, "fixed_adapter_seed": 42, "cases_digest": plan["execution_cases_digest"],
            "booted_at_proxy": aware(booted_at).isoformat(), "work_cutoff": work.isoformat(), "hard_cutoff": hard.isoformat()}


def tag_timings(cases, episodes, generations):
    """Mode labels come from bound case IDs, never from generated model text."""
    count, result = 0, []
    for case, episode in zip(cases, episodes):
        if episode["case_id"] != case["id"]:
            raise ValueError("timing case identity differs")
        n = len(episode["calls"]) - episode["scripted_prefix_calls"]
        result.extend({**g, "mode": case["contract"]["mode"]} for g in generations[count:count + n])
        count += n
    if count != len(generations) or len(result) != count:
        raise ValueError("timings do not cover completed calls")
    return result


def request_caps(cases, index, future):
    return {mode: sum(c["contract"]["max_requests"] for c in cases[index:] if c["contract"]["mode"] == mode)
            + future * sum(c["contract"]["max_requests"] for c in cases if c["contract"]["mode"] == mode)
            for mode in ("first_response", "continuation")}


def calibrated(timings):
    return all(sum(g["model_called"] and g["mode"] == mode for g in timings) >= minimum
               for mode, minimum in ESTIMATE["minimum_actual_calibration_generations"].items())


def remaining_estimate(generations, load_seconds, remaining_caps, future_loads):
    actual = [g for g in generations if g["model_called"]]
    if (any(not math.isfinite(g["elapsed_seconds"]) or g["elapsed_seconds"] < 0 for g in actual)
            or not math.isfinite(load_seconds) or load_seconds < 0):
        raise ValueError("invalid timing evidence")
    groups = {}
    for mode in ("first_response", "continuation"):
        values = sorted(g["elapsed_seconds"] for g in actual if g["mode"] == mode)
        if not values:
            raise ValueError("no actual generation timing for mode: " + mode)
        p95 = values[math.ceil(.95 * len(values)) - 1]
        groups[mode] = {"observations": len(values), "p95_generation_seconds": p95,
            "request_seconds_with_margin": max(2., 1.5 * p95), "remaining_request_caps": remaining_caps[mode]}
    load = max(120., 1.5 * load_seconds)
    return {"observations": len(actual), "by_mode": groups,
            "remaining_request_caps": sum(remaining_caps.values()), "future_loads": future_loads,
            "estimated_remaining_seconds": sum(g["request_seconds_with_margin"] * g["remaining_request_caps"] for g in groups.values()) + load * future_loads + 300.,
            "warning": "Empirical estimate, not a latency guarantee; process and shutdown deadlines enforce cost"}


def partial_summary(cases, episodes, reason):
    """Missing cases remain false in all 80 denominators, never fabricate traces."""
    if [e["case_id"] for e in episodes] != [c["id"] for c in cases[:len(episodes)]] or len(episodes) > 80:
        raise ValueError("completed episodes must be a unique execution-order prefix")
    results = []
    for i, c in enumerate(cases):
        e = episodes[i] if i < len(episodes) else None
        if e is not None and e["case_digest"] != digest(c):
            raise ValueError("completed case binding mismatch")
        results.append({"case_id": c["id"], "panel": c["panel"], "attempt_complete": e is not None,
            "correct": e["decision"]["correct"] if e else False,
            "defer": e["decision"]["defer"] if e else False,
            "missing_reason": reason if e is None else None,
            "policy_failure": e["policy_failure"] if e else None})
    return {"total": 80, "completed_attempts": len(episodes), "missing": 80 - len(episodes),
        "results": results, "panels": {p: {"total": n,
            "correct": sum(r["correct"] for r in results if r["panel"] == p),
            "defer": sum(r["defer"] for r in results if r["panel"] == p),
            "missing": sum(not r["attempt_complete"] for r in results if r["panel"] == p)} for p, n in PANELS.items()},
        "scope": "Partial execution denominator; missing is not an observed model answer"}


def execute_arm(cases, catalog, transport, arm, work_cutoff, load_seconds, *, clock=None,
                timing_rows=None, previous_timings=(), previous_loads=(), on_episode=None, on_call=None, on_estimate=None):
    if arm not in ARMS or len(cases) != 80:
        raise ValueError("registered complete arm required")
    clock, timing_rows = clock or Clock(), timing_rows if timing_rows is not None else []
    budget, episodes, reason, estimates = arm_budget(), [], None, []
    for i, case in enumerate(cases):
        remaining = (work_cutoff - clock.now()).total_seconds()
        if remaining <= 0:
            reason = "work_deadline"
            break
        if i >= len(CALIBRATION_INDICES):
            tagged = tag_timings(cases, episodes, timing_rows)
            if not calibrated(tagged):
                reason = "insufficient_calibration"
                break
            future = len(ARMS) - ARMS.index(arm) - 1
            caps = request_caps(cases, i, future)
            estimate = remaining_estimate([*previous_timings, *tagged], max([load_seconds, *previous_loads]), caps, future)
            observed_at = clock.now()
            remaining = (work_cutoff - observed_at).total_seconds()
            estimate.update(before_case_id=case["id"], work_seconds_remaining=remaining,
                            at_utc=observed_at.isoformat(), stop=estimate["estimated_remaining_seconds"] > remaining)
            estimates.append(estimate)
            if on_estimate:
                on_estimate(estimate)
            if estimate["stop"]:
                reason = "forecast_exceeds_work_window"
                break
        callback = (lambda c: on_call(case["id"], c)) if on_call else None
        episode = run_case(case, catalog, transport, budget, on_call=callback)
        episodes.append(episode)
        if on_episode:
            on_episode(episode)
        if budget.halted:
            reason = "unknown_usage_or_transport_halt"
            break
    report = partial_summary(cases, episodes, reason)
    report.update(stop_reason=reason, estimates=estimates)
    if len(episodes) == 80:
        report["full_summary"] = summary(cases, episodes)
    return report, episodes


def append_json(stream, row):
    import os
    stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    stream.flush()
    os.fsync(stream.fileno())


def event_file(destination, event, **fields):
    # `path` is a legitimate event payload field (the per-arm archive path).
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("a", encoding="utf-8", newline="\n") as stream:
        append_json(stream, {"event": event, "at_utc": utcnow().isoformat(), **fields})
