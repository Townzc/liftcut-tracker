"""Re-tokenize recorded requests and decode actual saved output IDs; CPU only."""
import argparse
import importlib.metadata
from pathlib import Path

from gpu_state_diagnostics import read
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import encode
from liftcut_agent.trajectories import normalize_messages
from server_workspace import dump_new, sha256
from state_coverage import ARMS, ROOT


def audit_calls(calls, generations, tokenizer):
    if len(calls) != len(generations):
        raise ValueError("missing calls or generations in token audit")
    checked = []
    for call, generation in zip(calls, generations):
        request = call["request"]
        limit = request["max_completion_tokens"]
        if limit != 512:
            raise ValueError("output token limit differs from frozen coverage configuration")
        ids = tokenizer.apply_chat_template(normalize_messages(request["messages"]),
            tools=request["tools"], tokenize=True, add_generation_prompt=True)
        output = generation["output_ids"]
        if any(type(t) is not int or t < 0 for t in output):
            raise ValueError("invalid saved output token ID")
        if generation["model_called"] is False:
            if (output or generation["raw_text"] is not None or generation["eos_reached"]
                    or generation["prompt_tokens"] != 0 or generation["parse_error"] != "context_limit"
                    or generation["requested_prompt_tokens"] != len(ids) or len(ids) + limit <= 4096):
                raise ValueError("saved context guard differs from actual prompt tokenization")
        else:
            if (generation["model_called"] is not True or generation["prompt_tokens"] != len(ids)
                    or len(ids) + limit > 4096 or not output or len(output) > limit):
                raise ValueError("saved generation token budget differs from actual prompt tokenization")
            if tokenizer.decode(output, skip_special_tokens=False) != generation["raw_text"]:
                raise ValueError("output token IDs do not decode to saved raw text")
            if generation["eos_reached"] != (output[-1] == tokenizer.eos_token_id):
                raise ValueError("saved EOS status differs from output token IDs")
        checked.append({"prompt_tokens": len(ids), "prompt_ids_sha256": digest(ids),
            "output_tokens": len(output), "output_ids_sha256": digest(output), "model_called": generation["model_called"]})
    return {"requests": len(checked), "actual_model_generations": sum(r["model_called"] for r in checked),
        "local_context_guards": sum(not r["model_called"] for r in checked),
        "generated_prompt_tokens": sum(r["prompt_tokens"] for r in checked if r["model_called"]),
        "completion_tokens": sum(r["output_tokens"] for r in checked), "checked_tokens_digest": digest(checked)}


def audit(run, directory):
    pinned = read(ROOT / "configs/qwen3-4b-tokenizer.json")
    if (read(directory / "tokenizer-provenance.json") != pinned or
            {p.name for p in directory.iterdir()} != set(pinned["file_sha256"]) | {"tokenizer-provenance.json"}):
        raise ValueError("unpinned tokenizer provenance or additional override files")
    for name, expected in pinned["file_sha256"].items():
        if sha256(directory / name) != expected:
            raise ValueError("tokenizer file hash mismatch")
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(directory, local_files_only=True, trust_remote_code=False)
    panels = {}
    for arm in ARMS:
        panels[arm] = {}
        for panel in ("normal", "diagnostic"):
            path = run / "evaluation" / arm / panel
            calls = read_jsonl(path / "calls.jsonl")
            generations = read_jsonl(path / "generations.jsonl")
            panels[arm][panel] = {**audit_calls([r["call"] for r in calls], generations, tokenizer),
                "calls_sha256": sha256(path / "calls.jsonl"), "generations_sha256": sha256(path / "generations.jsonl")}
    return {"scope": "CPU reconstruction of recorded prompts and output decoding; no new model call or provider provenance proof",
        "tokenizer_provenance": pinned,
        "libraries": {n: importlib.metadata.version(n) for n in ("transformers", "tokenizers", "jinja2")},
        "panels": panels, "new_model_calls": 0}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run-dir", type=Path, required=True)
    p.add_argument("--tokenizer-dir", type=Path, required=True)
    p.add_argument("--output", type=Path)
    p.add_argument("--check", type=Path)
    args = p.parse_args()
    if args.output and args.check:
        p.error("choose output or check")
    result = audit(args.run_dir, args.tokenizer_dir)
    if args.check and result != read(args.check):
        raise ValueError("recorded coverage token audit differs")
    if args.output:
        dump_new(args.output, result)
    print(encode({"tokens_verified": True, "new_model_calls": 0, "panels": result["panels"]}))
