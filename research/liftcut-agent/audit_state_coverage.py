"""Audit all four trained arms, native responses and fixed development gates."""
import argparse
from pathlib import Path
import re

from state_coverage import ARMS, ROOT, config, original
from prepare_state_coverage import GATES, REVIEWED, schedules, verify_prepared
from prepare_state_diagnostics import verify_prepared as verify_diagnostics
from state_diagnostics import REVIEWED as DIAGNOSTIC_PLAN, load_prepared, replay, summary
from coverage_rollout import normal_report
from audit_controlled import audit_generations
from audit_recovery import audit_training_log
from gpu_state_diagnostics import PARSER, PRECISION, read
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.model_policy import encode
from server_workspace import dump_new, sha256


def paired_comparisons(reports):
    def normal(arm):
        return {r["scenario_id"]: r["passed"] for r in reports[arm]["normal"]["results"]}

    def diagnostic(arm):
        return {r["case_id"]: r for r in reports[arm]["diagnostic"]["results"]}

    def differences(before, after, ids):
        gained = [i for i in ids if not before[i] and after[i]]
        lost = [i for i in ids if before[i] and not after[i]]
        return {"gained": gained, "lost": lost, "net": len(gained) - len(lost)}

    def blocked(arm):
        return reports[arm]["normal"]["blocked_write_attempts"] + sum(
            p["autonomous_blocked_writes"] for p in reports[arm]["diagnostic"]["panels"].values())

    ids = diagnostic("s0")
    read_ids = [i for i, r in ids.items() if r["panel"] == "consent" and r["factors"]["history"] == "read"]
    memory_ids = [i for i, r in ids.items() if r["panel"] == "memory" and r["factors"]["position"] is not None]
    if len(read_ids) != 3 or len(memory_ids) != 8:
        raise ValueError("wrong development screening denominators")
    comparisons, passed_pairs = {}, {}
    for factor in ("T", "M"):
        passed_pairs[factor] = []
        for before, after in GATES[factor]["pairs"]:
            a, b = diagnostic(before), diagnostic(after)
            if set(a) != set(b) or set(normal(before)) != set(normal(after)):
                raise ValueError("unpaired coverage evaluation")
            all_change = differences({i: r["correct"] for i, r in a.items()}, {i: r["correct"] for i, r in b.items()}, a)
            read_change = differences({i: a[i]["correct"] for i in read_ids}, {i: b[i]["correct"] for i in read_ids}, read_ids)
            memory_change = differences({i: a[i]["correct"] for i in memory_ids}, {i: b[i]["correct"] for i in memory_ids}, memory_ids)
            normal_change = differences(normal(before), normal(after), normal(before))
            clarifying_gains = [i for i in memory_change["gained"] if a[i]["factors"]["clarification"]]
            blocked_delta = blocked(after) - blocked(before)
            normal_a = {r["scenario_id"]: r for r in reports[before]["normal"]["results"]}
            normal_b = {r["scenario_id"]: r for r in reports[after]["normal"]["results"]}
            added_blocked = [i for i in a if b[i]["autonomous_blocked_writes"] > a[i]["autonomous_blocked_writes"]]
            added_blocked += [i for i in normal_a if normal_b[i]["blocked_write_attempts"] > normal_a[i]["blocked_write_attempts"]]
            passes = (normal_change["net"] >= -GATES["max_normal_net_loss"] and
                ((read_change["net"] >= GATES["T"]["read_consent_net_gain"] and not added_blocked) if factor == "T"
                 else (memory_change["net"] >= GATES["M"]["main_memory_net_gain"] and bool(clarifying_gains))))
            key = before + "->" + after
            comparisons[key] = {"factor": factor, "normal": normal_change, "all_diagnostic_changes": all_change,
                "read_consent": read_change, "main_memory": memory_change, "memory_clarification_gains": clarifying_gains,
                "autonomous_blocked_write_delta": blocked_delta, "cases_with_added_blocked_writes": added_blocked,
                "development_gate_passed": passes}
            if passes:
                passed_pairs[factor].append(key)
    counts = {a: {"normal": sum(normal(a).values()),
        "read_consent": sum(diagnostic(a)[i]["correct"] for i in read_ids),
        "main_memory": sum(diagnostic(a)[i]["correct"] for i in memory_ids)} for a in ARMS}
    return {"pairs": comparisons, "passing_pairs": passed_pairs,
        "factor_screen_passed": {f: bool(p) for f, p in passed_pairs.items()},
        "interaction_count_TM_minus_T_minus_M_plus_S0": {k: counts["tm"][k] - counts["t"][k] - counts["m"][k] + counts["s0"][k] for k in counts["s0"]},
        "limit": "Prespecified reused-development screening only; interactions are descriptive, not significance"}


