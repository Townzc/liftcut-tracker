"""Experimental CPU GGUF decoding, raw or G1; never repairs outputs or writes user data.

Run under an external hard timeout. The internal deadline is checked between
examples; the frozen v2 predictor and acceptance protocol remain unchanged.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
from closed_decode import label_grammar


def load_inputs(path):
    rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows or any(not isinstance(r, dict) or set(r) != {"id", "messages"}
                       or not isinstance(r["id"], str) or not r["id"] for r in rows):
        raise ValueError("Only nonempty evaluation ID and messages allowed")
    if len({r["id"] for r in rows}) != len(rows):
        raise ValueError("Nonempty unique evaluation IDs required")
    for row in rows:
        if not isinstance(row["messages"], list) or any(not isinstance(m, dict)
                or set(m) != {"role", "content"} or not isinstance(m["content"], str) for m in row["messages"]):
            raise ValueError("Invalid message shape")
        if [m["role"] for m in row["messages"]] != ["system", "user"]:
            raise ValueError("Evaluation input cannot contain answers or history")
        user = json.loads(row["messages"][1]["content"])
        if not isinstance(user, dict) or set(user) != {"exercises", "sentence"} or not isinstance(user["sentence"], str) or not 1 <= len(user["sentence"]) <= 400:
            raise ValueError("Only exercise names and a bounded sentence allowed")
        label_grammar(user["exercises"])  # Both arms accept the same bounded input.
    return rows


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1 << 20), b""): h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for key in ("gguf", "tokenizer", "input", "out", "model-sha256"):
        ap.add_argument("--" + key, required=True)
    ap.add_argument("--mode", choices=("free", "G1"), required=True)
    ap.add_argument("--max-seconds", type=int, default=600)
    args = ap.parse_args()
    if not 1 <= args.max_seconds <= 1800: raise ValueError("CPU budget must be 1..1800 seconds")
    out, audit = Path(args.out), Path(args.out + ".audit.json")
    if out.exists() or audit.exists(): raise FileExistsError("Use a new output path")
    rows = load_inputs(args.input)
    if sha(args.gguf) != args.model_sha256: raise ValueError("Model hash mismatch")
    import llama_cpp
    import transformers
    from check_grammar import boundaries
    if llama_cpp.__version__ != "0.3.36" or transformers.__version__ != "5.20.1": raise ValueError("Pinned runtime required")
    tok = transformers.AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True)
    prompts = [tok.apply_chat_template(r["messages"], tokenize=False, add_generation_prompt=True, enable_thinking=False) for r in rows]
    tokens = [tok.encode(p, add_special_tokens=False) for p in prompts]
    if any(len(ids) + 256 > 1024 for ids in tokens): raise ValueError("Context overflow; no truncation")
    started = time.monotonic()
    llm = llama_cpp.Llama(model_path=args.gguf, n_ctx=1024, n_gpu_layers=0, n_threads=4, n_threads_batch=4, seed=0, verbose=False)
    report = dict(mode=args.mode, state="running", modelSha256=args.model_sha256, inputSha256=sha(args.input), items=len(rows),
                  tokenIdsSha256=hashlib.sha256(json.dumps(tokens).encode()).hexdigest(), maxInputTokens=max(map(len, tokens)),
                  contextTokens=1024, maxNewTokens=256, threads=4, cpuOnly=True, modelCalls=0,
                  sources={name:sha(Path(__file__).with_name(name)) for name in ("closed_predict.py", "closed_decode.py", "check_grammar.py")})
    try:
        if any(llm.tokenize(p.encode(), add_bos=False, special=True) != t for p, t in zip(prompts, tokens)):
            raise ValueError("HF/GGUF input token mismatch")
        report["boundaries"] = boundaries(llm)
        with audit.open("x", encoding="utf-8") as f: json.dump(report, f, indent=2)
        with out.open("x", encoding="utf-8") as f:
            for row, ids in zip(rows, tokens):
                if time.monotonic() - started >= args.max_seconds: raise TimeoutError("CPU deadline reached")
                t0 = time.perf_counter()
                grammar_text = label_grammar(json.loads(row["messages"][1]["content"])["exercises"]) if args.mode == "G1" else None
                grammar = llama_cpp.LlamaGrammar.from_string(grammar_text, verbose=False) if grammar_text else None
                llm.reset()
                answer = llm.create_completion(ids, max_tokens=256, temperature=0.0, repeat_penalty=1.0,
                    frequency_penalty=0.0, presence_penalty=0.0, seed=0, stop=["<|im_end|>"], grammar=grammar)
                choice = answer["choices"][0]
                f.write(json.dumps(dict(id=row["id"], output=choice["text"].strip(), finishReason=choice["finish_reason"], usage=answer["usage"],
                    latencyMs=round((time.perf_counter()-t0)*1000, 1),
                    grammarSha256=hashlib.sha256(grammar_text.encode()).hexdigest() if grammar_text else None), ensure_ascii=False) + "\n")
                f.flush(); report["modelCalls"] += 1
        report["state"] = "complete"
    except BaseException as error:
        report.update(state="failed", error=repr(error)); raise
    finally:
        llm.close()
        report["seconds"] = round(time.monotonic()-started, 2)
        if audit.exists(): audit.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main()
