"""LoRA fine-tune of the M4 sentence parser.

Loss is computed on the assistant JSON only. Seeds are fixed and the run never
touches the network: the base model must already be on disk. Writes the adapter,
a merged model for export, and train_metrics.json (losses, steps, seconds).
"""
import argparse
import json
import math
import random
import time
from pathlib import Path

import numpy as np
import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, get_linear_schedule_with_warmup


def read(path, limit=None):
    rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    return rows[:limit] if limit else rows


def encode(tok, messages, max_len):
    """Prompt tokens are masked with -100 so only the answer and its end marker are learned."""
    prompt = tok.apply_chat_template(messages[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    answer = messages[-1]["content"] + "<|im_end|>"
    p, a = tok(prompt, add_special_tokens=False)["input_ids"], tok(answer, add_special_tokens=False)["input_ids"]
    if len(p) + len(a) > max_len:
        raise ValueError(f"example longer than {max_len} tokens; raise --max-len instead of truncating answers")
    return {"input_ids": p + a, "labels": [-100] * len(p) + a}


def batches(examples, size, pad_id, shuffle, rng):
    order = list(range(len(examples)))
    if shuffle:
        rng.shuffle(order)
    for i in range(0, len(order), size):
        chunk = [examples[j] for j in order[i:i + size]]
        width = max(len(e["input_ids"]) for e in chunk)
        ids = torch.full((len(chunk), width), pad_id)
        labels = torch.full((len(chunk), width), -100)
        mask = torch.zeros((len(chunk), width), dtype=torch.long)
        for row, e in enumerate(chunk):
            n = len(e["input_ids"])
            ids[row, :n], labels[row, :n], mask[row, :n] = torch.tensor(e["input_ids"]), torch.tensor(e["labels"]), 1
        yield ids, labels, mask


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--train", required=True)
    ap.add_argument("--dev", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=20261019)
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--max-steps", type=int, default=0, help="stop after this many optimizer steps (smoke test)")
    ap.add_argument("--limit", type=int, default=0, help="use only the first N examples of each file (smoke test)")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--max-len", type=int, default=512)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--gradient-checkpointing", action="store_true")
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.use_deterministic_algorithms(True, warn_only=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    started = time.time()
    def progress(steps, state):
        temp = out / "progress.tmp"
        temp.write_text(json.dumps({"completedSteps": steps, "state": state,
                                   "seconds": round(time.time() - started, 1)}) + "\n")
        temp.replace(out / "progress.json")
    progress(0, "initializing")

    tok = AutoTokenizer.from_pretrained(args.base, local_files_only=True)
    dtype = torch.bfloat16 if args.device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=dtype, local_files_only=True).to(args.device)
    model = get_peft_model(model, LoraConfig(r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05, task_type="CAUSAL_LM",
                                             target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
    original_use_cache = model.config.use_cache
    if args.gradient_checkpointing:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False, "preserve_rng_state": True})
        model.config.use_cache = False
    train = [encode(tok, r["messages"], args.max_len) for r in read(args.train, args.limit or None)]
    dev = [encode(tok, r["messages"], args.max_len) for r in read(args.dev, args.limit or None)]
    steps_per_epoch = math.ceil(len(train) / args.batch)
    total = args.max_steps or math.ceil(steps_per_epoch * args.epochs)
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
    schedule = get_linear_schedule_with_warmup(optimizer, max(1, total // 20), total)
    rng = random.Random(args.seed)

    def dev_loss():
        model.eval()
        losses, tokens = 0.0, 0
        with torch.no_grad():
            for ids, labels, mask in batches(dev, args.batch, tok.pad_token_id, False, rng):
                n = int((labels[:, 1:] != -100).sum())
                losses += float(model(input_ids=ids.to(args.device), attention_mask=mask.to(args.device), labels=labels.to(args.device)).loss) * n
                tokens += n
        model.train()
        return losses / max(tokens, 1)

    log, step = [], 0
    progress(step, "training")
    model.train()
    while step < total:
        for ids, labels, mask in batches(train, args.batch, tok.pad_token_id, True, rng):
            loss = model(input_ids=ids.to(args.device), attention_mask=mask.to(args.device), labels=labels.to(args.device)).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            progress(step, "optimizer-step-in-progress")
            optimizer.step()
            schedule.step()
            optimizer.zero_grad()
            step += 1
            progress(step, "training")
            if step % 10 == 0 or step == total:
                log.append({"step": step, "loss": round(float(loss), 5)})
                print(json.dumps(log[-1]), flush=True)
            if step >= total:
                break

    metrics = {"seed": args.seed, "steps": step, "train_examples": len(train), "dev_examples": len(dev), "batch": args.batch, "lr": args.lr,
               "rank": args.rank, "dtype": str(dtype), "device": args.device, "dev_loss": round(dev_loss(), 5), "log": log,
               "seconds": round(time.time() - started, 1), "gradientCheckpointing": args.gradient_checkpointing,
               "peakCudaAllocatedBytes": torch.cuda.max_memory_allocated() if args.device == "cuda" else None}
    # Training's cache setting must not disable KV caching in the exported parser.
    model.config.use_cache = original_use_cache
    if args.gradient_checkpointing:
        model.gradient_checkpointing_disable()
    model.save_pretrained(out / "adapter")
    merged = model.merge_and_unload()
    merged.save_pretrained(out / "merged", safe_serialization=True)
    tok.save_pretrained(out / "merged")
    (out / "train_metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    progress(step, "exported")
    print(json.dumps({k: v for k, v in metrics.items() if k != "log"}))


if __name__ == "__main__":
    main()
