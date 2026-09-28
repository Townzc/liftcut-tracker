"""Offline model-protocol smoke, explicit live run, preflight and recorded replay."""

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_json, read_jsonl, sha256
from liftcut_agent.interactive import validate_scenarios
from liftcut_agent.model_policy import ModelConfig, encode, money
from liftcut_agent.model_runner import replay_model_suite, run_model_suite
from liftcut_agent.model_transport import HttpTransport, MockWorkflowTransport, endpoint_url


def code_identity():
    root = ROOT.parents[1]
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True)
    status = subprocess.run(["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True)
    return {"commit": revision.stdout.strip() if revision.returncode == 0 else None,
            "dirty": bool(status.stdout.strip()) if status.returncode == 0 else None}


def write_row(stream, row):
    stream.write(encode(row) + "\n")
    stream.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["mock", "preflight", "live", "replay"])
    parser.add_argument("--config", type=Path, help="ModelConfig JSON, required for live/preflight/replay")
    parser.add_argument("--cases", type=Path, default=ROOT / "benchmark/interactive-dev.jsonl")
    parser.add_argument("--catalog", type=Path, default=ROOT / "benchmark/catalog.json")
    parser.add_argument("--scenario", help="Explicit single-scenario selection")
    parser.add_argument("--output-dir", type=Path, help="New directory; required for mock/live")
    parser.add_argument("--episodes", type=Path, help="Saved episode JSONL; required for replay")
    parser.add_argument("--base-url", help="Explicit compatible endpoint, for preflight/live only")
    parser.add_argument("--api-key-env", default="LIFTCUT_AGENT_API_KEY")
    parser.add_argument("--allow-live", action="store_true", help="Permit network requests with this reviewed config")
    args = parser.parse_args()
    if args.command != "mock" and not args.config:
        parser.error("--config is required")
    if (args.command in {"mock", "live"}) != (args.output_dir is not None):
        parser.error("--output-dir is required only for mock/live")
    if (args.command == "replay") != (args.episodes is not None):
        parser.error("--episodes is required only for replay")
    if args.command == "live" and (not args.allow_live or not args.base_url):
        parser.error("live requires --allow-live and --base-url")
    if args.command != "live" and (args.allow_live or args.api_key_env != "LIFTCUT_AGENT_API_KEY"):
        parser.error("--allow-live and --api-key-env are only supported for live")
    if args.command not in {"preflight", "live"} and args.base_url:
        parser.error("--base-url is only supported for preflight/live")
    try:
        data = read_json(args.config.read_text(encoding="utf-8")) if args.config else {}
        if not isinstance(data, dict):
            raise ValueError("configuration must be an object")
        config = ModelConfig(**data)
        if args.command == "mock" and (config.model != "mock-workflow" or
                money(config.input_usd_per_million) != 0 or money(config.output_usd_per_million) != 0):
            raise ValueError("mock requires mock-workflow and zero prices")
        if args.command == "live":
            required = set(asdict(ModelConfig()))
            if set(data) != required or config.model in {"mock-workflow", "SET_MODEL_ID"} or config.pricing_note.startswith("REPLACE"):
                raise ValueError("live requires a complete, reviewed configuration with model and pricing provenance")
        catalog = load_catalog(args.catalog)
        scenarios = read_jsonl(args.cases)
        validate_scenarios(scenarios, catalog)
        if args.scenario:
            scenarios = [scenario for scenario in scenarios if scenario["id"] == args.scenario]
            if not scenarios:
                raise ValueError("unknown scenario selection")
        endpoint = endpoint_url(args.base_url) if args.base_url else None
        if args.command == "preflight":
            requests = min(config.max_requests, sum(scenario["max_steps"] for scenario in scenarios),
                           config.max_reserved_output_tokens // config.max_output_tokens)
            estimate = ((config.max_request_bytes + 4096) * money(config.input_usd_per_million)
                        + config.max_output_tokens * money(config.output_usd_per_million)) / Decimal(1000000)
            report = {"network_requests": 0, "scenarios": len(scenarios), "endpoint": endpoint,
                      "model_manifest": config.manifest(), "maximum_requests_before_cost_guard": requests,
                      "maximum_output_tokens_reserved": requests * config.max_output_tokens,
                      "worst_configured_reservation_usd_before_cost_guard": str(requests * estimate),
                      "cost_guard_usd": config.max_reserved_usd,
                      "note": "Input byte-based reservation is an estimate, not a provider billing guarantee."}
        elif args.command == "replay":
            report = replay_model_suite(scenarios, catalog, config, read_jsonl(args.episodes, allow_empty=True))
            report["episodes_sha256"] = sha256(args.episodes)
        else:
            # All local validation and exclusive output creation happen before the first request.
            if args.command == "live":
                transport = HttpTransport(args.base_url, os.environ.get(args.api_key_env, ""), config)
                factory = lambda: transport
            else:
                factory = MockWorkflowTransport
            args.output_dir.mkdir(parents=True, exist_ok=False)
            metadata = {"started_at": datetime.now(timezone.utc).isoformat(), "code": code_identity(),
                        "mode": args.command, "endpoint": endpoint, "config": asdict(config),
                        "scenario_ids": [scenario["id"] for scenario in scenarios],
                        "cases_sha256": sha256(args.cases), "catalog_sha256": sha256(args.catalog)}
            (args.output_dir / "config.json").write_text(encode(asdict(config)) + "\n", encoding="utf-8", newline="\n")
            (args.output_dir / "manifest.json").write_text(encode(metadata) + "\n", encoding="utf-8", newline="\n")
            with (args.output_dir / "episodes.jsonl").open("x", encoding="utf-8", newline="\n") as episodes, \
                    (args.output_dir / "calls.jsonl").open("x", encoding="utf-8", newline="\n") as calls:
                report, _ = run_model_suite(scenarios, catalog, config, factory, mode=args.command,
                    on_episode=lambda row: write_row(episodes, row),
                    on_call=lambda identity, call: write_row(calls, {"scenario_id": identity, **call}))
            report.update(metadata)
            report.update(episodes_sha256=sha256(args.output_dir / "episodes.jsonl"),
                          calls_sha256=sha256(args.output_dir / "calls.jsonl"))
            (args.output_dir / "report.json").write_text(encode(report) + "\n", encoding="utf-8", newline="\n")
        print(encode({key: value for key, value in report.items() if key not in {"results", "by_category"}}))
        if args.command == "replay":
            return 0 if report["replayed"] == report["total"] else 1
        return 0 if args.command == "preflight" or report["passed"] == report["total"] else 1
    except (OSError, ValueError, TypeError, RecursionError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
