"""Freeze D2 CPU contracts and pinned-tokenizer evidence without loading weights."""
import argparse
import json
from pathlib import Path

from counterfactual_diagnostics import ROOT, PANELS, config, load_prepared, prepare
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.trajectories import normalize_messages
from server_workspace import dump_new, sha256

REVIEWED = ROOT / "reports/counterfactual-diagnostic-preparation-v2.json"
SOURCES = ("counterfactual_diagnostics.py", "prepare_counterfactual_diagnostics.py",
           "state_diagnostics.py", "state_coverage.py", "controlled_recovery.py", "controlled_rollout.py",
           "src/liftcut_agent/benchmark.py", "src/liftcut_agent/environment.py", "src/liftcut_agent/interactive.py",
           "src/liftcut_agent/model_policy.py", "src/liftcut_agent/protocol.py", "src/liftcut_agent/workflow.py",
           "src/liftcut_agent/model_runner.py", "src/liftcut_agent/trajectories.py")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_tokenizer(directory):
    pinned = read(ROOT / "configs/qwen3-4b-tokenizer.json")
    if (read(directory / "tokenizer-provenance.json") != pinned or
            {p.name for p in directory.iterdir()} != set(pinned["file_sha256"]) | {"tokenizer-provenance.json"}
            or any(sha256(directory / name) != expected for name, expected in pinned["file_sha256"].items())):
        raise ValueError("D2 tokenizer files/provenance differ from pin")
    from transformers import AutoTokenizer
    return AutoTokenizer.from_pretrained(directory, local_files_only=True, trust_remote_code=False), pinned


def token_row(request, tokenizer):
    ids = tokenizer.apply_chat_template(normalize_messages(request["messages"]), tools=request["tools"],
                                        tokenize=True, add_generation_prompt=True)
    if request["max_completion_tokens"] != 512 or len(ids) + 512 > 4096:
        raise ValueError("D2 request exceeds context; truncation forbidden")
    return {"request_digest": digest(request), "prompt_ids_digest": digest(ids), "prompt_tokens": len(ids),
            "reserved_total_tokens": len(ids) + 512}


def tokenize(prepared, directory):
    cases = load_prepared(prepared)
    tokenizer, pinned = load_tokenizer(directory)
    episodes = read_jsonl(prepared / "reference-episodes.jsonl")
    rows = []
    for case, episode in zip(cases, episodes):
        handoff = token_row(case["prefix"]["next_request"], tokenizer)
        reference = [token_row(c["request"], tokenizer) for c in episode["calls"][episode["scripted_prefix_calls"]:]]
        if reference[0] != handoff:
            raise ValueError("reference first request differs from handoff")
        rows.append({"case_id": case["id"], "handoff": handoff, "reference_requests": reference})
    report = {"scope": "Real CPU tokenizer only; reference continuations are scripted, not model outcomes",
        "tokenizer": pinned, "max_context": 4096, "max_output_tokens": 512, "cases": 80,
        "max_handoff_prompt_tokens": max(r["handoff"]["prompt_tokens"] for r in rows),
        "max_reference_prompt_tokens": max(t["prompt_tokens"] for r in rows for t in r["reference_requests"]),
        "all_handoffs_and_references_fit": True, "truncation": False, "rows": rows,
        "later_model_requests": "Still require runtime context guard; scripted-reference lengths do not bound model continuations"}
    dump_new(prepared / "tokenizer-report.json", report)
    return report


def build_report(prepared):
    load_prepared(prepared)
    files = {p.name: sha256(p) for p in prepared.iterdir() if p.is_file()}
    if set(files) != {"cases.jsonl", "reference-episodes.jsonl", "reference-report.json", "manifest.json", "tokenizer-report.json"}:
        raise ValueError("unexpected D2 preparation inventory")
    return {"version": "counterfactual-diagnostic-preparation-v2", "files": dict(sorted(files.items())),
        "source_sha256": {name: sha256(ROOT / name) for name in SOURCES},
        "panels": PANELS, "fixed_adapter_seed": 42, "arms": ["s0", "t", "m", "tm"],
        "adapter_sha256": {arm: read(ROOT / f"reports/qwen-state-coverage-2026-09-29/training/{arm}/report.json")["adapter_sha256"]
                           for arm in ("s0", "t", "m", "tm")},
        "max_requests_four_arms": 544, "tokenizer": read(prepared / "tokenizer-report.json"),
        "training_steps": 0, "new_model_calls": 0, "reserved_test_reads": 0,
        "scope": "D2 CPU fixtures/scoring/token preparation only; not GPU orchestration readiness or model performance"}


def verify_prepared(prepared):
    result = build_report(prepared)
    if result != read(REVIEWED):
        raise ValueError("D2 preparation differs from reviewed exact files/sources")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--tokenizer-dir", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--write-initial-report", action="store_true")
    args = parser.parse_args()
    if not args.verify_only:
        if not args.tokenizer_dir:
            parser.error("local tokenizer required")
        prepare(args.output_dir)
        tokenize(args.output_dir, args.tokenizer_dir)
    if args.write_initial_report:
        result = build_report(args.output_dir)
        dump_new(REVIEWED, result)
    else:
        result = verify_prepared(args.output_dir)
    print(json.dumps({"cases": 80, "max_handoff": result["tokenizer"]["max_handoff_prompt_tokens"],
                      "max_reference": result["tokenizer"]["max_reference_prompt_tokens"], "new_model_calls": 0}))
