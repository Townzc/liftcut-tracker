"""Replay recovery-v2, preserving synthetic/model boundaries and paired outcomes."""
import argparse
from collections import Counter
import json
from pathlib import Path

from audit_recovery import audit_training_log
from controlled_recovery import ROOT, config, public_episode_id
from controlled_rollout import evaluation_cases, summarize_controlled
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_runner import replay_model_suite
from liftcut_agent.qwen_transport import parse_tool_message
from prepare_controlled import REVIEWED, schedules, verify_prepared
from server_workspace import dump_new, sha256


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def audit_generations(calls, generations):
    if len(calls) != len(generations):
        raise ValueError("native generations must cover model calls only, exactly once")
    for index, (call, generation) in enumerate(zip(calls, generations), 1):
        response = call["response"]
        body = json.loads(response["body"])
        if generation["request_number"] != index or generation["elapsed_seconds"] != response["elapsed_seconds"]:
            raise ValueError("generation index/timing mismatch")
        raw = generation["raw_text"]
        if raw is None:
            if (generation["model_called"] is not False or generation["parse_error"] != "context_limit"
                    or body.get("local_guard") != "context_limit" or generation["requested_prompt_tokens"] + 512 <= 4096):
                raise ValueError("invalid local generation guard")
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
        if (body["choices"][0]["message"] != message or body["choices"][0]["finish_reason"] != reason
                or body["usage"]["prompt_tokens"] != generation["prompt_tokens"]
                or body["usage"]["completion_tokens"] != len(generation["output_ids"])):
            raise ValueError("native text/action/token accounting mismatch")


def audit(root, prepared, *, verify_weights=True):
    plan = verify_prepared(prepared)
    schedule, tokens, _ = schedules(prepared)
    scenarios, prefixes = evaluation_cases(prepared)
    cfg, catalog = config(), load_catalog(ROOT / "benchmark/catalog.json")
    result, manifests, adapter_configs = {}, {}, {}
    for arm in ("unadapted", "clean", "mixed"):
        directory = root / "evaluation" / arm
        manifest = read(directory / "manifest.json")
        if manifest["prepared_plan_sha256"] != sha256(REVIEWED) or manifest["test_evaluation"] is not False:
            raise ValueError("wrong experiment plan/scope")
        if read(directory / "config.json") != cfg.manifest()["config"]:
            raise ValueError("wrong model protocol configuration")
        episodes = read_jsonl(directory / "episodes.jsonl")
        replay = replay_model_suite(scenarios, catalog, cfg, episodes)
        if replay.get("replayed") != len(scenarios):
            raise ValueError("incomplete controlled comparison")
        if [e["trace"]["episode_id"] for e in episodes] != [public_episode_id(s) for s in scenarios]:
            raise ValueError("episode identity depends on nonpublic data")
        actual = summarize_controlled(scenarios, prefixes, episodes)
        actual["replay"] = replay
        if actual != read(directory / "report.json"):
            raise ValueError("controlled report differs from replay")
        live_calls = [call for ep in episodes for call in ep["calls"][len(prefixes[ep["scenario_id"]]["calls"])
                      if ep["scenario_id"] in prefixes else 0:]]
        audit_generations(live_calls, read_jsonl(directory / "generations.jsonl"))
        if arm == "unadapted":
            if manifest["adapter_sha256"] is not None:
                raise ValueError("unadapted model must not load an adapter")
        else:
            training = root / "training" / arm
            trained, tm = read(training / "report.json"), read(training / "manifest.json")
            if (tm["plan"] != plan or tm["arm"] != arm or tm["code_commit"] != manifest["code_commit"]
                    or tm["model"] != manifest["model"] or not trained["reload_close"] or trained["changed_adapter_tensors"] <= 0):
                raise ValueError("training/evaluation provenance mismatch")
            audit_training_log(training, plan, [tokens[x["variant"]][x["index"]] for x in schedule[arm]], arm)
            if trained["adapter_sha256"] != manifest["adapter_sha256"]:
                raise ValueError("evaluation used different adapter")
            for name, expected in trained["adapter_sha256"].items():
                if (verify_weights or name != "adapter_model.safetensors") and sha256(training / "final" / name) != expected:
                    raise ValueError("adapter file mismatch")
            ac = read(training / "final/adapter_config.json")
            if any(ac[k] != v for k, v in {"r": 16, "lora_alpha": 32, "lora_dropout": 0.0,
                                          "bias": "none", "task_type": "CAUSAL_LM"}.items()):
                raise ValueError("adapter configuration differs from frozen settings")
            adapter_configs[arm] = {k: sorted(v) if isinstance(v, list) else v for k, v in ac.items()}
        result[arm], manifests[arm] = actual, manifest
    model = read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json")
    if adapter_configs["clean"] != adapter_configs["mixed"]:
        raise ValueError("SFT adapter configurations differ")
    for m in manifests.values():
        if m["model"] != model or any(m[k] != manifests["unadapted"][k] for k in ("code_commit", "precision", "parser_version")):
            raise ValueError("unmatched models/source/precision")
    paired = {}
    for panel in ("normal", "continuation"):
        before = [r for r in result["clean"]["results"] if r["panel"] == panel]
        after = [r for r in result["mixed"]["results"] if r["panel"] == panel]
        counts, changes = Counter({"both_passed": 0, "clean_only": 0, "mixed_only": 0, "both_failed": 0}), []
        for a, b in zip(before, after):
            if a["scenario_id"] != b["scenario_id"]:
                raise ValueError("unmatched paired cases")
            counts["both_passed" if a["passed"] and b["passed"] else "clean_only" if a["passed"] else
                   "mixed_only" if b["passed"] else "both_failed"] += 1
            if a["passed"] != b["passed"]:
                changes.append({"scenario_id": a["scenario_id"], "clean": a["passed"], "mixed": b["passed"]})
        paired[panel] = {"counts": dict(counts), "changes": changes}
    return {"scope": "Single-seed, same-author synthetic DEVELOPMENT; no independent/generalization claim",
            "adapter_files_verified": verify_weights, "episodes_replayed": 3 * len(scenarios), "test_episodes": 0,
            "arms": result, "paired_clean_mixed": paired}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run-dir", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--metadata-only", action="store_true")
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = audit(args.run_dir, args.prepared_dir, verify_weights=not args.metadata_only)
    if args.output:
        dump_new(args.output, result)
    print(json.dumps({"episodes_replayed": result["episodes_replayed"], "paired": result["paired_clean_mixed"]}, indent=2))
