"""Replay complete model runs, audit their reports and produce a cost ledger."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl, sha256
from liftcut_agent.run_audit import audit_run, build_ledger


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", action="append", type=Path, required=True, help="Repeat for distinct completed runs")
    parser.add_argument("--cases", type=Path, default=ROOT / "benchmark/interactive-dev.jsonl")
    parser.add_argument("--catalog", type=Path, default=ROOT / "benchmark/catalog.json")
    parser.add_argument("--output", type=Path, help="New JSON file; never overwrite existing evidence")
    args = parser.parse_args()
    try:
        if args.output and args.output.exists():
            raise ValueError("output already exists")
        scenarios = read_jsonl(args.cases)
        catalog = load_catalog(args.catalog)
        audits = [audit_run(path, scenarios, catalog, cases_sha256=sha256(args.cases), catalog_sha256=sha256(args.catalog))
                  for path in args.run_dir]
        ledger = build_ledger(audits)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x", encoding="utf-8", newline="\n") as stream:
                json.dump(ledger, stream, ensure_ascii=False, allow_nan=False, indent=2)
                stream.write("\n")
        print(json.dumps({key: value for key, value in ledger.items() if key != "runs"}, indent=2))
        return 0
    except (OSError, ValueError, TypeError, KeyError, RecursionError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
