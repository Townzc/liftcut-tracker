"""G1: train a fresh paired T arm using the unchanged QLoRA procedure.

Versioned separately to preserve all historical runners and their source hashes.
"""

import argparse
from datetime import datetime, timezone
import gc
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.model_policy import encode
from liftcut_agent.interactive import digest
from prepare_g1 import ARMS, schedules
from g1_execution import verify_worker
from d2_execution import runtime
from server_workspace import command, dump_new, sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-manifest", type=Path, required=True)
    parser.add_argument("--prepared-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--arm", choices=ARMS, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--expected-code-commit", required=True)
    parser.add_argument("--allow-gpu", action="store_true")
    args = parser.parse_args()
    if not args.allow_gpu:
        parser.error("--allow-gpu required")
    if args.output_dir.exists() or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("new output and clean committed source required")
    plan, binding = verify_worker(args.run_dir, args.prepared_dir, args.expected_code_commit, args.arm)
    if args.output_dir.resolve() != (args.run_dir / "training" / args.arm).resolve():
        raise ValueError("training output outside its original window")
    schedule, tokens, _ = schedules(args.prepared_dir)
    rows = [tokens[item["variant"]][item["index"]] for item in schedule[args.arm]]
    pinned = json.loads((ROOT / "configs/qwen3-4b-tokenizer.json").read_text(encoding="utf-8"))
    manifest = json.loads(args.model_manifest.read_text(encoding="utf-8"))
    reviewed_model = json.loads((ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json").read_text(encoding="utf-8"))
    if manifest != reviewed_model:
        raise ValueError("model file inventory differs from pinned pilot weights")
    if any(manifest[key] != pinned[key] for key in ("model_id", "revision")):
        raise ValueError("pinned model identity mismatch")
    for name, entry in manifest["files"].items():
        if Path(name).name != name or sha256(args.model_dir / name) != entry["sha256"]:
            raise ValueError("model file integrity mismatch")
    args.output_dir.mkdir(parents=True, exist_ok=False)
    dump_new(args.output_dir / "manifest.json", {"arm": args.arm, "plan": plan, "binding": binding,
        "code_commit": command(["git", "rev-parse", "HEAD"], ROOT), "model": manifest,
        "started_at_utc": datetime.now(timezone.utc).isoformat()})
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from peft import LoraConfig, PeftModel, get_peft_model, prepare_model_for_kbit_training
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise ValueError("CUDA BF16 required")
    dump_new(args.output_dir / "runtime.json", {"binding": binding, "runtime": runtime(torch)})
    torch.set_num_threads(8)
    set_seed(42)
    quantization = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)

    def load_base():
        return AutoModelForCausalLM.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False,
            quantization_config=quantization, dtype=torch.bfloat16, device_map={"": 0}, attn_implementation="sdpa")

    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False)
    if tokenizer.chat_template is None:
        raise ValueError("missing pinned chat template")
    model = prepare_model_for_kbit_training(load_base(), use_gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False})
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, target_modules="all-linear",
        lora_dropout=0.0, bias="none", task_type="CAUSAL_LM"))
    model.config.use_cache = False
    parameters = [p for p in model.parameters() if p.requires_grad]
    initial = {name: p.detach().cpu().clone() for name, p in model.named_parameters() if p.requires_grad}
    optimizer = torch.optim.AdamW(parameters, lr=0.0002, weight_decay=0.0)

    def batch(row):
        return {key: torch.tensor([row[key]], device="cuda") for key in ("input_ids", "attention_mask", "labels")}

    def parameter_digest():
        checksum = hashlib.sha256()
        for name, parameter in sorted(model.named_parameters()):
            if parameter.requires_grad:
                if parameter.dtype != torch.float32:
                    raise ValueError("replication expects the original FP32 trainable adapters")
                checksum.update(encode([name, list(parameter.shape), str(parameter.dtype)]).encode())
                checksum.update(parameter.detach().cpu().numpy().tobytes())
        return checksum.hexdigest()

    initial_digest = parameter_digest()
    dump_new(args.output_dir / "initialization.json", {"binding": binding,
        "initialization_seed": 42, "post_probe_seed": 42,
        "initial_adapter_sha256": initial_digest})
    model.train()
    torch.cuda.reset_peak_memory_stats()
    longest = max(rows, key=lambda r: len(r["input_ids"]))
    probe = model(**batch(longest), use_cache=False)
    if not torch.isfinite(probe.loss).item():
        raise ValueError("longest-example probe has nonfinite loss")
    probe.loss.backward()
    torch.nn.utils.clip_grad_norm_(parameters, 1.0, error_if_nonfinite=True)
    if parameter_digest() != initial_digest:
        raise ValueError("memory probe changed adapter parameters")
    dump_new(args.output_dir / "memory-probe.json", {"sequence_tokens": len(longest["input_ids"]),
        "forward_backward_passed": True, "optimizer_steps": 0, "binding": binding,
        "initial_parameters_unchanged": True,
        "peak_allocated_bytes": torch.cuda.max_memory_allocated(), "peak_reserved_bytes": torch.cuda.max_memory_reserved()})
    del probe
    optimizer.zero_grad(set_to_none=True)
    set_seed(42)
    torch.cuda.reset_peak_memory_stats()
    started = time.monotonic()
    totals = {"input_tokens": 0, "supervised_tokens": 0, "decisions": 0}
    losses = []
    with (args.output_dir / "training.jsonl").open("x", encoding="utf-8") as log:
        for offset in range(0, len(rows), 8):
            group = rows[offset:offset + 8]
            count = sum(row["target_tokens"] for row in group)
            optimizer.zero_grad(set_to_none=True)
            value = 0.0
            for row in group:
                output = model(**batch(row), use_cache=False)
                loss = output.loss
                if not torch.isfinite(loss).item():
                    raise ValueError("nonfinite training loss")
                weight = row["target_tokens"] / count
                (loss * weight).backward()
                value += loss.item() * weight
                for key, amount in (("input_tokens", len(row["input_ids"])), ("supervised_tokens", row["target_tokens"]), ("decisions", 1)):
                    totals[key] += amount
                del output, loss
            norm = torch.nn.utils.clip_grad_norm_(parameters, 1.0, error_if_nonfinite=True)
            optimizer.step()
            torch.cuda.synchronize()
            losses.append(value)
            record = {"binding_digest": digest(binding), "step": len(losses), "loss": value, "gradient_norm_before_clip": norm.item(),
                      "elapsed_seconds": time.monotonic() - started, **totals}
            log.write(encode(record) + "\n")
            log.flush()
            print(encode(record), flush=True)
    elapsed = time.monotonic() - started
    changed = sum(not torch.equal(initial[name], p.detach().cpu()) for name, p in model.named_parameters() if p.requires_grad)
    if not changed or any(totals[key] != plan["arms"][args.arm][key] for key in totals):
        raise ValueError("training update or exact token budget mismatch")
    peak_allocated, peak_reserved = torch.cuda.max_memory_allocated(), torch.cuda.max_memory_reserved()
    final = args.output_dir / "final"
    model.save_pretrained(final, safe_serialization=True)
    model.eval()
    model.gradient_checkpointing_disable()
    model.config.use_cache = True
    with torch.inference_mode():
        reference = model(**batch(rows[0])).logits[:, -1, :].float().cpu()
    del parameters, initial, optimizer, model
    gc.collect()
    torch.cuda.empty_cache()
    base = prepare_model_for_kbit_training(load_base(), use_gradient_checkpointing=False)
    model = PeftModel.from_pretrained(base, final, is_trainable=False, local_files_only=True)
    model.eval()
    model.config.use_cache = True
    with torch.inference_mode():
        restored = model(**batch(rows[0])).logits[:, -1, :].float().cpu()
    difference = (reference - restored).abs().max().item()
    if not torch.allclose(reference, restored, atol=.001, rtol=.001):
        raise ValueError("adapter reload logits differ")
    dump_new(args.output_dir / "report.json", {"arm": args.arm, "binding": binding, "initial_adapter_sha256": initial_digest, "steps": len(losses), "processed": totals,
        "optimization_seconds": elapsed, "first_step_loss": losses[0], "last_step_loss": losses[-1],
        "changed_adapter_tensors": changed, "peak_allocated_bytes": peak_allocated, "peak_reserved_bytes": peak_reserved,
        "reload_close": True, "reload_max_logit_difference": difference,
        "adapter_sha256": {name: sha256(final / name) for name in ("adapter_config.json", "adapter_model.safetensors")},
        "finished_at_utc": datetime.now(timezone.utc).isoformat()})


if __name__ == "__main__":
    main()
