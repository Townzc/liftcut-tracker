"""Bounded QLoRA compatibility pilot on public development data, not a quality study."""

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import gc
import importlib.metadata
import json
import math
from pathlib import Path
import random
import sys
import time

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.model_policy import encode
from liftcut_agent.model_runner import replay_model_suite, run_model_suite
from liftcut_agent.protocol import ProtocolConfig
from liftcut_agent.qwen_transport import QwenTransport
from server_workspace import command, dump_new, sha256


def validate_tokens(rows, max_length=4096):
    if not rows:
        raise ValueError("empty token data")
    for row in rows:
        ids, labels, prompt = row["input_ids"], row["labels"], row["prompt_tokens"]
        if (not 0 < prompt < len(ids) <= max_length or len(ids) != len(labels)
                or any(type(t) is not int or t < 0 for t in ids)
                or labels != [-100] * prompt + ids[prompt:]
                or row["attention_mask"] != [1] * len(ids)
                or row["target_tokens"] != len(ids) - prompt):
            raise ValueError("invalid final-assistant labels; no truncation or mask repair allowed")


def rollout(model, tokenizer, config, output):
    output.mkdir(exist_ok=False)
    scenarios = [s for s in read_jsonl(ROOT / "benchmark/interactive-dev.jsonl")
                 if s["id"] in {"interactive-002", "interactive-008"}]
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    dump_new(output / "config.json", asdict(config))
    with (output / "generations.jsonl").open("x", encoding="utf-8") as generations, \
            (output / "episodes.jsonl").open("x", encoding="utf-8") as episodes_file:
        def save(stream, record):
            stream.write(encode(record) + "\n")
            stream.flush()
        transport = QwenTransport(model, tokenizer, config, lambda row: save(generations, row))
        report, episodes = run_model_suite(scenarios, catalog, config, lambda: transport,
            mode="live", on_episode=lambda row: save(episodes_file, row))
    report["scope"] = "Local GPU compatibility on two selected public dev cases; not held-out or a causal SFT comparison"
    report["cost_note"] = "USD fields cover API requests only (none); GPU uptime is billed separately in CNY"
    report["replay"] = replay_model_suite(scenarios, catalog, config, episodes)
    dump_new(output / "report.json", report)
    return {"total": report["total"], "passed": report["passed"], "requests": report["requests"],
            "policy_failures": report["policy_failures"], "replay": report["replay"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-manifest", type=Path, required=True)
    parser.add_argument("--tokens-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--allow-gpu", action="store_true")
    args = parser.parse_args()
    if not args.allow_gpu or not 1 <= args.steps <= 20:
        parser.error("explicit --allow-gpu and 1..20 optimizer steps required")
    if args.output_dir.exists():
        raise ValueError("output directory already exists")
    commit = command(["git", "rev-parse", "HEAD"], ROOT)
    if command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("commit code before GPU execution")
    pinned = json.loads((ROOT / "configs/qwen3-4b-tokenizer.json").read_text(encoding="utf-8"))
    manifest = json.loads(args.model_manifest.read_text(encoding="utf-8"))
    if manifest["revision"] != pinned["revision"] or manifest["model_id"] != pinned["model_id"]:
        raise ValueError("model identity mismatch")
    for name, expected in manifest["files"].items():
        if Path(name).name != name or sha256(args.model_dir / name) != expected["sha256"]:
            raise ValueError("model integrity mismatch")
    tokens_file = args.tokens_dir / "tokens.jsonl"
    audit = json.loads((args.tokens_dir / "report.json").read_text(encoding="utf-8"))
    expected_audit = json.loads((ROOT / "reports/qwen-mask-audit-2026-09-28.json").read_text(encoding="utf-8"))
    if audit != expected_audit or sha256(tokens_file) != audit["tokens_sha256"]:
        raise ValueError("token data must reproduce the reviewed CPU audit exactly")
    rows = read_jsonl(tokens_file)
    validate_tokens(rows)
    args.output_dir.mkdir(parents=True, exist_ok=False)
    config = {"seed": 42, "steps": args.steps, "gradient_accumulation": 8, "micro_batch": 1,
              "learning_rate": 0.0002, "lora_rank": 16, "lora_alpha": 32, "dropout": 0.0,
              "target_modules": "all-linear", "quantization": "NF4 double quantization", "compute_dtype": "bfloat16",
              "max_length": 4096, "checkpoint_every_steps": 5, "loss_reduction": "target-token mean per optimizer step",
              "development_cases": ["interactive-002", "interactive-008"]}
    dump_new(args.output_dir / "manifest.json", {"code_commit": commit, "config": config,
        "started_at_utc": datetime.now(timezone.utc).isoformat(), "model": manifest,
        "tokens_sha256": sha256(tokens_file), "token_audit_sha256": sha256(args.tokens_dir / "report.json"),
        "scope": "Pipeline smoke using 59 public development decisions; repeated data; no generalization claim"})
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from peft import LoraConfig, PeftModel, get_peft_model, prepare_model_for_kbit_training
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise ValueError("CUDA with BF16 required")
    set_seed(42)
    torch.set_num_threads(8)
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False)
    quantization = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)

    def load_base():
        return AutoModelForCausalLM.from_pretrained(args.model_dir, local_files_only=True,
            trust_remote_code=False, quantization_config=quantization, dtype=torch.bfloat16,
            device_map={"": 0}, attn_implementation="sdpa")

    model = load_base()
    model.eval()
    protocol = ProtocolConfig(model=pinned["model_id"], revision=pinned["revision"], temperature=0,
        max_output_tokens=512, max_requests=48, max_reserved_output_tokens=24576,
        tool_protocol="read_batch", prompt_revision="pending_approval_v1",
        pricing_note="Local rented GPU; no API charge; instance cost recorded separately in CNY")
    before = rollout(model, tokenizer, protocol, args.output_dir / "before")
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True,
                                          gradient_checkpointing_kwargs={"use_reentrant": False})
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, target_modules="all-linear",
        lora_dropout=0.0, bias="none", task_type="CAUSAL_LM"))
    model.config.use_cache = False
    parameters = [p for p in model.parameters() if p.requires_grad]
    if not parameters:
        raise ValueError("no trainable parameters")
    initial = {name: p.detach().cpu().clone() for name, p in model.named_parameters() if p.requires_grad}
    optimizer = torch.optim.AdamW(parameters, lr=0.0002, weight_decay=0.0)
    rng = random.Random(42)
    order, cursor = list(range(len(rows))), len(rows)

    def next_row():
        nonlocal cursor
        if cursor == len(order):
            rng.shuffle(order)
            cursor = 0
        item = rows[order[cursor]]
        cursor += 1
        return item

    def batch(row):
        return {key: torch.tensor([row[key]], device="cuda") for key in ("input_ids", "attention_mask", "labels")}

    model.train()
    torch.cuda.reset_peak_memory_stats()
    started = time.monotonic()
    totals = {"input_tokens": 0, "supervised_tokens": 0, "decisions": 0}
    losses = []
    with (args.output_dir / "training.jsonl").open("x", encoding="utf-8") as log:
        for step in range(1, args.steps + 1):
            group = [next_row() for _ in range(8)]
            target_count = sum(row["target_tokens"] for row in group)
            optimizer.zero_grad(set_to_none=True)
            loss_value = 0.0
            for row in group:
                output = model(**batch(row), use_cache=False)
                loss = output.loss
                if not torch.isfinite(loss).item():
                    raise ValueError("nonfinite training loss")
                weight = row["target_tokens"] / target_count
                (loss * weight).backward()
                loss_value += loss.item() * weight
                totals["input_tokens"] += len(row["input_ids"])
                totals["supervised_tokens"] += row["target_tokens"]
                totals["decisions"] += 1
                del output, loss
            norm = torch.nn.utils.clip_grad_norm_(parameters, 1.0, error_if_nonfinite=True)
            optimizer.step()
            torch.cuda.synchronize()
            losses.append(loss_value)
            record = {"step": step, "loss": loss_value, "gradient_norm_before_clip": norm.item(),
                      "elapsed_seconds": time.monotonic() - started, **totals,
                      "peak_allocated_bytes": torch.cuda.max_memory_allocated(),
                      "peak_reserved_bytes": torch.cuda.max_memory_reserved()}
            log.write(encode(record) + "\n")
            log.flush()
            print(encode(record), flush=True)
            if step % 5 == 0 or step == args.steps:
                checkpoint = args.output_dir / f"checkpoint-{step}"
                model.save_pretrained(checkpoint, safe_serialization=True)
                torch.save({"step": step, "optimizer": optimizer.state_dict(), "sampler_order": order,
                    "sampler_cursor": cursor, "sampler_rng_state": rng.getstate(),
                    "torch_rng_state": torch.get_rng_state(), "cuda_rng_state": torch.cuda.get_rng_state_all()},
                    checkpoint / "optimizer-and-rng.pt")
    elapsed = time.monotonic() - started
    changed = sum(not torch.equal(initial[name], p.detach().cpu()) for name, p in model.named_parameters() if p.requires_grad)
    if not changed:
        raise ValueError("adapter parameters did not change")
    peak_allocated, peak_reserved = torch.cuda.max_memory_allocated(), torch.cuda.max_memory_reserved()
    model.eval()
    model.gradient_checkpointing_disable()
    model.config.use_cache = True
    probe = batch(rows[0])
    with torch.inference_mode():
        reference_logits = model(**probe).logits[:, -1, :].float().cpu()
    final = args.output_dir / f"checkpoint-{args.steps}"
    del probe, parameters, initial, optimizer, model
    gc.collect()
    torch.cuda.empty_cache()
    base = load_base()
    # k-bit preparation also restores fp32 nonquantized layers, matching training.
    base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=False)
    model = PeftModel.from_pretrained(base, final, is_trainable=False, local_files_only=True)
    model.eval()
    model.config.use_cache = True
    with torch.inference_mode():
        restored_logits = model(**batch(rows[0])).logits[:, -1, :].float().cpu()
    maximum_difference = (reference_logits - restored_logits).abs().max().item()
    if not torch.allclose(reference_logits, restored_logits, atol=0.001, rtol=0.001):
        raise ValueError(f"adapter reload logits mismatch: {maximum_difference}")
    after = rollout(model, tokenizer, protocol, args.output_dir / "after")
    report = {"scope": "Compatibility only; public dev data, no held-out test or SFT improvement claim",
        "steps": args.steps, "dataset_decisions": len(rows), "processed": totals,
        "training_seconds_including_checkpoints": elapsed,
        "input_tokens_per_second": totals["input_tokens"] / elapsed,
        "supervised_tokens_per_second": totals["supervised_tokens"] / elapsed,
        "first_step_loss": losses[0], "last_step_loss": losses[-1],
        "all_losses_finite": all(math.isfinite(loss) for loss in losses),
        "changed_adapter_tensors": changed, "peak_allocated_bytes": peak_allocated,
        "peak_reserved_bytes": peak_reserved, "reload_max_logit_difference": maximum_difference,
        "reload_close": True, "before": before, "after": after,
        "libraries": {name: importlib.metadata.version(name) for name in
                      ("torch", "transformers", "peft", "accelerate", "bitsandbytes")},
        "finished_at_utc": datetime.now(timezone.utc).isoformat()}
    dump_new(args.output_dir / "report.json", report)
    print(encode(report), flush=True)


if __name__ == "__main__":
    main()
