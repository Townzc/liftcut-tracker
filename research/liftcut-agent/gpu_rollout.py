"""Evaluate the fixed local model/adapter interface on public development cases only."""

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.model_policy import encode
from liftcut_agent.model_runner import replay_model_suite, run_model_suite
from liftcut_agent.protocol import ProtocolConfig
from liftcut_agent.qwen_transport import QwenTransport
from server_workspace import command, dump_new, sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-manifest", type=Path, required=True)
    parser.add_argument("--adapter-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--allow-gpu", action="store_true")
    args = parser.parse_args()
    if not args.allow_gpu:
        parser.error("--allow-gpu is required")
    if args.output_dir.exists():
        raise ValueError("output directory already exists")
    if command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("commit code before GPU execution")
    pinned = json.loads((ROOT / "configs/qwen3-4b-tokenizer.json").read_text())
    manifest = json.loads(args.model_manifest.read_text())
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
        "scope": "All 14 public development cases; adapter saw eight of these cases; not held-out",
        "cases_sha256": sha256(ROOT / "benchmark/interactive-dev.jsonl"),
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
        max_output_tokens=512, max_requests=336, max_reserved_output_tokens=172032,
        tool_protocol="read_batch", prompt_revision="pending_approval_v1",
        pricing_note="Local rented GPU; no API charge; GPU uptime accounted separately in CNY")
    dump_new(args.output_dir / "config.json", asdict(config))
    scenarios = read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    with (args.output_dir / "generations.jsonl").open("x", encoding="utf-8") as generations, \
            (args.output_dir / "episodes.jsonl").open("x", encoding="utf-8") as episodes_file:
        def save(stream, row):
            stream.write(encode(row) + "\n")
            stream.flush()
        transport = QwenTransport(model, tokenizer, config, lambda row: save(generations, row))
        report, episodes = run_model_suite(scenarios, catalog, config, lambda: transport,
            mode="live", on_episode=lambda row: save(episodes_file, row))
    report["scope"] = "Local GPU on 14 public dev cases; training overlap; not generalization evidence"
    report["cost_note"] = "No API spend; rented GPU uptime billed separately in CNY"
    report["replay"] = replay_model_suite(scenarios, catalog, config, episodes)
    dump_new(args.output_dir / "report.json", report)
    print(encode({key: report[key] for key in ("total", "passed", "requests", "policy_failures", "replay")}), flush=True)


if __name__ == "__main__":
    main()
