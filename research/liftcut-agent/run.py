"""Run from any directory with Python 3.11+; no network, GPU or third-party packages."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from liftcut_agent.benchmark import (  # noqa: E402
    evaluate, load_catalog, read_jsonl, rule_baseline, sha256, validate_cases,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate", "baseline", "score"])
    parser.add_argument("--cases", type=Path, default=ROOT / "benchmark" / "dev-seeds.jsonl")
    parser.add_argument("--catalog", type=Path, default=ROOT / "benchmark" / "catalog.json")
    parser.add_argument("--predictions", type=Path, help="Required for score; JSONL prediction envelopes")
    parser.add_argument("--output", type=Path, help="Optional JSON report; existing files are not overwritten")
    parser.add_argument("--write-predictions", type=Path, help="Optional baseline prediction JSONL")
    args = parser.parse_args()
    if args.command == "score" and args.predictions is None:
        parser.error("score requires --predictions")
    if args.command != "score" and args.predictions is not None:
        parser.error("--predictions is only valid with score")
    if args.command != "baseline" and args.write_predictions is not None:
        parser.error("--write-predictions is only valid with baseline")
    try:
        destinations = [path for path in (args.output, args.write_predictions) if path is not None]
        if len({path.resolve() for path in destinations}) != len(destinations):
            raise ValueError("output destinations must differ")
        for path in destinations:
            if path.exists():
                raise ValueError(f"output already exists: {path}")
        catalog = load_catalog(args.catalog)
        cases = read_jsonl(args.cases)
        validate_cases(cases, catalog)
        hashes = {"cases_sha256": sha256(args.cases), "catalog_sha256": sha256(args.catalog)}
        if args.command == "validate":
            report = {"valid": True, "cases": len(cases),
                      "splits": sorted({case["split"] for case in cases}), **hashes}
        else:
            predictions = (read_jsonl(args.predictions, allow_empty=True) if args.command == "score" else
                           [{"case_id": case["id"], "prediction": rule_baseline(case["input"], catalog)}
                            for case in cases])
            report = evaluate(cases, predictions, catalog)
            report.update(hashes)
            report["policy"] = "deterministic-structured-baseline" if args.command == "baseline" else "external-predictions"
            if args.predictions:
                report["predictions_sha256"] = sha256(args.predictions)
            if args.write_predictions:
                args.write_predictions.parent.mkdir(parents=True, exist_ok=True)
                with args.write_predictions.open("x", encoding="utf-8") as stream:
                    for row in predictions:
                        stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
        rendered = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x", encoding="utf-8") as stream:
                stream.write(rendered)
        summary = {key: value for key, value in report.items() if key != "results"}
        print(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False))
        return 1 if report.get("passed", 0) < report.get("total", 0) else 0
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
