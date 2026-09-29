"""Replay a complete 38-state model comparison without importing GPU libraries."""
import argparse
from collections import Counter
from pathlib import Path
import re

from state_diagnostics import ROOT, REVIEWED, config, load_prepared, replay, summary
from prepare_state_diagnostics import verify_prepared
from gpu_state_diagnostics import expected_adapter, PARSER, PRECISION, read
from audit_controlled import audit_generations
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.model_policy import encode
from server_workspace import dump_new, sha256


def audit(run, prepared):
    verify_prepared(prepared)
    cases, catalog = load_prepared(prepared), load_catalog(ROOT / "benchmark/catalog.json")
    reports, manifests = {}, {}
    for arm in ("clean", "mixed"):
        directory = run / "evaluation" / arm
        manifest = read(directory / "manifest.json")
        expected = {"version": "state-diagnostics-v1", "arm": arm, "adapter_sha256": expected_adapter(arm),
            "prepared_plan_sha256": sha256(REVIEWED), "parser_version": PARSER, "precision": PRECISION,
            "test_evaluation": False, "training_steps": 0, "max_requests_per_case": 3, "max_requests_arm": 57,
            "model": read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json")}
        if any(manifest.get(k) != v for k, v in expected.items()) or not re.fullmatch(r"[0-9a-f]{40}", manifest["code_commit"]):
            raise ValueError("diagnostic model/adapter/configuration provenance mismatch")
        if read(directory / "config.json") != config().manifest()["config"]:
            raise ValueError("wrong diagnostic policy config")
        episodes = read_jsonl(directory / "episodes.jsonl")
        checked = replay(cases, catalog, episodes)
        result = summary(cases, episodes)
        result["replay"] = checked
        if result != read(directory / "report.json"):
            raise ValueError("diagnostic report differs from replay")
        indexed_calls = [{"case_id": e["case_id"], "call": c} for e in episodes
                         for c in e["calls"][e["scripted_prefix_calls"]:]]
        if indexed_calls != read_jsonl(directory / "calls.jsonl"):
            raise ValueError("durable live calls differ from complete episodes")
        generations = read_jsonl(directory / "generations.jsonl")
        audit_generations([c["call"] for c in indexed_calls], generations)
        result["actual_model_generations"] = sum(g.get("model_called", True) for g in generations)
        result["local_context_guards"] = sum(not g.get("model_called", True) for g in generations)
        reports[arm], manifests[arm] = result, manifest
    if manifests["clean"]["code_commit"] != manifests["mixed"]["code_commit"]:
        raise ValueError("different diagnostic source commits")
    paired = {}
    for panel in ("consent", "memory"):
        counts = Counter({"both_correct": 0, "clean_only": 0, "mixed_only": 0, "both_wrong": 0})
        for a, b in zip(reports["clean"]["results"], reports["mixed"]["results"]):
            if a["panel"] != panel:
                continue
            counts["both_correct" if a["correct"] and b["correct"] else "clean_only" if a["correct"]
                   else "mixed_only" if b["correct"] else "both_wrong"] += 1
        paired[panel] = dict(counts)
    return {"scope": "Exploratory related development states; no independent generalization claim",
        "total_states_replayed": 38, "arms": reports, "paired": paired,
        "adapter_files_rechecked_during_this_audit": False,
        "provenance_limit": "Replays recorded evidence; does not authenticate model authorship or provider billing"}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run-dir", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = audit(args.run_dir, args.prepared_dir)
    if args.output:
        dump_new(args.output, result)
    print(encode({"total_states_replayed": result["total_states_replayed"], "paired": result["paired"]}))
