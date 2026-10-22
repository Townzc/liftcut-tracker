"""Verify the sole prompt intervention and complete answer masks before loading weights."""
import argparse
import hashlib
import json
from pathlib import Path


def audit(data, tokenizer, systems, max_len=512):
    result, paired = {}, {}
    for name in ("T-train", "S-train", "dev-control", "dev"):
        path = Path(data) / (name + ".jsonl")
        rows = [json.loads(s) for s in path.read_text(encoding="utf8").splitlines()]
        if not rows or len({r["id"] for r in rows}) != len(rows):
            raise ValueError("nonempty unique IDs required")
        tokens, masks, answers, prefixes = [], [], 0, []
        system = systems["controlSystem" if name in ("T-train", "dev-control") else "alignedSystem"]
        for row in rows:
            m = row["messages"]
            if [v["role"] for v in m] != ["system", "user", "assistant"] or m[0]["content"] != system:
                raise ValueError("prompt contract mismatch")
            user = json.loads(m[1]["content"])
            if set(user) != {"exercises", "sentence"}:
                raise ValueError("training input allowlist changed")
            prompt = tokenizer.apply_chat_template(m[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
            p = tokenizer(prompt, add_special_tokens=False)["input_ids"]
            a = tokenizer(m[-1]["content"] + "<|im_end|>", add_special_tokens=False)["input_ids"]
            if not p or not a or len(p) + len(a) > max_len:
                raise ValueError("would truncate supervised tokens")
            # predict.py renders these same two roles; no assistant answer enters inference.
            if p != tokenizer.encode(prompt, add_special_tokens=False):
                raise ValueError("training/inference token IDs differ")
            tokens.append(p + a); masks.append([-100] * len(p) + a); prefixes.append(p); answers += len(a)
        paired[name] = [(r["id"], r["messages"][1:],) for r in rows]
        hash_ids = lambda v: hashlib.sha256(json.dumps(v, separators=(",", ":")).encode()).hexdigest()
        result[name] = {"rows": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "maxTokens": max(map(len, tokens)), "answerTokens": answers, "tokenIdsSha256": hash_ids(tokens),
            "maskSha256": hash_ids(masks), "promptTokenIdsSha256": hash_ids(prefixes), "truncated": 0}
    for control, aligned in (("T-train", "S-train"), ("dev-control", "dev")):
        if paired[control] != paired[aligned]:
            raise ValueError("IDs, sentences, catalogs, targets or order changed")
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    for name in ("data", "tokenizer", "expected", "out"):
        ap.add_argument("--" + name, required=True)
    args = ap.parse_args()
    from transformers import AutoTokenizer
    protocol = json.loads(Path(args.expected).read_text(encoding="utf8"))
    actual = audit(args.data, AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True), protocol["promptContract"])
    if actual != protocol["trainingInputAudit"]:
        raise ValueError("CPU-reviewed training tokens differ")
    with Path(args.out).open("x", encoding="utf8") as f:
        json.dump(actual, f, indent=2); f.write("\n")
    print(json.dumps({"verified": True, "modelCalls": 0}))
