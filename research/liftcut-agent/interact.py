"""Run or replay an offline interactive workflow; no model/API or GPU required."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl, sha256
from liftcut_agent.interactive import validate_scenarios
from liftcut_agent.workflow import replay_trace, run_suite


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate", "run", "replay"])
    parser.add_argument("--cases", type=Path, default=ROOT / "benchmark/interactive-dev.jsonl")
    parser.add_argument("--catalog", type=Path, default=ROOT / "benchmark/catalog.json")
    parser.add_argument("--scenario", help="Explicitly select one scenario ID")
    parser.add_argument("--policy", choices=["fixed", "no-memory", "no-retry"], default="fixed")
    parser.add_argument("--traces", type=Path, help="Input JSONL for replay")
    parser.add_argument("--write-traces", type=Path, help="Write full run traces to new JSONL")
    parser.add_argument("--output", type=Path, help="Write report to a new JSON file")
    args = parser.parse_args()
    if (args.command == "replay") != (args.traces is not None):
        parser.error("--traces is required only for replay")
    if args.command != "run" and (args.write_traces is not None or args.policy != "fixed"):
        parser.error("--write-traces and --policy are only supported for run")
    try:
        destinations = [path for path in (args.output, args.write_traces) if path is not None]
        if len({path.resolve() for path in destinations}) != len(destinations) or any(path.exists() for path in destinations):
            raise ValueError("output paths must be distinct and must not already exist")
        catalog = load_catalog(args.catalog)
        scenarios = read_jsonl(args.cases)
        validate_scenarios(scenarios, catalog)
        if args.scenario:
            scenarios = [case for case in scenarios if case["id"] == args.scenario]
            if not scenarios:
                raise ValueError("unknown scenario selection")
        failed = False
        if args.command == "validate":
            report = {"valid": True, "total": len(scenarios), "splits": sorted({row["split"] for row in scenarios})}
        elif args.command == "run":
            report, traces = run_suite(scenarios, catalog, args.policy)
            failed = report["passed"] != report["total"]
            if args.write_traces:
                args.write_traces.parent.mkdir(parents=True, exist_ok=True)
                with args.write_traces.open("x", encoding="utf-8", newline="\n") as stream:
                    for trace in traces:
                        stream.write(json.dumps(trace, ensure_ascii=False, allow_nan=False) + "\n")
        else:
            traces = read_jsonl(args.traces, allow_empty=True)
            known = {scenario["id"] for scenario in scenarios}
            indexed = {}
            for trace in traces:
                identity = trace.get("scenario_id")
                if not isinstance(identity, str) or identity not in known or identity in indexed:
                    raise ValueError("duplicate or unknown trace scenario_id")
                indexed[identity] = trace
            results = [(replay_trace(scenario, catalog, indexed[scenario["id"]]) if scenario["id"] in indexed else
                        {"scenario_id": scenario["id"], "replay_valid": False, "error": "missing_trace"})
                       for scenario in scenarios]
            report = {"total": len(results), "replayed": sum(row["replay_valid"] for row in results),
                      "task_passed": sum(row.get("score", {}).get("passed", False) for row in results),
                      "traces_sha256": sha256(args.traces), "results": results}
            failed = report["replayed"] != report["total"]
        report.update(cases_sha256=sha256(args.cases), catalog_sha256=sha256(args.catalog))
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x", encoding="utf-8", newline="\n") as stream:
                stream.write(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        print(json.dumps({key: value for key, value in report.items() if key != "results"}, indent=2, ensure_ascii=False))
        return 1 if failed else 0
    except (OSError, ValueError, TypeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
