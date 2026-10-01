"""CPU review of one fully audited R1 seed; three-seed inference remains separate.

The CLI replays the new run (including actual weights and token IDs) before review.
The pure summarizer consumes audit results, not a substitute for running the audit.
"""
import argparse
from copy import deepcopy
import math
from pathlib import Path

from audit_coverage_replication import audit
from audit_state_coverage import audit as audit_original, paired_comparisons
from liftcut_agent.benchmark import read_jsonl
from prepare_coverage_replication import ARMS, ROOT, RUN_SEEDS, read, require_seed
from server_workspace import dump_new, sha256


PANELS = {"normal": 12, "read_consent": 3, "main_memory": 8, "all_consent": 10}


def panel_cases(arm):
    """Keep IDs paired; totals are fixed development panels, not independent users."""
    normal, diagnostic = arm["normal"]["results"], arm["diagnostic"]["results"]
    if (len(normal) != 12 or len(diagnostic) != 19
            or len({r["scenario_id"] for r in normal}) != 12
            or len({r["case_id"] for r in diagnostic}) != 19
            or any(type(r["passed"]) is not bool for r in normal)
            or any(type(r["correct"]) is not bool for r in diagnostic)):
        raise ValueError("wrong or duplicate development case inventory")
    panels = {"normal": {r["scenario_id"]: r["passed"] for r in normal}}
    selectors = {
        "read_consent": lambda r: r["panel"] == "consent" and r["factors"]["history"] == "read",
        "main_memory": lambda r: r["panel"] == "memory" and r["factors"]["position"] is not None,
        "all_consent": lambda r: r["panel"] == "consent",
    }
    for name, predicate in selectors.items():
        panels[name] = {r["case_id"]: r["correct"] for r in diagnostic if predicate(r)}
    if any(len(panels[name]) != total for name, total in PANELS.items()):
        raise ValueError("wrong development panel denominator")
    return panels


def blocked_attempts(arm):
    cases = []
    for panel, rows, identity, count in (
        ("normal", arm["normal"]["results"], "scenario_id", "blocked_write_attempts"),
        ("diagnostic", arm["diagnostic"]["results"], "case_id", "autonomous_blocked_writes"),
    ):
        for row in rows:
            number = row[count]
            if type(number) is not int or number < 0:
                raise ValueError("invalid blocked-attempt count")
            if number:
                cases.append({"panel": panel, "case_id": row[identity], "attempts": number})
    total = sum(row["attempts"] for row in cases)
    reported = arm["normal"]["blocked_write_attempts"] + sum(
        row["autonomous_blocked_writes"] for row in arm["diagnostic"]["panels"].values())
    if total != reported:
        raise ValueError("blocked-attempt summary differs from cases")
    return {"total": total, "cases": cases}


def differences(before, after):
    if set(before) != set(after):
        raise ValueError("unpaired cross-seed development cases")
    gained = sorted(key for key in before if not before[key] and after[key])
    lost = sorted(key for key in before if before[key] and not after[key])
    return {"gained": gained, "lost": lost, "net": len(gained) - len(lost)}


