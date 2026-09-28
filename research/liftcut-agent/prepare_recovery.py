"""Reproduce the frozen CPU data, masks and exactly paired training schedule."""

import argparse
from collections import Counter
import json
from pathlib import Path
import random
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from recovery_dataset import DATA, load_frozen, prepare
from gpu_pilot import validate_tokens
from server_workspace import dump_new, sha256

REVIEWED = ROOT / "reports/recovery-preparation-v1.json"


def schedules(directory):
    decisions = {v: read_jsonl(directory / "decisions" / v / "decisions.jsonl") for v in ("clean", "recovery")}
    tokens = {v: read_jsonl(directory / "tokens" / v / "tokens.jsonl") for v in decisions}
    train_ids = {s["id"] for s in load_frozen() if s["split"] == "train"}
    for variant in tokens:
        validate_tokens(tokens[variant])
        if len(tokens[variant]) != len(decisions[variant]):
            raise ValueError("token/decision length mismatch")
        if {row["scenario_id"] for row in decisions[variant]} != train_ids:
            raise ValueError("training must contain exactly frozen train cases")
        if any(row["split"] != "train" for row in decisions[variant]):
            raise ValueError("held-out target leakage")
    if len(tokens["clean"]) != len(tokens["recovery"]):
        raise ValueError("unpaired training data")
    for a, b, ta, tb in zip(decisions["clean"], decisions["recovery"], tokens["clean"], tokens["recovery"]):
        if (a["pair_id"] != b["pair_id"] or ta["input_ids"][ta["prompt_tokens"]:] != tb["input_ids"][tb["prompt_tokens"]:]):
            raise ValueError("paired assistant targets must be token-identical")
    ids = sorted(train_ids)
    result = {"clean": [], "mixed": []}
    rng = random.Random(42)
    for epoch in range(2):
        order = list(range(len(tokens["clean"])))
        rng.shuffle(order)
        for index in order:
            # Every case appears clean in one epoch and perturbed in the other.
            recovery = (ids.index(decisions["clean"][index]["scenario_id"]) + epoch) % 2 == 1
            result["clean"].append({"variant": "clean", "index": index})
            result["mixed"].append({"variant": "recovery" if recovery else "clean", "index": index})
    return result, tokens, decisions


def build_report(directory):
    schedule, tokens, decisions = schedules(directory)
    files = {path.relative_to(directory).as_posix(): sha256(path)
             for path in sorted(directory.rglob("*")) if path.is_file() and path.name != "plan.json"}
    arms = {}
    for name, selected in schedule.items():
        rows = [tokens[r["variant"]][r["index"]] for r in selected]
        changed = sum(r["variant"] == "recovery" and tokens["clean"][r["index"]]["input_ids"] !=
                      tokens["recovery"][r["index"]]["input_ids"] for r in selected)
        arms[name] = {"decisions": len(rows), "optimizer_steps": (len(rows) + 7) // 8,
                      "input_tokens": sum(len(r["input_ids"]) for r in rows),
                      "supervised_tokens": sum(r["target_tokens"] for r in rows),
                      "max_sequence_tokens": max(len(r["input_ids"]) for r in rows),
                      "schedule_sha256": digest(selected), "recovery_context_decisions": changed,
                      "variants": dict(Counter(r["variant"] for r in selected))}
    if arms["clean"]["supervised_tokens"] != arms["mixed"]["supervised_tokens"]:
        raise ValueError("unmatched supervised budget")
    return {"version": "recovery-pilot-v1", "status": "CPU-prepared; GPU results pending",
        "scope": "Single seed, same-author synthetic bundle holdout, shared templates; no external generalization claim",
        "files": files, "frozen_manifest_sha256": sha256(DATA / "manifest.json"),
        "source_sha256": {name: sha256(ROOT / name) for name in
                           ("recovery_dataset.py", "tokenize_decisions.py", "src/liftcut_agent/trajectories.py")},
        "training": {"seed": 42, "epochs": 2, "gradient_accumulation": 8, "micro_batch": 1,
                     "learning_rate": 0.0002, "lora_rank": 16, "lora_alpha": 32, "dropout": 0.0,
                     "max_length": 4096, "loss_reduction": "target-token mean per optimizer step"},
        "arms": arms, "paired_training_decisions": len(decisions["clean"]),
        "evaluation": {"arms": ["unadapted", "clean", "mixed"], "dev_cases": 8, "test_cases": 16,
                       "total_episodes": 72, "max_steps_per_episode": 24, "max_output_tokens": 512,
                       "temperature": 0, "test_used_for_selection": False},
        "budget": {"hourly_cny": 2.18, "max_hours_from_boot": 2, "gpu_cap_cny_at_quote": 4.36,
                   "total_ceiling_cny": 10, "disk_expansion": False, "paid_api_calls": 0}}


def verify_prepared(directory, reviewed=REVIEWED):
    expected = json.loads(reviewed.read_text(encoding="utf-8"))
    actual = build_report(directory)
    if actual != expected:
        raise ValueError("prepared artifacts differ from the reviewed CPU plan")
    return actual


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--tokenizer-dir", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--reviewed-report", type=Path, default=REVIEWED)
    parser.add_argument("--write-initial-report", action="store_true")
    args = parser.parse_args()
    if not args.verify_only:
        if args.output_dir.exists():
            raise ValueError("refusing to overwrite preparation")
        if args.tokenizer_dir is None:
            parser.error("--tokenizer-dir required for preparation")
        prepare(args.output_dir / "decisions")
        for variant in ("clean", "recovery"):
            subprocess.run([sys.executable, str(ROOT / "tokenize_decisions.py"),
                "--decisions-dir", str(args.output_dir / "decisions" / variant),
                "--tokenizer-dir", str(args.tokenizer_dir), "--output-dir", str(args.output_dir / "tokens" / variant),
                "--max-length", "4096"], check=True)
    report = build_report(args.output_dir)
    if args.write_initial_report:
        dump_new(args.reviewed_report, report)
    else:
        verify_prepared(args.output_dir, args.reviewed_report)
    print(json.dumps({"verified": True, "arms": report["arms"], "evaluation": report["evaluation"]}, indent=2))


if __name__ == "__main__":
    main()
