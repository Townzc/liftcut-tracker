"""CPU-only preparation and exact paired token schedule for recovery-v2."""
import argparse
from collections import Counter
import json
from pathlib import Path
import random
import subprocess
import sys

from controlled_recovery import DATA, ROOT, prepare
from recovery_dataset import load_frozen
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from gpu_pilot import validate_tokens
from server_workspace import dump_new, sha256

REVIEWED = ROOT / "reports/recovery-preparation-v2.json"


def schedules(directory):
    decisions = {v: read_jsonl(directory / "decisions" / v / "decisions.jsonl") for v in ("clean", "recovery")}
    tokens = {v: read_jsonl(directory / "tokens" / v / "tokens.jsonl") for v in decisions}
    train_ids = sorted(s["id"] for s in load_frozen(DATA) if s["split"] == "train")
    for variant in tokens:
        validate_tokens(tokens[variant])
        if len(tokens[variant]) != len(decisions[variant]):
            raise ValueError("token/decision length mismatch")
        if sorted({r["scenario_id"] for r in decisions[variant]}) != train_ids or any(r["split"] != "train" for r in decisions[variant]):
            raise ValueError("training rows differ from frozen training-only cases")
    if len(tokens["clean"]) != len(tokens["recovery"]):
        raise ValueError("unpaired decisions")
    for a, b, ta, tb in zip(decisions["clean"], decisions["recovery"], tokens["clean"], tokens["recovery"]):
        if a["pair_id"] != b["pair_id"] or ta["input_ids"][ta["prompt_tokens"]:] != tb["input_ids"][tb["prompt_tokens"]:]:
            raise ValueError("paired correct targets must be token-identical")
    result = {"clean": [], "mixed": []}
    rng = random.Random(42)
    for epoch in range(2):
        order = list(range(len(tokens["clean"])))
        rng.shuffle(order)
        for index in order:
            perturb = (train_ids.index(decisions["clean"][index]["scenario_id"]) + epoch) % 2 == 1
            result["clean"].append({"variant": "clean", "index": index})
            result["mixed"].append({"variant": "recovery" if perturb else "clean", "index": index})
    return result, tokens, decisions


def build_report(directory):
    schedule, tokens, decisions = schedules(directory)
    files = {path.relative_to(directory).as_posix(): sha256(path) for path in sorted(directory.rglob("*"))
             if path.is_file()}
    arms = {}
    for arm, selected in schedule.items():
        rows = [tokens[r["variant"]][r["index"]] for r in selected]
        arms[arm] = {"decisions": len(rows), "optimizer_steps": (len(rows) + 7) // 8,
            "supervised_tokens": sum(r["target_tokens"] for r in rows), "input_tokens": sum(len(r["input_ids"]) for r in rows),
            "max_sequence_tokens": max(len(r["input_ids"]) for r in rows), "schedule_sha256": digest(selected),
            "recovery_context_decisions": sum(r["variant"] == "recovery" and tokens["clean"][r["index"]]["input_ids"] !=
                                              tokens["recovery"][r["index"]]["input_ids"] for r in selected)}
    actions, target_counts = Counter(), Counter()
    for row, encoded in zip(decisions["clean"], tokens["clean"]):
        name = row["messages"][-1]["tool_calls"][0]["function"]["name"]
        actions[name] += 1
        target_counts[name] += encoded["target_tokens"]
    prefixes = read_jsonl(directory / "decisions/prefixes.jsonl")
    return {"version": "recovery-pilot-v2", "scope": "Corrected same-author synthetic development study; no test rollouts",
        "files": files, "frozen_manifest_sha256": sha256(DATA / "manifest.json"),
        "source_sha256": {name: sha256(ROOT / name) for name in ("controlled_recovery.py", "tokenize_decisions.py", "src/liftcut_agent/trajectories.py")},
        "training": {"seed": 42, "epochs": 2, "gradient_accumulation": 8, "micro_batch": 1, "learning_rate": .0002,
                     "lora_rank": 16, "lora_alpha": 32, "dropout": 0.0, "max_length": 4096,
                     "loss_reduction": "target-token mean per optimizer step", "checkpoints": "final_only_no_exact_resume"},
        "arms": arms, "unique_decisions_by_action": dict(sorted(actions.items())),
        "unique_target_tokens_by_action": dict(sorted(target_counts.items())),
        "evaluation": {"arms": ["unadapted", "clean", "mixed"], "normal_dev": 12, "prefix_dev": len(prefixes),
                       "prefix_types": dict(Counter(p["error_kind"] for p in prefixes)), "total_episodes": 3 * (12 + len(prefixes)),
                       "test_episodes": 0, "max_steps": 24, "max_output_tokens": 512, "max_context": 4096},
        "budget": {"hourly_cny": 2.18, "max_hours_from_boot": 4, "compute_proxy_cny": 8.72,
                   "total_planning_ceiling_cny": 10, "backup_margin_minutes": 30,
                   "reason": "Maintainer requested completing the formal study on the already-started instance; preparation consumes this window too"}}


def verify_prepared(directory):
    actual = build_report(directory)
    expected = json.loads(REVIEWED.read_text(encoding="utf-8"))
    if actual != expected:
        raise ValueError("prepared data differ from reviewed recovery-v2 plan")
    return actual


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--tokenizer-dir", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--write-initial-report", action="store_true")
    args = parser.parse_args()
    if not args.verify_only:
        if args.output_dir.exists() or args.tokenizer_dir is None:
            parser.error("new output directory and local tokenizer required")
        prepare(args.output_dir / "decisions")
        for variant in ("clean", "recovery"):
            subprocess.run([sys.executable, str(ROOT / "tokenize_decisions.py"), "--decisions-dir",
                str(args.output_dir / "decisions" / variant), "--tokenizer-dir", str(args.tokenizer_dir),
                "--output-dir", str(args.output_dir / "tokens" / variant), "--max-length", "4096"], check=True)
    result = build_report(args.output_dir)
    if args.write_initial_report:
        dump_new(REVIEWED, result)
    else:
        verify_prepared(args.output_dir)
    print(json.dumps({"arms": result["arms"], "evaluation": result["evaluation"]}, indent=2))
