"""Fail before model loading on changed paired inputs or token truncation.

No model weights, network, training or inference. The same prompt/answer encoding
as the frozen sft.py is checked against the pre-reviewed CPU receipt.
"""
import argparse
import hashlib
import json
from pathlib import Path


def audit(data, tokenizer, max_len=512):
    result, paired = {}, {}
    for name in ("T-train", "S-train", "dev"):
        path = Path(data) / (name + ".jsonl")
        rows = [json.loads(s) for s in path.read_text(encoding="utf8").splitlines()]
        if not rows or len({r["id"] for r in rows}) != len(rows):
            raise ValueError("nonempty unique IDs required")
        tokens, answers = [], 0
        for row in rows:
            messages = row["messages"]
            if [m["role"] for m in messages] != ["system", "user", "assistant"]:
                raise ValueError("one system/user/assistant training example required")
            user = json.loads(messages[1]["content"])
            if set(user) != {"exercises", "sentence"}:
                raise ValueError("training input allowlist changed")
            prompt = tokenizer.apply_chat_template(messages[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
            p = tokenizer(prompt, add_special_tokens=False)["input_ids"]
            a = tokenizer(messages[-1]["content"] + "<|im_end|>", add_special_tokens=False)["input_ids"]
            if not a or len(p) + len(a) > max_len:
                raise ValueError("would truncate supervised tokens")
            tokens.append(p + a); answers += len(a)
        paired[name] = [(r["id"], r["messages"][0]["content"], json.loads(r["messages"][1]["content"])["sentence"], r["messages"][2]["content"]) for r in rows]
        result[name] = {"rows": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "maxTokens": max(map(len, tokens)), "answerTokens": answers,
            "tokenIdsSha256": hashlib.sha256(json.dumps(tokens, separators=(",", ":")).encode()).hexdigest(), "truncated": 0}
    if paired["T-train"] != paired["S-train"]:
        raise ValueError("paired IDs, sentences, systems or targets changed")
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    for name in ("data", "tokenizer", "expected", "out"):
        ap.add_argument("--" + name, required=True)
    args = ap.parse_args()
    from transformers import AutoTokenizer
    actual = audit(args.data, AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True))
    expected = json.loads(Path(args.expected).read_text(encoding="utf8"))["trainingInputAudit"]
    if actual != expected:
        raise ValueError("CPU-reviewed training tokens differ")
    with Path(args.out).open("x", encoding="utf8") as handle:
        json.dump(actual, handle, indent=2); handle.write("\n")
    print(json.dumps({"verified": True, "rows": {k: v["rows"] for k, v in actual.items()}, "modelCalls": 0}))