def summarize(seed, audited, original):
    """Summarize supplied completed audits; this pure function does no file replay."""
    require_seed(seed, executing=True)
    if (audited.get("run_binding", {}).get("seed") != seed
            or audited.get("adapter_files_verified") is not True
            or audited.get("token_ids_verified") is not True):
        raise ValueError("new seed requires a complete weights/token audit")
    arms, by_seed = {}, {42: original, seed: audited}
    for result in by_seed.values():
        if (result.get("episodes_replayed") != 124 or result.get("test_episodes") != 0
                or set(result["arms"]) != set(ARMS)):
            raise ValueError("incomplete or unexpected development audit")
        if paired_comparisons(result["arms"]) != result["comparisons"]:
            raise ValueError("original paired gates differ from case results")
    for arm in ARMS:
        old, new = original["arms"][arm], audited["arms"][arm]
        before, after = panel_cases(old), panel_cases(new)
        # Membership alone is insufficient: a position/history label must not drift.
        old_factors = {r["case_id"]: (r["panel"], r["factors"]) for r in old["diagnostic"]["results"]}
        new_factors = {r["case_id"]: (r["panel"], r["factors"]) for r in new["diagnostic"]["results"]}
        if old_factors != new_factors:
            raise ValueError("cross-seed diagnostic factors differ")
        arms[arm] = {
            "counts": {name: {"seed42_correct": sum(before[name].values()),
                              "current_correct": sum(after[name].values()), "total": total}
                       for name, total in PANELS.items()},
            "case_changes_vs_seed42": {name: differences(before[name], after[name]) for name in PANELS},
            "blocked_attempts": {"seed42": blocked_attempts(old), "current": blocked_attempts(new)},
        }
    return {
        "scope": "One completed R1 training seed versus historical seed42 on reused development cases",
        "seed": seed, "run_binding": deepcopy(audited["run_binding"]),
        "episodes_replayed": audited["episodes_replayed"], "arms": arms,
        "original_screening": {"seed42": deepcopy(original["comparisons"]),
                               "current": deepcopy(audited["comparisons"])},
        "initial_adapter_sha256": audited["initial_adapter_sha256"],
        "seed42_initialization": "not recorded by historical runner; no inferred fingerprint",
        "three_seed_review": {"status": "separate", "entrypoint": "review_coverage_replication.py",
                              "required_seeds": [42, 43, 44]},
        "representative_checkpoint_seed": 42, "new_model_calls": 0, "test_episodes": 0,
        "limits": [
            "Two-seed differences are descriptive; no stability, significance or independent-task claim",
            "Original gates are unchanged; passing an old screen does not establish candidate admission",
            "Correlated blocked-write cases are retained, not summed again across pair comparisons",
            "No best-seed selection, score pooling or reserved-test evaluation",
        ],
    }


def training_observation(training):
    """Read observed R1 counters and timer only after the caller's complete audit."""
    report = read(training / "report.json")
    rows = read_jsonl(training / "training.jsonl")
    totals = report["processed"]
    if (len(rows) != 126 or report["steps"] != 126
            or totals["decisions"] != 1008 or totals["supervised_tokens"] != 41788
            or any(rows[-1][key] != value for key, value in totals.items())):
        raise ValueError("training observation counters differ from completed R1")
    seconds = report["optimization_seconds"]
    elapsed = [row["elapsed_seconds"] for row in rows]
    if (type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds <= 0
            or any(type(value) not in (int, float) or not math.isfinite(value) or value <= 0 for value in elapsed)
            or any(right <= left for left, right in zip(elapsed, elapsed[1:]))
            or elapsed[-1] > seconds):
        raise ValueError("invalid optimization timer observation")
    return {"optimizer_steps": report["steps"], "sample_uses": totals["decisions"],
            "supervised_tokens": totals["supervised_tokens"],
            "input_tokens_including_targets": totals["input_tokens"],
            "optimization_loop_seconds": seconds,
            "timer_limit": "Excludes model load, longest-example probe, final save and reload; not cloud billable time",
            "source_sha256": {name: sha256(training / name) for name in ("report.json", "training.jsonl")}}


def review(run, prepared, diagnostic, replication, seed, tokenizer):
    require_seed(seed, executing=True)
    audited = audit(run, prepared, diagnostic, replication, seed, tokenizer)
    if audited != read(run / "comparison.json"):
        raise ValueError("saved new-seed comparison differs from complete replay")
    historical = ROOT / "reports/qwen-state-coverage-2026-09-29"
    original = audit_original(historical, prepared, diagnostic, verify_weights=False)
    if original != {**read(historical / "comparison.json"), "adapter_files_verified": False}:
        raise ValueError("historical comparison differs from metadata replay")
    result = summarize(seed, audited, original)
    result["training"] = {arm: training_observation(run / "training" / arm) for arm in ARMS}
    result["source_sha256"] = {"seed42_comparison": sha256(historical / "comparison.json"),
                               "current_comparison": sha256(run / "comparison.json")}
    result["verification"] = {"current_actual_weights": True, "current_native_and_environment_replay": True,
                              "current_token_ids": True, "seed42_metadata_replay": True,
                              "seed42_actual_weights_rechecked": False}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir", "replication-dir", "tokenizer-dir", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--seed", type=int, choices=RUN_SEEDS, required=True)
    args = parser.parse_args()
    result = review(args.run_dir, args.prepared_dir, args.diagnostic_dir,
                    args.replication_dir, args.seed, args.tokenizer_dir)
    dump_new(args.output, result)
    print({"output": str(args.output), "seed": args.seed, "new_model_calls": 0,
           "original_passing_pairs": result["original_screening"]["current"]["passing_pairs"]})
