"""Run normal and fixed-error development panels with pinned local Qwen weights."""
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path

from controlled_recovery import ROOT, config
from controlled_rollout import run_controlled
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.model_policy import encode
from liftcut_agent.qwen_transport import QwenTransport
from prepare_controlled import REVIEWED, verify_prepared
from server_workspace import command, dump_new, sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-manifest", type=Path, required=True)
    parser.add_argument("--prepared-dir", type=Path, required=True)
    parser.add_argument("--adapter-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--allow-gpu", action="store_true")
    args = parser.parse_args()
    if not args.allow_gpu or args.output_dir.exists() or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("explicit GPU flag, new output and clean committed checkout required")
    verify_prepared(args.prepared_dir)
    model_manifest = json.loads(args.model_manifest.read_text(encoding="utf-8"))
    expected = json.loads((ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json").read_text(encoding="utf-8"))
    cfg = config()
    if model_manifest != expected or model_manifest["revision"] != cfg.revision or model_manifest["model_id"] != cfg.model:
        raise ValueError("unexpected model inventory")
    for name, value in model_manifest["files"].items():
        if Path(name).name != name or sha256(args.model_dir / name) != value["sha256"]:
            raise ValueError("model file mismatch")
    adapter = ({name: sha256(args.adapter_dir / name) for name in ("adapter_config.json", "adapter_model.safetensors")}
               if args.adapter_dir else None)
    dump_new(args.output_dir / "manifest.json", {"code_commit": command(["git", "rev-parse", "HEAD"], ROOT),
        "model": model_manifest, "adapter_sha256": adapter, "prepared_plan_sha256": sha256(REVIEWED),
        "started_at_utc": datetime.now(timezone.utc).isoformat(), "parser_version": "qwen-native-content-v2",
        "precision": "NF4 double quantization/BF16 compute; fp32 nonquantized layers in every arm",
        "prefix_scope": "Scripted zero-usage prefix followed by model; prefix actions are not autonomous model outputs",
        "test_evaluation": False})
    dump_new(args.output_dir / "config.json", asdict(cfg))
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
    with (args.output_dir / "generations.jsonl").open("x", encoding="utf-8") as generations, \
            (args.output_dir / "episodes.jsonl").open("x", encoding="utf-8") as episodes:
        def save(stream, row):
            stream.write(encode(row) + "\n")
            stream.flush()
        transport = QwenTransport(model, tokenizer, cfg, lambda row: save(generations, row))
        report, _ = run_controlled(args.prepared_dir, load_catalog(ROOT / "benchmark/catalog.json"), transport,
                                   on_episode=lambda row: save(episodes, row))
    dump_new(args.output_dir / "report.json", report)
    print(encode(report["panels"]), flush=True)


if __name__ == "__main__":
    main()
