"""Freeze four exactly paired target-token schedules using the real Qwen tokenizer."""
import argparse
import json
import math
from pathlib import Path
import random
import subprocess
import sys

from state_coverage import ARMS, DATA, ROOT, load_frozen, prepare
from gpu_pilot import validate_tokens
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from server_workspace import dump_new, sha256

REVIEWED = ROOT / "reports/state-coverage-preparation-v1.json"
GATES = {"T": {"pairs": [["s0", "t"], ["m", "tm"]], "read_consent_net_gain": 2,
               "no_added_autonomous_blocked_writes": True},
         "M": {"pairs": [["s0", "m"], ["t", "tm"]], "main_memory_net_gain": 3,
               "requires_memory_clarification_gain": True},
         "max_normal_net_loss": 1, "selection": "At least one prespecified pair per factor; report both and all regressions",
         "interpretation": "Reused development screening, not statistical significance or held-out evidence"}


def schedules(directory):
    frozen = load_frozen()
    rows = {a: read_jsonl(directory / "decisions" / a / "decisions.jsonl") for a in ARMS}
    tokens = {a: read_jsonl(directory / "tokens" / a / "tokens.jsonl") for a in ARMS}
    pair_ids = [r["pair_id"] for r in rows["s0"]]
    if len(set(pair_ids)) != len(pair_ids):
        raise ValueError("duplicate paired decision")
    for arm in ARMS:
        validate_tokens(tokens[arm])
        if (len(tokens[arm]) != len(pair_ids) or [r["pair_id"] for r in rows[arm]] != pair_ids
                or {r["scenario_id"] for r in rows[arm]} != {s["id"] for s in frozen[arm][0]}
                or any(r["split"] != "train" for r in rows[arm])):
            raise ValueError("coverage training scope or pair mismatch")
        for decision, encoded, baseline in zip(rows[arm], tokens[arm], tokens["s0"]):
            if (encoded["source_episode_id"] != decision["source_episode_id"]
                    or encoded["source_call_index"] != decision["source_call_index"]):
                raise ValueError("token/decision identity mismatch")
            if encoded["input_ids"][encoded["prompt_tokens"]:] != baseline["input_ids"][baseline["prompt_tokens"]:]:
                raise ValueError("four-arm correct targets must be token-identical")
    order, rng = [], random.Random(42)
    for _ in range(2):
        epoch = list(range(len(pair_ids)))
        rng.shuffle(epoch)
        order.extend(epoch)
    return {a: [{"variant": a, "index": i} for i in order] for a in ARMS}, tokens, rows


def build_report(directory):
    schedule, tokens, _ = schedules(directory)
    inventory = {p.relative_to(directory).as_posix(): sha256(p) for p in sorted(directory.rglob("*")) if p.is_file()}
    expected = {"decisions/manifest.json"} | {f"decisions/{a}/{n}" for a in ARMS for n in
        ("episodes.jsonl", "decisions.jsonl", "read-audit.jsonl", "config.json", "manifest.json")} | {
        f"tokens/{a}/{n}" for a in ARMS for n in ("tokens.jsonl", "report.json")}
    if set(inventory) != expected:
        raise ValueError("unexpected coverage preparation inventory")
    arms = {}
    for arm in ARMS:
        selected = [tokens[arm][s["index"]] for s in schedule[arm]]
        arms[arm] = {"decisions": len(selected), "optimizer_steps": math.ceil(len(selected) / 8),
            "supervised_tokens": sum(r["target_tokens"] for r in selected),
            "input_tokens": sum(len(r["input_ids"]) for r in selected),
            "max_sequence_tokens": max(len(r["input_ids"]) for r in selected),
            "sample_order_sha256": digest([s["index"] for s in schedule[arm]]),
            "target_schedule_sha256": digest([r["input_ids"][r["prompt_tokens"]:] for r in selected])}
    throughput = []
    for old in ("clean", "mixed"):
        report = json.loads((ROOT / f"reports/qwen-controlled-recovery-2026-09-29/training/{old}/report.json").read_text(encoding="utf-8"))
        throughput.append(report["processed"]["input_tokens"] / report["training_seconds_including_checkpoints"])
    seconds = sum(a["input_tokens"] for a in arms.values()) / min(throughput)
    return {"version": "state-coverage-preparation-v1", "files": inventory,
        "source_sha256": {name: sha256(ROOT / name) for name in ("state_coverage.py", "prepare_state_coverage.py",
            "tokenize_decisions.py", "src/liftcut_agent/trajectories.py")},
        "frozen_manifest_sha256": sha256(DATA / "manifest.json"),
        "scope": "Single-seed train-only 2x2 interventions, reused development evaluation",
        "training": {"seed": 42, "epochs": 2, "gradient_accumulation": 8, "micro_batch": 1,
            "learning_rate": .0002, "lora_rank": 16, "lora_alpha": 32, "dropout": 0.0, "max_length": 4096,
            "loss_reduction": "target-token mean per optimizer step", "checkpoints": "final_only_no_exact_resume"},
        "arms": arms, "coverage": json.loads((directory / "decisions/manifest.json").read_text(encoding="utf-8")),
        "evaluation": {"arms": list(ARMS), "normal_dev_per_arm": 12, "diagnostic_states_per_arm": 19,
            "total_episodes": 124, "test_episodes": 0, "normal_max_steps": 24, "diagnostic_max_requests": 3,
            "max_output_tokens": 512, "max_context": 4096, "gates": GATES},
        "runtime_estimate": {"source": "Slower observed v2 input-token throughput; linear proxy, not a guarantee",
            "input_tokens_per_second": min(throughput), "training_seconds_proxy": seconds,
            "training_minutes_with_20pct_margin": math.ceil(seconds * 1.2 / 60),
            "evaluation_minutes_reserved": 20, "load_probe_setup_minutes_reserved": 15, "backup_minutes_reserved": 30},
        "budget": {"hourly_cny_assumed": 2.18, "max_minutes_from_boot": 180,
            "work_cutoff_minutes_from_boot": 150, "compute_proxy_cny": 6.54,
            "planning_reserve_cny": 8, "storage": "Existing disk, no expansion; provider charges separately",
            "authorization": "Execution requires a maintainer-opened instance and agreed window; CPU preparation spends no GPU/API budget"}}


def verify_prepared(directory):
    actual = build_report(directory)
    if actual != json.loads(REVIEWED.read_text(encoding="utf-8")):
        raise ValueError("coverage preparation differs from reviewed data/tokens/source")
    return actual


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--tokenizer-dir", type=Path)
    p.add_argument("--verify-only", action="store_true")
    p.add_argument("--write-initial-report", action="store_true")
    args = p.parse_args()
    if not args.verify_only:
        if args.output_dir.exists() or args.tokenizer_dir is None:
            p.error("fresh output and pinned local tokenizer required")
        prepare(args.output_dir / "decisions")
        for arm in ARMS:
            subprocess.run([sys.executable, str(ROOT / "tokenize_decisions.py"), "--decisions-dir",
                str(args.output_dir / "decisions" / arm), "--tokenizer-dir", str(args.tokenizer_dir),
                "--output-dir", str(args.output_dir / "tokens" / arm), "--max-length", "4096"], check=True)
    result = build_report(args.output_dir)
    if args.write_initial_report:
        dump_new(REVIEWED, result)
    else:
        verify_prepared(args.output_dir)
    print(json.dumps({k: result[k] for k in ("arms", "runtime_estimate", "budget")}, indent=2))
