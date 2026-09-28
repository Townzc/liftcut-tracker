"""Evaluate the fixed local interface on explicitly supplied dev/test cases."""

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest, validate_scenarios
from liftcut_agent.model_policy import RunBudget, encode
from liftcut_agent.model_runner import replay_model_suite, run_model_episode, run_model_suite, summarize
from liftcut_agent.protocol import ProtocolConfig
from liftcut_agent.qwen_transport import QwenTransport
from server_workspace import command, dump_new, sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-manifest", type=Path, required=True)
    parser.add_argument("--adapter-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cases", type=Path, action="append", help="Ordered dev/test files; repeat for multiple splits")
    parser.add_argument("--allow-gpu", action="store_true")
    args = parser.parse_args()
    if not args.allow_gpu:
        parser.error("--allow-gpu is required")
    if args.output_dir.exists():
        raise ValueError("output directory already exists")
    if command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("commit code before GPU execution")
    case_files = args.cases or [ROOT / "benchmark/interactive-dev.jsonl"]
    scenarios = [row for path in case_files for row in read_jsonl(path)]
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    validate_scenarios(scenarios, catalog)
    if not scenarios or any(row["split"] not in {"dev", "test"} for row in scenarios):
        raise ValueError("evaluation requires nonempty dev/test cases")
    scope = ("Local GPU on frozen synthetic dev/test cases; shared templates; not external generalization evidence"
             if args.cases else "Local GPU on 14 public dev cases; training overlap; not generalization evidence")
    pinned = json.loads((ROOT / "configs/qwen3-4b-tokenizer.json").read_text(encoding="utf-8"))
    manifest = json.loads(args.model_manifest.read_text(encoding="utf-8"))
    reviewed_model = json.loads((ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json").read_text(encoding="utf-8"))
    if manifest["files"] != reviewed_model["files"]:
        raise ValueError("model file inventory differs from pinned pilot weights")
    if manifest["revision"] != pinned["revision"] or manifest["model_id"] != pinned["model_id"]:
        raise ValueError("model identity mismatch")
    for name, expected in manifest["files"].items():
        if Path(name).name != name or sha256(args.model_dir / name) != expected["sha256"]:
            raise ValueError("model file mismatch")
    adapter = None
    if args.adapter_dir:
        adapter = {name: sha256(args.adapter_dir / name) for name in ("adapter_config.json", "adapter_model.safetensors")}
    args.output_dir.mkdir(parents=True, exist_ok=False)
    dump_new(args.output_dir / "manifest.json", {"started_at_utc": datetime.now(timezone.utc).isoformat(),
        "code_commit": command(["git", "rev-parse", "HEAD"], ROOT), "model": manifest,
        "adapter_sha256": adapter, "parser_version": "qwen-native-content-v2",
        "scope": scope,
        "case_files": [{"name": path.name, "sha256": sha256(path)} for path in case_files],
        "catalog_sha256": sha256(ROOT / "benchmark/catalog.json"),
        "precision": "NF4/BF16 compute; prepare_model_for_kbit_training fp32 nonquantized layers for both arms"})
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from peft import PeftModel, prepare_model_for_kbit_training
    set_seed(42)
    torch.set_num_threads(8)
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False)
    quantization = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                                     bnb_4bit_compute_dtype=torch.bfloat16)
    model = AutoModelForCausalLM.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False,
        dtype=torch.bfloat16, quantization_config=quantization, device_map={"": 0}, attn_implementation="sdpa")
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=False)
    if args.adapter_dir:
        model = PeftModel.from_pretrained(model, args.adapter_dir, is_trainable=False, local_files_only=True)
    model.eval()
    model.config.use_cache = True
    config = ProtocolConfig(model=pinned["model_id"], revision=pinned["revision"], temperature=0,
        max_output_tokens=512, max_requests=sum(s["max_steps"] for s in scenarios),
        max_reserved_output_tokens=512 * sum(s["max_steps"] for s in scenarios),
        tool_protocol="read_batch", prompt_revision="pending_approval_v1",
        pricing_note="Local rented GPU; no API charge; GPU uptime accounted separately in CNY")
    dump_new(args.output_dir / "config.json", asdict(config))
    with (args.output_dir / "generations.jsonl").open("x", encoding="utf-8") as generations, \
            (args.output_dir / "episodes.jsonl").open("x", encoding="utf-8") as episodes_file:
        def save(stream, row):
            stream.write(encode(row) + "\n")
            stream.flush()
        transport = QwenTransport(model, tokenizer, config, lambda row: save(generations, row))
        if args.cases:
            # Equal scenario-dependent proposal IDs across arms remove random
            # UUID spelling as an unintended tokenization/inference factor.
            budget, episodes = RunBudget(config), []
            for scenario in scenarios:
                episode = run_model_episode(scenario, catalog, config, transport, budget,
                                            episode_id=digest(scenario)[:32])
                episodes.append(episode)
                save(episodes_file, episode)
            report = summarize(scenarios, catalog, config, episodes, budget, mode="live")
        else:
            report, episodes = run_model_suite(scenarios, catalog, config, lambda: transport,
                mode="live", on_episode=lambda row: save(episodes_file, row))
    report["scope"] = scope
    report["cost_note"] = "No API spend; rented GPU uptime billed separately in CNY"
    report["replay"] = replay_model_suite(scenarios, catalog, config, episodes)
    dump_new(args.output_dir / "report.json", report)
    print(encode({key: report[key] for key in ("total", "passed", "requests", "policy_failures", "replay")}), flush=True)


if __name__ == "__main__":
    main()
