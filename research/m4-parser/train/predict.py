"""Greedy predictions for an eval file, from the merged model or a GGUF file.

Both paths build the prompt text with the same tokenizer chat template, so the
quantized model sees byte-identical input. Output lines match evaluate.ts:
{"id", "output", "latencyMs"}. Latency here is server CPU/GPU time, not a phone.
"""
import argparse
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
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()
    if bool(args.model) == bool(args.gguf):
        raise SystemExit("pass exactly one of --model or --gguf")

    tok = AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True)
    rows = [json.loads(line) for line in Path(args.input).read_text(encoding="utf-8").splitlines() if line.strip()]
    prompts = [tok.apply_chat_template(r["messages"], tokenize=False, add_generation_prompt=True, enable_thinking=False) for r in rows]

    if args.model:
        import torch
        from transformers import AutoModelForCausalLM
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = AutoModelForCausalLM.from_pretrained(args.model, local_files_only=True).to(device).eval()
        end = tok.convert_tokens_to_ids("<|im_end|>")

        def generate(prompt):
            ids = tok(prompt, return_tensors="pt", add_special_tokens=False).input_ids.to(device)
            with torch.no_grad():
                out = model.generate(ids, max_new_tokens=args.max_new_tokens, do_sample=False, eos_token_id=end, pad_token_id=tok.pad_token_id)
            return tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True)
    else:
        from llama_cpp import Llama
        llm = Llama(model_path=args.gguf, n_ctx=1024, n_threads=args.threads, seed=0, verbose=False)

        def generate(prompt):
            # Raw completion on the template-rendered text; special tokens in it are parsed as such.
            result = llm.create_completion(prompt, max_tokens=args.max_new_tokens, temperature=0.0, stop=["<|im_end|>"])
            return result["choices"][0]["text"]

    with open(args.out, "w", encoding="utf-8") as f:
        for row, prompt in zip(rows, prompts):
            start = time.perf_counter()
            text = generate(prompt).strip()
            f.write(json.dumps({"id": row["id"], "output": text, "latencyMs": round((time.perf_counter() - start) * 1000, 1)}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
