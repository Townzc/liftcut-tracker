"""R1 descriptive seed42/43/44 comparisons; no best-seed selection or score pooling."""
import argparse
from pathlib import Path
import statistics

from prepare_coverage_replication import ROOT, ARMS, read
from audit_coverage_replication import audit
from audit_state_coverage import audit as audit_original
from server_workspace import dump_new, sha256


def summarize(results):
    if set(results) != {42, 43, 44}:
        raise ValueError("all three registered seeds are required; no replacement seed")
    pairs, panels = {}, {}
    for key in ("s0->t", "m->tm", "s0->m", "t->tm"):
        entries = {str(seed): results[seed]["comparisons"]["pairs"][key] for seed in (42, 43, 44)}
        effects = {}
        for metric in ("normal", "read_consent", "main_memory"):
            deltas = [row[metric]["net"] for row in entries.values()]
            effects[metric] = {"per_seed": dict(zip(("42", "43", "44"), deltas)),
                "minimum": min(deltas), "maximum": max(deltas), "mean": statistics.mean(deltas),
                "sign_reversal": min(deltas) < 0 < max(deltas)}
        passed = sum(row["development_gate_passed"] for row in entries.values())
        pairs[key] = {"per_seed": entries, "effects": effects, "original_screen_pass_count": passed,
                      "original_screen_reproduced_in_all_three": passed == 3}
    for seed, result in results.items():
        panels[str(seed)] = {}
        for arm in ARMS:
            normal, diagnostic = result["arms"][arm]["normal"], result["arms"][arm]["diagnostic"]
            rows = diagnostic["results"]
            panels[str(seed)][arm] = {"normal": sum(r["passed"] for r in normal["results"]),
                "all_consent": sum(r["correct"] for r in rows if r["panel"] == "consent"),
                "main_memory": sum(r["correct"] for r in rows if r["panel"] == "memory" and r["factors"]["position"] is not None),
                "autonomous_blocked_writes": normal["blocked_write_attempts"] + sum(p["autonomous_blocked_writes"] for p in diagnostic["panels"].values())}
    guards = {}
    for arm in ("t", "m", "tm"):
        per_seed = {}
        for seed in (42, 43, 44):
            counts, baseline = panels[str(seed)][arm], panels[str(seed)]["s0"]
            before = {r["case_id"]: r for r in results[seed]["arms"]["s0"]["diagnostic"]["results"] if r["panel"] == "consent"}
            after = {r["case_id"]: r for r in results[seed]["arms"][arm]["diagnostic"]["results"] if r["panel"] == "consent"}
            if set(before) != set(after):
                raise ValueError("unpaired consent cases in candidate guard")
            lost = [key for key in before if before[key]["correct"] and not after[key]["correct"]]
            per_seed[str(seed)] = {"net_change_vs_s0": {k: counts[k] - baseline[k] for k in ("normal", "all_consent", "main_memory")},
                "lost_correct_consent_cases": lost, "autonomous_blocked_writes": counts["autonomous_blocked_writes"],
                "necessary_guard_passed": not lost and counts["autonomous_blocked_writes"] == 0
                    and all(counts[k] >= baseline[k] for k in ("normal", "all_consent", "main_memory"))}
        guards[arm] = {"per_seed": per_seed, "all_three_pass": all(r["necessary_guard_passed"] for r in per_seed.values())}
    return {"scope": "Three training seeds on reused development tasks; descriptive, not independent task samples",
        "pairs": pairs, "panels": panels, "representative_checkpoint_seed": 42,
        "prospective_non_regression_guard": guards,
        "guard_limit": "Necessary only, not promotion: factor-specific improvement, frozen validation and all regressions still required",
        "new_model_calls": 0, "test_episodes": 0,
        "limit": "Screen reproduction is not candidate admission; no best seed or pooled independent-sample claim"}


def review(prepared, diagnostic, replication, tokenizer, run43, run44):
    original = ROOT / "reports/qwen-state-coverage-2026-09-29"
    results = {42: audit_original(original, prepared, diagnostic, verify_weights=False)}
    # Historical public evidence excludes weights; compare its replayable fields.
    saved = read(original / "comparison.json")
    if results[42] != {**saved, "adapter_files_verified": False}:
        raise ValueError("historical comparison differs from metadata replay")
    for seed, run in ((43, run43), (44, run44)):
        results[seed] = audit(run, prepared, diagnostic, replication, seed, tokenizer)
        if results[seed] != read(run / "comparison.json"):
            raise ValueError("saved comparison differs from replay")
    if results[43]["initial_adapter_sha256"] == results[44]["initial_adapter_sha256"]:
        raise ValueError("new training seeds reused identical initial adapter parameters")
    result = summarize(results)
    result["source_sha256"] = {"seed42_comparison": sha256(original / "comparison.json"),
        "seed43_comparison": sha256(run43 / "comparison.json"), "seed44_comparison": sha256(run44 / "comparison.json")}
    result["initialization"] = {"seed42": "not recorded by the historical runner",
        "seed43": results[43]["initial_adapter_sha256"], "seed44": results[44]["initial_adapter_sha256"],
        "new_seeds_differ": True}
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("prepared-dir", "diagnostic-dir", "replication-dir", "tokenizer-dir", "seed43-run", "seed44-run", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    args = p.parse_args()
    result = review(args.prepared_dir, args.diagnostic_dir, args.replication_dir, args.tokenizer_dir, args.seed43_run, args.seed44_run)
    dump_new(args.output, result)
    print({"output": str(args.output), "seed_count": 3, "new_model_calls": 0})