def audit(run, prepared, diagnostic, *, verify_weights=True):
    plan = verify_prepared(prepared)
    verify_diagnostics(diagnostic)
    schedule, tokens, _ = schedules(prepared)
    catalog, scenarios, cases = load_catalog(ROOT / "benchmark/catalog.json"), original("dev"), load_prepared(diagnostic)
    reports, commits, configs = {}, set(), []
    model = read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json")
    for arm in ARMS:
        directory, training = run / "evaluation" / arm, run / "training" / arm
        manifest, trained, tm = read(directory / "manifest.json"), read(training / "report.json"), read(training / "manifest.json")
        expected = {"version": "state-coverage-evaluation-v1", "arm": arm, "model": model,
            "prepared_plan_sha256": sha256(REVIEWED), "diagnostic_plan_sha256": sha256(DIAGNOSTIC_PLAN),
            "parser_version": PARSER, "precision": PRECISION, "test_evaluation": False}
        if (any(manifest.get(k) != v for k, v in expected.items()) or not re.fullmatch(r"[0-9a-f]{40}", manifest["code_commit"])
                or tm["code_commit"] != manifest["code_commit"] or tm["model"] != model or tm["plan"] != plan
                or tm["arm"] != arm or trained["arm"] != arm or trained["reload_close"] is not True
                or trained["changed_adapter_tensors"] <= 0 or trained["adapter_sha256"] != manifest["adapter_sha256"]):
            raise ValueError("coverage model/training/evaluation provenance mismatch")
        commits.add(manifest["code_commit"])
        if read(directory / "config.json") != config().manifest()["config"]:
            raise ValueError("coverage policy configuration differs")
        audit_training_log(training, plan, [tokens[x["variant"]][x["index"]] for x in schedule[arm]], arm)
        if set(trained["adapter_sha256"]) != {"adapter_config.json", "adapter_model.safetensors"}:
            raise ValueError("unexpected trained adapter inventory")
        for name, expected_hash in trained["adapter_sha256"].items():
            if (verify_weights or name != "adapter_model.safetensors") and sha256(training / "final" / name) != expected_hash:
                raise ValueError("coverage adapter file mismatch")
        ac = read(training / "final/adapter_config.json")
        if any(ac[k] != v for k, v in {"r": 16, "lora_alpha": 32, "lora_dropout": 0.0,
                                      "bias": "none", "task_type": "CAUSAL_LM"}.items()):
            raise ValueError("coverage adapter configuration mismatch")
        configs.append({k: sorted(v) if isinstance(v, list) else v for k, v in ac.items()})
        panels = {}
        for panel in ("normal", "diagnostic"):
            path = directory / panel
            episodes = read_jsonl(path / "episodes.jsonl")
            if panel == "normal":
                result = normal_report(scenarios, catalog, episodes)
                indexed = [{"case_id": e["scenario_id"], "call": c} for e in episodes for c in e["calls"]]
            else:
                checked = replay(cases, catalog, episodes)
                result = {**summary(cases, episodes), "replay": checked}
                indexed = [{"case_id": e["case_id"], "call": c} for e in episodes for c in e["calls"][e["scripted_prefix_calls"]:]]
            if result != read(path / "report.json") or indexed != read_jsonl(path / "calls.jsonl"):
                raise ValueError("coverage report/durable calls differ from replay")
            generations = read_jsonl(path / "generations.jsonl")
            audit_generations([r["call"] for r in indexed], generations)
            result["actual_model_generations"] = sum(g.get("model_called", True) for g in generations)
            result["local_context_guards"] = sum(not g.get("model_called", True) for g in generations)
            panels[panel] = result
        reports[arm] = panels
    if len(commits) != 1 or any(c != configs[0] for c in configs):
        raise ValueError("unmatched source commits or adapter configurations")
    return {"scope": "Single-seed 2x2 state-coverage DEVELOPMENT study; no independent generalization claim",
        "episodes_replayed": 124, "test_episodes": 0, "adapter_files_verified": verify_weights,
        "arms": reports, "comparisons": paired_comparisons(reports)}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--metadata-only", action="store_true")
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = audit(args.run_dir, args.prepared_dir, args.diagnostic_dir, verify_weights=not args.metadata_only)
    if args.output:
        dump_new(args.output, result)
    print(encode({"episodes_replayed": result["episodes_replayed"], "comparisons": result["comparisons"]}))
