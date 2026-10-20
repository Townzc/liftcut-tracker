"""Greedy predictions for an eval file, from the merged model or a GGUF file.

Both paths build the prompt text with the same tokenizer chat template, so the
quantized model sees byte-identical input. Output lines match evaluate.ts:
{"id", "output", "latencyMs"}. Latency here is server CPU/GPU time, not a phone.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

from transformers import AutoTokenizer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tokenizer", required=True, help="directory with the tokenizer and chat template (the merged model)")
    ap.add_argument("--model", help="merged Hugging Face model directory")
    ap.add_argument("--gguf", help="GGUF file run with llama.cpp")
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=256)
    ap.add_argument("--threads", type=int, default=4, help="CPU threads for both generation and prompt processing")
    args = ap.parse_args()
    if bool(args.model) == bool(args.gguf):
        raise SystemExit("pass exactly one of --model or --gguf")
    if not 1 <= args.threads <= 16 or not 1 <= args.max_new_tokens <= 512:
        raise ValueError("threads must be 1..16 and max-new-tokens 1..512")

    tok = AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True)
    rows = [json.loads(line) for line in Path(args.input).read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows or any(not isinstance(r.get("id"), str) or not r["id"] for r in rows) or len({r["id"] for r in rows}) != len(rows):
        raise ValueError("evaluation needs nonempty unique IDs")
    if any(any(m["role"] not in ("system", "user") for m in r["messages"]) for r in rows):
        raise ValueError("evaluation input must not contain answers")
    prompts = [tok.apply_chat_template(r["messages"], tokenize=False, add_generation_prompt=True, enable_thinking=False) for r in rows]
    token_ids = [tok.encode(prompt, add_special_tokens=False) for prompt in prompts]
    if any(len(ids) + args.max_new_tokens > 1024 for ids in token_ids):
        raise ValueError("input plus output exceeds context; never silently truncate")
    if Path(args.out).exists() or Path(args.out + ".audit.json").exists():
        raise FileExistsError("prediction output already exists")
    llm = None

    if args.model:
        import torch
        from transformers import AutoModelForCausalLM
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = AutoModelForCausalLM.from_pretrained(args.model, local_files_only=True).to(device).eval()
        end = tok.convert_tokens_to_ids("<|im_end|>")

        def generate(tokens):
            ids = torch.tensor([tokens], dtype=torch.long, device=device)
            with torch.no_grad():
                out = model.generate(ids, attention_mask=torch.ones_like(ids), max_new_tokens=args.max_new_tokens,
                                     do_sample=False, num_beams=1, repetition_penalty=1.0,
                                     eos_token_id=end, pad_token_id=tok.pad_token_id)
            completion = out[0, ids.shape[1]:]
            stopped = bool(len(completion) and int(completion[-1]) == end)
            return {"text": tok.decode(completion, skip_special_tokens=True), "finishReason": "stop" if stopped else "length",
                    "usage": {"prompt_tokens": len(tokens), "completion_tokens": len(completion)}}
    else:
        from llama_cpp import Llama
        # The default prefill count uses host CPU count, which can exceed a
        # container's CPU quota even when generation is limited to four threads.
        llm = Llama(model_path=args.gguf, n_ctx=1024, n_threads=args.threads,
                    n_threads_batch=args.threads, seed=0, verbose=False)

        if any(llm.tokenize(prompt.encode(), add_bos=False, special=True) != ids for prompt, ids in zip(prompts, token_ids)):
            llm.close()
            raise ValueError("GGUF tokenizer does not match HF input token IDs")

        def generate(tokens):
            llm.reset()  # Each example starts without another example's KV state.
            result = llm.create_completion(tokens, max_tokens=args.max_new_tokens, temperature=0.0,
                                          repeat_penalty=1.0, frequency_penalty=0.0, presence_penalty=0.0,
                                          seed=0, stop=["<|im_end|>"])
            choice = result["choices"][0]
            return {"text": choice["text"], "finishReason": choice["finish_reason"], "usage": result["usage"]}

    try:
        with open(args.out + ".audit.json", "x", encoding="utf-8") as f:
            json.dump({"inputSha256": hashlib.sha256(Path(args.input).read_bytes()).hexdigest(),
                       "tokenIdsSha256": hashlib.sha256(json.dumps(token_ids).encode()).hexdigest(),
                       "items": len(rows), "maxInputTokens": max(map(len, token_ids)), "greedy": True,
                       "repetitionPenalty": 1, "maxNewTokens": args.max_new_tokens,
                       "engine": "gguf" if llm else "hf", "threads": args.threads if llm else None,
                       "prefillThreads": args.threads if llm else None, "resetBetweenItems": bool(llm)}, f, indent=2)
        with open(args.out, "x", encoding="utf-8") as f:
            for row, ids in zip(rows, token_ids):
                start = time.perf_counter()
                result = generate(ids)
                f.write(json.dumps({"id": row["id"], "output": result["text"].strip(),
                                   "finishReason": result["finishReason"], "usage": result["usage"],
                                   "latencyMs": round((time.perf_counter() - start) * 1000, 1)}, ensure_ascii=False) + "\n")
                f.flush()
    finally:
        if llm is not None:
            llm.close()


if __name__ == "__main__":
    main()
