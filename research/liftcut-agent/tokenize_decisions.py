"""CPU-only loss-mask audit with an explicitly supplied local tokenizer; no weights."""

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import read_json, read_jsonl, sha256
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import encode
from liftcut_agent.trajectories import target_tokens


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decisions-dir", type=Path, required=True)
    parser.add_argument("--tokenizer-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-length", type=int, default=8192)
    args = parser.parse_args()
    try:
        if args.output_dir.exists():
            raise ValueError("output directory already exists")
        if args.max_length < 1:
            raise ValueError("invalid max length")
        manifest = read_json((args.decisions_dir / "manifest.json").read_text(encoding="utf-8"))
        decisions = args.decisions_dir / "decisions.jsonl"
        rows = read_jsonl(decisions)
        if sha256(decisions) != manifest["decisions_sha256"] or digest(rows) != manifest["rows_digest"]:
            raise ValueError("decision export digest mismatch")
        provenance = read_json((args.tokenizer_dir / "tokenizer-provenance.json").read_text(encoding="utf-8"))
        if len(provenance["revision"]) != 40 or any(c not in "0123456789abcdef" for c in provenance["revision"]):
            raise ValueError("tokenizer revision must be an immutable commit")
        required = {"tokenizer.json", "tokenizer_config.json", "config.json"}
        if not required.issubset(provenance["file_sha256"]):
            raise ValueError("missing tokenizer/config provenance")
        actual_files = {path.name for path in args.tokenizer_dir.iterdir() if path.is_file()}
        if actual_files != set(provenance["file_sha256"]) | {"tokenizer-provenance.json"}:
            raise ValueError("untracked tokenizer files may override the pinned configuration")
        for name, expected in provenance["file_sha256"].items():
            if Path(name).name != name or sha256(args.tokenizer_dir / name) != expected:
                raise ValueError("tokenizer file provenance mismatch")
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(args.tokenizer_dir, local_files_only=True, trust_remote_code=False)
        tokenized, examples = [], []
        for row in rows:
            encoded = target_tokens(row, tokenizer, max_length=args.max_length)
            tokenized.append({"source_episode_id": row["source_episode_id"], "source_call_index": row["source_call_index"], **encoded})
            examples.append({"scenario_id": row["scenario_id"], "call_index": row["source_call_index"],
                             "prompt_tokens": encoded["prompt_tokens"], "target_tokens": encoded["target_tokens"],
                             "decoded_target": tokenizer.decode(encoded["input_ids"][encoded["prompt_tokens"]:])})
        report = {"scope": "CPU tokenizer and final-assistant mask audit; no weights, training or model evaluation",
                  "mask_version": "final-assistant-prefix-v0.1",
                  "implementation_sha256": sha256(ROOT / "src/liftcut_agent/trajectories.py"),
                  "source_run_id": manifest["source_run_id"], "decisions_sha256": sha256(decisions),
                  "tokenizer_provenance": provenance,
                  "chat_template_sha256": hashlib.sha256(tokenizer.chat_template.encode()).hexdigest(),
                  "libraries": {name: importlib.metadata.version(name) for name in ("transformers", "tokenizers", "jinja2")},
                  "decisions": len(rows), "prompt_tokens": sum(r["prompt_tokens"] for r in tokenized),
                  "supervised_tokens": sum(r["target_tokens"] for r in tokenized),
                  "max_sequence_tokens": max(len(r["input_ids"]) for r in tokenized),
                  "max_length": args.max_length, "truncated_decisions": 0,
                  "all_prefix_tokens_masked": all(all(v == -100 for v in r["labels"][:r["prompt_tokens"]]) for r in tokenized),
                  "examples": examples}
        args.output_dir.mkdir(parents=True, exist_ok=False)
        tokens_path = args.output_dir / "tokens.jsonl"
        tokens_path.write_text("".join(encode(row) + "\n" for row in tokenized), encoding="utf-8", newline="\n")
        report["tokens_sha256"] = sha256(tokens_path)
        (args.output_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(encode({k: v for k, v in report.items() if k not in {"examples", "tokenizer_provenance"}}))
        return 0
    except (OSError, ValueError, TypeError, KeyError, ImportError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
