"""Replay and compare a COMPLETE three-arm recovery pilot; CPU only."""

import argparse
from collections import Counter
from decimal import Decimal
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import RunBudget
from liftcut_agent.model_runner import replay_model_suite, summarize
from liftcut_agent.protocol import load_config
from liftcut_agent.qwen_transport import parse_tool_message
from prepare_recovery import REVIEWED, schedules, verify_prepared
from recovery_dataset import DATA, load_frozen
from server_workspace import dump_new, sha256


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def audit_rollout(directory, scenarios, catalog):
    config = load_config(read(directory / "config.json"))
    episodes = read_jsonl(directory / "episodes.jsonl")
    report = read(directory / "report.json")
    replay = replay_model_suite(scenarios, catalog, config, episodes)
    if replay.get("replayed") != len(scenarios) or replay != report["replay"]:
        raise ValueError("incomplete or inconsistent evaluation")
    calls = [c for episode in episodes for c in episode["calls"]]
    generations = read_jsonl(directory / "generations.jsonl")
    if len(calls) != len(generations):
        raise ValueError("missing raw generation")
    for index, (call, generation) in enumerate(zip(calls, generations), 1):
        body = json.loads(call["response"]["body"])
        if generation["request_number"] != index or generation["elapsed_seconds"] != call["response"]["elapsed_seconds"]:
            raise ValueError("generation identity/timing mismatch")
        raw = generation["raw_text"]
        if raw is None:
            if (generation.get("model_called") is not False or generation["parse_error"] != "context_limit"
                    or body.get("local_guard") != "context_limit"
                    or generation["requested_prompt_tokens"] + config.max_output_tokens <= 4096):
                raise ValueError("invalid context rejection")
            message, reason = {"role": "assistant", "content": None, "tool_calls": []}, "local_context_limit"
        else:
            parsed = None
            if generation["eos_reached"]:
                try:
                    parsed = parse_tool_message(raw, index)
                except ValueError:
                    pass
            message = parsed or {"role": "assistant", "content": raw, "tool_calls": []}
            reason = "tool_calls" if parsed else "stop" if generation["eos_reached"] else "length"
        if body["choices"][0]["message"] != message or body["choices"][0]["finish_reason"] != reason:
            raise ValueError("raw generation does not match native response")
        if (body["usage"]["prompt_tokens"] != generation["prompt_tokens"]
                or body["usage"]["completion_tokens"] != len(generation["output_ids"])):
            raise ValueError("generation token accounting mismatch")
    budget = RunBudget(config)
    budget.reserved_output_tokens = len(calls) * config.max_output_tokens
    budget.reserved_usd = sum((Decimal(c["reservation"]["reserved_usd"]) for c in calls), Decimal(0))
    recomputed = summarize(scenarios, catalog, config, episodes, budget, mode="live")
    if any(report.get(key) != value for key, value in recomputed.items() if key != "scope"):
        raise ValueError("saved metrics differ from replay")
    return episodes, report, config


