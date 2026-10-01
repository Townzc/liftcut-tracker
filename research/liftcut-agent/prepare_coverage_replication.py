"""R1: versioned seed schedules over unchanged, verified coverage-v1 decisions.

Seed42 is a CPU equivalence check only. Paid windows accept seed43/44.
Preparation reads only existing train/dev preparations; no weights or model calls.
"""
import argparse
from copy import deepcopy
import json
import importlib.metadata
import math
from pathlib import Path
import platform
import random
import re

from prepare_state_coverage import REVIEWED as ORIGINAL_PLAN, schedules as original_schedules, verify_prepared as verify_original
from prepare_state_diagnostics import verify_prepared as verify_diagnostics
from state_diagnostics import REVIEWED as DIAGNOSTIC_PLAN
from state_coverage import ARMS, ROOT
from liftcut_agent.interactive import digest
from server_workspace import dump_new, sha256

VERSION = "coverage-replication-v1"
SEEDS = (42, 43, 44)
RUN_SEEDS = (43, 44)
REVIEWED = ROOT / "reports/coverage-replication-preparation-v1.json"
SOURCE_FILES = (
    "prepare_coverage_replication.py", "gpu_train_coverage_replication.py",
    "gpu_coverage_replication.py", "audit_coverage_replication.py",
    "run_coverage_replication_window.py", "restore_coverage_replication.py",
    "review_coverage_replication.py", "audit_coverage_tokens.py",
)


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def require_seed(seed, *, executing=False):
    if type(seed) is not int or seed not in (RUN_SEEDS if executing else SEEDS):
        raise ValueError("unregistered replication seed; seed42 is CPU-only")


def order_for(seed, count):
    require_seed(seed)
    rng, order = random.Random(seed), []
    for _ in range(2):
        epoch = list(range(count))
        rng.shuffle(epoch)
        order.extend(epoch)
    return order


def schedules(prepared, seed):
    require_seed(seed)
    old, tokens, rows = original_schedules(prepared)
    order = order_for(seed, len(rows["s0"]))
    scheduled = {a: [{"variant": a, "index": i} for i in order] for a in ARMS}
    if seed == 42 and scheduled != old:
        raise ValueError("seed42 does not reproduce the original sampler")
    return scheduled, tokens, rows


def build_report(prepared, diagnostic):
    original = verify_original(prepared)
    verify_diagnostics(diagnostic)
    _, tokens, rows = original_schedules(prepared)
    doctor = read(ROOT / "reports/qwen-state-coverage-2026-09-29/preflight/doctor.json")
    runtime = {"packages": doctor["packages"], "python": doctor["python"],
               "cuda_build": doctor["torch_runtime"]["cuda_build"], "gpu_name": "NVIDIA GeForce RTX 4090"}
    seeds = {}
    for seed in SEEDS:
        order = order_for(seed, len(rows["s0"]))
        arms, groups = {}, {}
        for arm in ARMS:
            selected = [tokens[arm][i] for i in order]
            arms[arm] = {"decisions": len(selected), "optimizer_steps": math.ceil(len(selected) / 8),
                "supervised_tokens": sum(r["target_tokens"] for r in selected),
                "input_tokens": sum(len(r["input_ids"]) for r in selected),
                "max_sequence_tokens": max(len(r["input_ids"]) for r in selected),
                "sample_order_sha256": digest(order),
                "target_schedule_sha256": digest([r["input_ids"][r["prompt_tokens"]:] for r in selected])}
            groups[arm] = [sum(r["target_tokens"] for r in selected[i:i + 8]) for i in range(0, len(selected), 8)]
        if any(groups[a] != groups["s0"] for a in ARMS):
            raise ValueError("per-update targets are not paired across arms")
        if seed == 42 and arms != original["arms"]:
            raise ValueError("seed42 token/order fingerprint differs from original")
        training = {**original["training"], "seed": seed}
        seeds[str(seed)] = {"version": VERSION, "seed": seed, "training": training, "arms": arms,
            "per_update_target_tokens": groups["s0"], "evaluation": deepcopy(original["evaluation"]),
            "expected_runtime": runtime,
            "inference_seed": 42, "inference": "Unchanged greedy decoding; not sampling reliability",
            "legacy_preparation_sha256": sha256(ORIGINAL_PLAN), "diagnostic_plan_sha256": sha256(DIAGNOSTIC_PLAN)}
    if len({p["arms"]["s0"]["sample_order_sha256"] for p in seeds.values()}) != 3:
        raise ValueError("different training seeds must change sample order")
    seconds = sum(read(ROOT / f"reports/qwen-state-coverage-2026-09-29/training/{a}/report.json")
                  ["training_seconds_including_checkpoints"] for a in ARMS)
    return {"version": VERSION, "source_sha256": {name: sha256(ROOT / name) for name in SOURCE_FILES},
        "seeds": seeds, "gpu_seeds": list(RUN_SEEDS), "seed42_schedule_matches_original": True,
        "scope": "CPU schedules only; repeated development tasks, not new model evidence",
        "new_model_calls": 0, "reserved_test_reads": 0,
        "runtime_estimate": {"observed_four_arm_optimization_seconds": seconds,
            "optimization_minutes_with_20pct_margin": math.ceil(seconds * 1.2 / 60),
            "setup_load_evaluation_audit_minutes_reserved": 36, "backup_minutes_reserved": 30,
            "limit": "Planning proxy from seed42; hard time limits may yield a partial run"},
        "budget": {"hourly_cny_assumed": 2.18, "max_minutes_from_boot": 180,
            "work_cutoff_minutes_from_boot": 150, "compute_proxy_cny_per_window": 6.54,
            "planning_reserve_cny_per_window": 8, "windows": 2, "total_planning_reserve_cny": 16,
            "storage": "Separate provider charge; no expansion", "paid_api_calls": 0}}


