"""Compare four complete audited protocol arms without making network requests."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl, sha256
from liftcut_agent.comparison import compare_runs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.output and args.output.exists():
            raise ValueError("output already exists")
        cases, catalog = ROOT / "benchmark/interactive-dev.jsonl", ROOT / "benchmark/catalog.json"
        report = compare_runs(args.run_root, read_jsonl(cases), load_catalog(catalog),
                              cases_sha256=sha256(cases), catalog_sha256=sha256(catalog))
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x", encoding="utf-8", newline="\n") as stream:
                json.dump(report, stream, ensure_ascii=False, allow_nan=False, indent=2)
                stream.write("\n")
        print(json.dumps({name: {key: arm[key] for key in ("passed", "total", "requests", "executed_tool_steps",
                         "accepted_batch_responses", "estimated_cost_usd")} for name, arm in report["arms"].items()}, indent=2))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