def audit(root, prepared):
    plan = verify_prepared(prepared)
    schedule, tokens, _ = schedules(prepared)
    scenarios = [s for s in load_frozen() if s["split"] == "dev"] + [s for s in load_frozen() if s["split"] == "test"]
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    manifests, configs, results = {}, {}, {}
    for arm in ("unadapted", "clean", "mixed"):
        directory = root / "evaluation" / arm
        manifest = read(directory / "manifest.json")
        if manifest["case_files"] != [{"name": f"{split}.jsonl", "sha256": sha256(DATA / f"{split}.jsonl")} for split in ("dev", "test")]:
            raise ValueError("evaluation split/hash mismatch")
        episodes, report, config = audit_rollout(directory, scenarios, catalog)
        if [e["trace"]["episode_id"] for e in episodes] != [digest(s)[:32] for s in scenarios]:
            raise ValueError("unmatched scenario-dependent evaluation episode IDs")
        if arm == "unadapted":
            if manifest["adapter_sha256"] is not None:
                raise ValueError("unadapted arm used an adapter")
        else:
            training = root / "training" / arm
            trained = read(training / "report.json")
            trained_manifest = read(training / "manifest.json")
            if (trained_manifest["plan"] != plan or trained_manifest["arm"] != arm
                    or trained_manifest["code_commit"] != manifest["code_commit"]
                    or trained_manifest["model"] != manifest["model"]
                    or not trained["reload_close"] or trained["changed_adapter_tensors"] <= 0):
                raise ValueError("training/evaluation provenance mismatch")
            actual_hashes = {name: sha256(training / "final" / name) for name in ("adapter_config.json", "adapter_model.safetensors")}
            if trained["adapter_sha256"] != actual_hashes or manifest["adapter_sha256"] != actual_hashes:
                raise ValueError("evaluation adapter differs from saved training artifact")
            logs = read_jsonl(training / "training.jsonl")
            rows = [tokens[r["variant"]][r["index"]] for r in schedule[arm]]
            if len(logs) != plan["arms"][arm]["optimizer_steps"] or trained["steps"] != len(logs):
                raise ValueError("training step count mismatch")
            totals = {"input_tokens": 0, "supervised_tokens": 0, "decisions": 0}
            for step, log in enumerate(logs, 1):
                for row in rows[(step - 1) * 8:step * 8]:
                    totals["input_tokens"] += len(row["input_ids"])
                    totals["supervised_tokens"] += row["target_tokens"]
                    totals["decisions"] += 1
                if (log["step"] != step or any(log[k] != v for k, v in totals.items())
                        or not math.isfinite(log["loss"]) or not math.isfinite(log["gradient_norm_before_clip"])):
                    raise ValueError("training sampler or finite-gradient audit failed")
            if trained["processed"] != totals:
                raise ValueError("training totals mismatch")
        manifests[arm], configs[arm] = manifest, config
        results[arm] = {}
        for split in ("dev", "test"):
            selected = [r for r, s in zip(report["results"], scenarios) if s["split"] == split]
            results[arm][split] = {"total": len(selected), "passed": sum(r["passed"] for r in selected),
                "clean_completions": sum(r["passed"] and r["clean_completion"] for r in selected),
                "blocked_write_attempts": sum(r["blocked_write_attempts"] for r in selected),
                "tool_errors": dict(sum((Counter(r["tool_errors"]) for r in selected), Counter())),
                "results": selected}
    pinned = json.loads((ROOT / "configs/qwen3-4b-tokenizer.json").read_text(encoding="utf-8"))
    for arm in manifests:
        if configs[arm] != configs["unadapted"]:
            raise ValueError("unmatched evaluation protocol")
        config = configs[arm]
        if (config.model != pinned["model_id"] or config.revision != pinned["revision"] or config.temperature != 0
                or config.max_output_tokens != 512 or config.tool_protocol != "read_batch"
                or config.prompt_revision != "pending_approval_v1" or config.max_requests != 24 * len(scenarios)):
            raise ValueError("evaluation deviates from pre-registered settings")
        for field in ("code_commit", "model", "catalog_sha256", "precision", "parser_version"):
            if manifests[arm][field] != manifests["unadapted"][field]:
                raise ValueError("unmatched evaluation source/precision")
    paired = {}
    for split in ("dev", "test"):
        pairs = Counter()
        changes = []
        for a, b in zip(results["clean"][split]["results"], results["mixed"][split]["results"]):
            pairs["both_passed" if a["passed"] and b["passed"] else "clean_only" if a["passed"] else "mixed_only" if b["passed"] else "both_failed"] += 1
            if a["passed"] != b["passed"]:
                changes.append({"scenario_id": a["scenario_id"], "clean_passed": a["passed"], "mixed_passed": b["passed"]})
        paired[split] = {"counts": dict(pairs), "changes": changes}
    return {"scope": "Single-seed descriptive pilot; two test bundles; no significance or external transfer claim",
            "reviewed_plan_sha256": sha256(REVIEWED), "arms": results, "paired_clean_mixed": paired}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--prepared-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit(args.run_dir, args.prepared_dir)
    if args.output:
        dump_new(args.output, result)
    print(json.dumps({"scope": result["scope"], "paired": result["paired_clean_mixed"]}, indent=2))
