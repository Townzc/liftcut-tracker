"""Inference only with the two previously verified recovery-v2 final adapters."""
import argparse
from contextlib import ExitStack
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path

from state_diagnostics import ROOT, REVIEWED, config, load_prepared, run_suite
from prepare_state_diagnostics import verify_prepared
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.model_policy import encode
from liftcut_agent.qwen_transport import QwenTransport
from server_workspace import command, dump_new, sha256

PRECISION = "NF4 double quantization/BF16 compute; fp32 nonquantized layers in every arm"
PARSER = "qwen-native-content-v2"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def expected_adapter(arm):
    if arm not in {"clean", "mixed"}:
        raise ValueError("diagnostics require one of the two frozen adapters")
    return read(ROOT / f"reports/qwen-controlled-recovery-2026-09-29/training/{arm}/report.json")["adapter_sha256"]


def verify_adapter(arm, directory):
    expected = expected_adapter(arm)
    if any(sha256(directory / name) != value for name, value in expected.items()):
        raise ValueError("adapter differs from completed recovery-v2")
    return expected


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model-dir", type=Path, required=True)
    p.add_argument("--model-manifest", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--adapter-dir", type=Path, required=True)
    p.add_argument("--arm", choices=("clean", "mixed"), required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--allow-gpu", action="store_true")
    args = p.parse_args()
    if not args.allow_gpu or args.output_dir.exists() or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("explicit GPU flag, fresh output and clean committed checkout required")
    verify_prepared(args.prepared_dir)
    cases = load_prepared(args.prepared_dir)
    model_manifest = read(args.model_manifest)
    if model_manifest != read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json"):
        raise ValueError("unexpected model inventory")
    for name, value in model_manifest["files"].items():
        if Path(name).name != name or sha256(args.model_dir / name) != value["sha256"]:
            raise ValueError("model file mismatch")
    adapter = verify_adapter(args.arm, args.adapter_dir)
    cfg = config()
    dump_new(args.output_dir / "manifest.json", {"version": "state-diagnostics-v1", "arm": args.arm,
        "code_commit": command(["git", "rev-parse", "HEAD"], ROOT), "model": model_manifest,
        "adapter_sha256": adapter, "prepared_plan_sha256": sha256(REVIEWED),
        "started_at_utc": datetime.now(timezone.utc).isoformat(), "parser_version": PARSER,
        "precision": PRECISION, "test_evaluation": False, "training_steps": 0,
        "max_requests_per_case": 3, "max_requests_arm": 57})
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
    model = PeftModel.from_pretrained(model, args.adapter_dir, is_trainable=False, local_files_only=True)
    model.eval()
    model.config.use_cache = True
    with ExitStack() as stack:
        streams = {name: stack.enter_context((args.output_dir / (name + ".jsonl")).open("x", encoding="utf-8"))
                   for name in ("generations", "episodes", "calls")}

        def save(name, row):
            streams[name].write(encode(row) + "\n")
            streams[name].flush()

        transport = QwenTransport(model, tokenizer, cfg, lambda row: save("generations", row))
        report, _ = run_suite(cases, load_catalog(ROOT / "benchmark/catalog.json"), transport,
            on_episode=lambda row: save("episodes", row),
            on_call=lambda identity, call: save("calls", {"case_id": identity, "call": call}))
    dump_new(args.output_dir / "report.json", report)
    print(encode(report["panels"]), flush=True)


if __name__ == "__main__":
    main()
