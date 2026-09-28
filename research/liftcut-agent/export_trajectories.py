"""Export audited positive development decisions, never held-out targets."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl, sha256
from liftcut_agent.model_policy import encode
from liftcut_agent.trajectories import export_decisions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--cases", type=Path, default=ROOT / "benchmark/interactive-dev.jsonl")
    parser.add_argument("--catalog", type=Path, default=ROOT / "benchmark/catalog.json")
    args = parser.parse_args()
    try:
        if args.output_dir.exists():
            raise ValueError("output directory already exists")
        summary, rows = export_decisions(args.run_dir, read_jsonl(args.cases), load_catalog(args.catalog),
                                        cases_sha256=sha256(args.cases), catalog_sha256=sha256(args.catalog))
        args.output_dir.mkdir(parents=True, exist_ok=False)
        path = args.output_dir / "decisions.jsonl"
        path.write_text("".join(encode(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
        summary["decisions_sha256"] = sha256(path)
        (args.output_dir / "manifest.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(encode(summary))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