def prepare(prepared, diagnostic, output, *, write_initial=False):
    if output.exists():
        raise ValueError("fresh replication preparation directory required")
    report = build_report(prepared, diagnostic)
    if write_initial:
        dump_new(REVIEWED, report)
    elif report != read(REVIEWED):
        raise ValueError("replication preparation differs from reviewed source/data")
    dump_new(output / "manifest.json", report)
    for seed in SEEDS:
        dump_new(output / f"seed-{seed}/plan.json", report["seeds"][str(seed)])
        scheduled, _, _ = schedules(prepared, seed)
        dump_new(output / f"seed-{seed}/schedule.json", scheduled)
    return report


def verify_prepared(prepared, diagnostic, replication, seed):
    require_seed(seed)
    actual = build_report(prepared, diagnostic)
    expected_files = {"manifest.json"} | {f"seed-{s}/{n}.json" for s in SEEDS for n in ("plan", "schedule")}
    if (actual != read(REVIEWED) or read(replication / "manifest.json") != actual
            or {p.relative_to(replication).as_posix() for p in replication.rglob("*") if p.is_file()} != expected_files):
        raise ValueError("replication manifest/source/inventory mismatch")
    # Validate all seeds, not merely the requested directory.
    for s in SEEDS:
        plan = actual["seeds"][str(s)]
        schedule = {a: [{"variant": a, "index": i} for i in order_for(s, 504)] for a in ARMS}
        if read(replication / f"seed-{s}/plan.json") != plan or read(replication / f"seed-{s}/schedule.json") != schedule:
            raise ValueError("replication seed schedule mismatch")
    return actual["seeds"][str(seed)]


def run_binding(plan, commit):
    if not isinstance(commit, str) or re.fullmatch(r"[0-9a-f]{40}", commit) is None:
        raise ValueError("exact committed source required")
    return {"study_version": VERSION, "seed": plan["seed"], "code_commit": commit,
        "seed_plan_sha256": digest(plan), "replication_plan_sha256": sha256(REVIEWED),
        "legacy_preparation_sha256": plan["legacy_preparation_sha256"],
        "diagnostic_plan_sha256": plan["diagnostic_plan_sha256"]}


def arm_binding(plan, commit, arm):
    if arm not in ARMS:
        raise ValueError("unregistered replication arm")
    return {**run_binding(plan, commit), "arm": arm,
        "sample_order_sha256": plan["arms"][arm]["sample_order_sha256"],
        "target_schedule_sha256": plan["arms"][arm]["target_schedule_sha256"]}


def require_binding(actual, expected):
    if actual != expected:
        raise ValueError("replication seed/arm/source/data binding mismatch")


def runtime_metadata(torch, plan):
    actual = {"packages": {name: importlib.metadata.version(name) for name in plan["expected_runtime"]["packages"]},
              "python": platform.python_version(), "cuda_build": torch.version.cuda,
              "gpu_name": torch.cuda.get_device_name(0)}
    if actual != plan["expected_runtime"]:
        raise ValueError("runtime differs from seed42 environment; review before changing experiment conditions")
    return actual


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("prepared-dir", "diagnostic-dir", "output-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--verify-only", action="store_true")
    p.add_argument("--write-initial-report", action="store_true")
    args = p.parse_args()
    if args.verify_only:
        verify_prepared(args.prepared_dir, args.diagnostic_dir, args.output_dir, 42)
        report = read(REVIEWED)
    else:
        report = prepare(args.prepared_dir, args.diagnostic_dir, args.output_dir, write_initial=args.write_initial_report)
    print(json.dumps({k: report[k] for k in ("version", "seed42_schedule_matches_original", "runtime_estimate", "budget")}, indent=2))
