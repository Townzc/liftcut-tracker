"""R1: evaluate a seed-bound adapter with the original greedy dev protocol."""
import argparse
from contextlib import ExitStack
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from state_coverage import ARMS, ROOT, config
from prepare_coverage_replication import VERSION, REVIEWED, RUN_SEEDS, arm_binding, require_binding, runtime_metadata, schedules, verify_prepared
from prepare_state_diagnostics import verify_prepared as verify_diagnostics
from state_diagnostics import REVIEWED as DIAGNOSTIC_PLAN, load_prepared, run_suite
from coverage_rollout import run_normal
from gpu_state_diagnostics import PRECISION, PARSER, read
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.model_policy import encode
from liftcut_agent.qwen_transport import QwenTransport
from server_workspace import command, dump_new, sha256


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("model-dir", "model-manifest", "prepared-dir", "diagnostic-dir", "training-dir", "output-dir", "replication-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--arm", choices=ARMS, required=True)
    p.add_argument("--seed", type=int, choices=RUN_SEEDS, required=True)
    p.add_argument("--expected-code-commit", required=True)
    p.add_argument("--allow-gpu", action="store_true")
    args = p.parse_args()
    if not args.allow_gpu or args.output_dir.exists() or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("explicit GPU flag, fresh output and committed clean checkout required")
    plan = verify_prepared(args.prepared_dir, args.diagnostic_dir, args.replication_dir, args.seed)
    verify_diagnostics(args.diagnostic_dir)
    model_manifest, trained, tm = read(args.model_manifest), read(args.training_dir / "report.json"), read(args.training_dir / "manifest.json")
    commit = command(["git", "rev-parse", "HEAD"], ROOT)
    if commit != args.expected_code_commit:
        raise ValueError("unexpected execution commit")
    binding = arm_binding(plan, commit, args.arm)
    require_binding(tm.get("binding"), binding)
    require_binding(trained.get("binding"), binding)
    if (model_manifest != read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json")
            or tm["model"] != model_manifest or tm["code_commit"] != commit or tm["arm"] != args.arm
            or trained["arm"] != args.arm or tm["plan"] != plan or trained["reload_close"] is not True):
        raise ValueError("model/training provenance mismatch")
    for name, value in model_manifest["files"].items():
        if Path(name).name != name or sha256(args.model_dir / name) != value["sha256"]:
            raise ValueError("model file mismatch")
    adapter = args.training_dir / "final"
    if set(trained["adapter_sha256"]) != {"adapter_config.json", "adapter_model.safetensors"}:
        raise ValueError("unexpected adapter inventory")
    for name, expected in trained["adapter_sha256"].items():
        if sha256(adapter / name) != expected:
            raise ValueError("trained adapter file mismatch")
    dump_new(args.output_dir / "manifest.json", {"version": VERSION, "arm": args.arm, "binding": binding,
        "code_commit": commit, "model": model_manifest, "adapter_sha256": trained["adapter_sha256"],
        "prepared_plan_sha256": sha256(REVIEWED), "diagnostic_plan_sha256": sha256(DIAGNOSTIC_PLAN),
        "parser_version": PARSER, "precision": PRECISION, "test_evaluation": False,
        "started_at_utc": datetime.now(timezone.utc).isoformat()})
    cfg, catalog, cases = config(), load_catalog(ROOT / "benchmark/catalog.json"), load_prepared(args.diagnostic_dir)
    dump_new(args.output_dir / "config.json", asdict(cfg))
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from peft import PeftModel, prepare_model_for_kbit_training
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise ValueError("CUDA BF16 required")
    dump_new(args.output_dir / "runtime.json", {"binding": binding, "runtime": runtime_metadata(torch, plan)})
    set_seed(plan["inference_seed"])
    torch.set_num_threads(8)
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False)
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                              bnb_4bit_compute_dtype=torch.bfloat16)
    base = AutoModelForCausalLM.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False,
        dtype=torch.bfloat16, quantization_config=quant, device_map={"": 0}, attn_implementation="sdpa")
    base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=False)
    model = PeftModel.from_pretrained(base, adapter, is_trainable=False, local_files_only=True)
    model.eval()
    model.config.use_cache = True
    for panel in ("normal", "diagnostic"):
        path = args.output_dir / panel
        path.mkdir()
        with ExitStack() as stack:
            streams = {n: stack.enter_context((path / (n + ".jsonl")).open("x", encoding="utf-8"))
                       for n in ("episodes", "calls", "generations")}

            def save(name, row):
                streams[name].write(encode(row) + "\n")
                streams[name].flush()

            transport = QwenTransport(model, tokenizer, cfg, lambda row: save("generations", row))
            callbacks = {"on_episode": lambda row: save("episodes", row),
                         "on_call": lambda identity, call: save("calls", {"case_id": identity, "call": call})}
            report, _ = (run_normal(catalog, lambda: transport, **callbacks) if panel == "normal" else
                         run_suite(cases, catalog, transport, **callbacks))
        dump_new(path / "report.json", report)
        print(encode({"arm": args.arm, "panel": panel, "result": report.get("panels", report.get("passed"))}), flush=True)


if __name__ == "__main__":
    main()
