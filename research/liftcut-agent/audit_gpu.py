"""Offline consistency audit of published local GPU logs; no weights or GPU required."""

import argparse
from decimal import Decimal
import json
import math
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_json, read_jsonl
from liftcut_agent.model_policy import RunBudget
from liftcut_agent.model_runner import replay_model_suite, summarize
from liftcut_agent.protocol import load_config
from liftcut_agent.qwen_transport import parse_tool_message


def audit(root):
    adapter = read_json((root / "adapter-metadata.json").read_text(encoding="utf-8"))
    native_manifest = read_json((root / "native/adapter/manifest.json").read_text(encoding="utf-8"))
    if native_manifest["adapter_sha256"] != adapter["file_sha256"]:
        raise ValueError("development rollout used a different adapter than the backed-up checkpoint")
    scenarios = read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    stages = {"pilot/before": ["interactive-002", "interactive-008"],
              "pilot/after": ["interactive-002", "interactive-008"],
              "native/unadapted": [s["id"] for s in scenarios],
              "native/adapter": [s["id"] for s in scenarios]}
    results = {}
    for stage, ids in stages.items():
        directory = root / stage
        selected = [s for s in scenarios if s["id"] in ids]
        config = load_config(read_json((directory / "config.json").read_text(encoding="utf-8")))
        episodes = read_jsonl(directory / "episodes.jsonl")
        report = read_json((directory / "report.json").read_text(encoding="utf-8"))
        replay = replay_model_suite(selected, catalog, config, episodes)
        if replay != report["replay"] or replay.get("replayed") != len(ids):
            raise ValueError(f"{stage}: replay/report mismatch")
        calls = [call for episode in episodes for call in episode["calls"]]
        generations = read_jsonl(directory / "generations.jsonl")
        if len(generations) != len(calls):
            raise ValueError(f"{stage}: missing generation records")
        for index, (generation, call) in enumerate(zip(generations, calls), 1):
            body = read_json(call["response"]["body"])
            if generation["request_number"] != index or generation["elapsed_seconds"] != call["response"]["elapsed_seconds"]:
                raise ValueError("generation identity or timing mismatch")
            raw = generation["raw_text"]
            if raw is None:
                if (generation.get("model_called") is not False or generation["parse_error"] != "context_limit"
                        or body.get("local_guard") != "context_limit"
                        or generation["requested_prompt_tokens"] + config.max_output_tokens <= 4096):
                    raise ValueError("invalid local context rejection")
                expected = {"role": "assistant", "content": None, "tool_calls": []}
                reason = "local_context_limit"
            else:
                message = None
                if generation["eos_reached"]:
                    try:
                        message = parse_tool_message(raw, index)
                        if stage.startswith("pilot/") and message["content"] is not None:
                            message = None  # Preserve the original pure-tool parser's known defect.
                    except ValueError:
                        pass
                expected = message or {"role": "assistant", "content": raw, "tool_calls": []}
                reason = "tool_calls" if message else "stop" if generation["eos_reached"] else "length"
            if body["choices"][0]["message"] != expected or body["choices"][0]["finish_reason"] != reason:
                raise ValueError("raw generation / native message mismatch")
            if (body["usage"]["prompt_tokens"] != generation["prompt_tokens"]
                    or body["usage"]["completion_tokens"] != len(generation["output_ids"])):
                raise ValueError("raw generation token-count mismatch")
        budget = RunBudget(config)
        budget.reserved_output_tokens = len(calls) * config.max_output_tokens
        budget.reserved_usd = sum((Decimal(call["reservation"]["reserved_usd"]) for call in calls), Decimal(0))
        recomputed = summarize(selected, catalog, config, episodes, budget, mode="live")
        if any(report.get(key) != value for key, value in recomputed.items() if key != "scope"):
            raise ValueError(f"{stage}: report metrics do not match replayed episodes")
        results[stage] = {**replay, "recorded_generations": len(generations),
                         "local_context_rejections": sum(g["raw_text"] is None for g in generations)}

    report = read_json((root / "pilot/report.json").read_text(encoding="utf-8"))
    training = read_jsonl(root / "pilot/training.jsonl")
    if len(training) != report["steps"] or report["steps"] != 20:
        raise ValueError("unexpected training step count")
    examples = read_json((ROOT / "reports/qwen-mask-audit-2026-09-28.json").read_text(encoding="utf-8"))["examples"]
    rng, order, cursor = random.Random(42), list(range(len(examples))), len(examples)
    totals = {"input_tokens": 0, "supervised_tokens": 0, "decisions": 0}
    for step, record in enumerate(training, 1):
        for _ in range(8):
            if cursor == len(order):
                rng.shuffle(order)
                cursor = 0
            row = examples[order[cursor]]
            cursor += 1
            totals["input_tokens"] += row["prompt_tokens"] + row["target_tokens"]
            totals["supervised_tokens"] += row["target_tokens"]
            totals["decisions"] += 1
        if (record["step"] != step or any(record[key] != value for key, value in totals.items())
                or not math.isfinite(record["loss"]) or not math.isfinite(record["gradient_norm_before_clip"])):
            raise ValueError("training log / deterministic sampling mismatch")
    if (totals != report["processed"] or training[0]["loss"] != report["first_step_loss"]
            or training[-1]["loss"] != report["last_step_loss"]):
        raise ValueError("training summary mismatch")
    return {"scope": "Recorded-log consistency; not independent proof of hardware execution or generalization",
            "stages": results, "training_steps": len(training), "processed": totals}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-root", type=Path, default=ROOT / "reports/qwen-gpu-pilot-2026-09-28")
    args = parser.parse_args()
    try:
        print(json.dumps(audit(args.report_root), ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
