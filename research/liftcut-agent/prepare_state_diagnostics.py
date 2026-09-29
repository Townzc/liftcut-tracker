"""Reproduce fixed-state prefixes and real-tokenizer handoff limits on CPU."""
import argparse
import json
from pathlib import Path

from state_diagnostics import ROOT, REVIEWED, config, load_prepared, prepare
from liftcut_agent.interactive import digest
from liftcut_agent.trajectories import normalize_messages
from server_workspace import dump_new, sha256


def tokenize(prepared, tokenizer_dir):
    cases = load_prepared(prepared)
    pinned = json.loads((ROOT / "configs/qwen3-4b-tokenizer.json").read_text(encoding="utf-8"))
    provenance = json.loads((tokenizer_dir / "tokenizer-provenance.json").read_text(encoding="utf-8"))
    if any(provenance[k] != pinned[k] for k in ("model_id", "revision", "file_sha256")):
        raise ValueError("wrong tokenizer provenance")
    if {p.name for p in tokenizer_dir.iterdir() if p.is_file()} != set(pinned["file_sha256"]) | {"tokenizer-provenance.json"}:
        raise ValueError("unexpected tokenizer override file")
    for name, expected in pinned["file_sha256"].items():
        if sha256(tokenizer_dir / name) != expected:
            raise ValueError("tokenizer hash mismatch")
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_dir, local_files_only=True, trust_remote_code=False)
    rows = []
    for case in cases:
        request = case["prefix"]["next_request"]
        ids = tokenizer.apply_chat_template(normalize_messages(request["messages"]), tools=request["tools"],
                                            tokenize=True, add_generation_prompt=True)
        if len(ids) + config().max_output_tokens > 4096:
            raise ValueError("handoff exceeds context; no truncation permitted")
        rows.append({"case_id": case["id"], "request_digest": digest(request), "input_ids_digest": digest(ids),
                     "prompt_tokens": len(ids), "reserved_total_tokens": len(ids) + config().max_output_tokens})
    report = {"scope": "Real pinned tokenizer, CPU only; no weights or model inference",
        "tokenizer": {k: pinned[k] for k in ("model_id", "revision", "file_sha256")},
        "max_context": 4096, "max_output_tokens": config().max_output_tokens,
        "cases": len(rows), "max_prompt_tokens": max(r["prompt_tokens"] for r in rows),
        "all_handoffs_fit": True, "truncation": False, "rows": rows,
        "later_requests": "Runtime context guard applies after rereads; no guarantee that all subsequent prompts fit"}
    dump_new(prepared / "tokenizer-report.json", report)
    return report


def build_report(prepared):
    load_prepared(prepared)
    files = {p.relative_to(prepared).as_posix(): sha256(p) for p in sorted(prepared.rglob("*")) if p.is_file()}
    if set(files) != {"cases.jsonl", "reference-episodes.jsonl", "reference-report.json", "config.json", "manifest.json", "tokenizer-report.json"}:
        raise ValueError("unexpected diagnostic preparation inventory")
    tokens = json.loads((prepared / "tokenizer-report.json").read_text(encoding="utf-8"))
    return {"version": "state-diagnostic-preparation-v1", "files": files,
        "source_sha256": {name: sha256(ROOT / name) for name in ("state_diagnostics.py", "prepare_state_diagnostics.py")},
        "scope": "19 scripted development state contracts; reference success is not a model result",
        "states": {"consent": 10, "memory": 9}, "arms": ["clean", "mixed"], "max_requests": 114,
        "test_episodes": 0, "training_steps": 0, "tokenizer": tokens,
        "adapter_sha256": json.loads((ROOT / "reports/qwen-controlled-recovery-2026-09-29/adapter-metadata.json").read_text(encoding="utf-8")),
        "budget": {"hourly_cny_assumed": 2.18, "max_minutes_from_boot": 60,
            "inference_cutoff_minutes_from_boot": 35, "compute_proxy_cny": 2.18, "planning_reserve_cny": 3,
            "storage": "Provider billed separately; no new disk purchase in this window"}}


def verify_prepared(prepared):
    actual = build_report(prepared)
    if actual != json.loads(REVIEWED.read_text(encoding="utf-8")):
        raise ValueError("diagnostic data/tokens/source differ from reviewed preparation")
    return actual


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--tokenizer-dir", type=Path)
    p.add_argument("--verify-only", action="store_true")
    p.add_argument("--write-initial-report", action="store_true")
    args = p.parse_args()
    if not args.verify_only:
        if args.tokenizer_dir is None or args.output_dir.exists():
            p.error("new output directory and local tokenizer required")
        prepare(args.output_dir)
        tokenize(args.output_dir, args.tokenizer_dir)
    result = build_report(args.output_dir)
    if args.write_initial_report:
        dump_new(REVIEWED, result)
    else:
        verify_prepared(args.output_dir)
    print(json.dumps({"states": result["states"], "max_prompt_tokens": result["tokenizer"]["max_prompt_tokens"],
                      "budget": result["budget"]}, indent=2))
