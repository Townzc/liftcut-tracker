"""Preflight or execute the frozen four-arm study; never load credential files."""

import argparse
from dataclasses import asdict, replace
from decimal import Decimal
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import read_json
from liftcut_agent.comparison import ARMS, FACTORS
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import money
from liftcut_agent.protocol import load_config


def profiles():
    configs = []
    common = None
    for arm in ARMS:
        config = load_config(read_json((ROOT / f"configs/protocol-comparison/{arm}.json").read_text(encoding="utf-8")))
        data = asdict(config)
        if (data.pop("tool_protocol"), data.pop("prompt_revision")) != FACTORS[arm]:
            raise ValueError("unexpected experiment factors")
        if common is not None and digest(data) != common:
            raise ValueError("non-factor settings differ")
        common = digest(data)
        configs.append(config)
    return configs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preflight", "mock", "live"))
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--base-url")
    parser.add_argument("--allow-live", action="store_true")
    parser.add_argument("--max-reserved-usd", help="Required explicit aggregate ceiling for live")
    args = parser.parse_args()
    try:
        configs = profiles()
        total = sum((money(config.max_reserved_usd) for config in configs), Decimal(0))
        if args.command == "preflight":
            print(json.dumps({"network_requests": 0, "arms": list(ARMS), "per_arm_guard_usd": [c.max_reserved_usd for c in configs],
                              "aggregate_reservation_guard_usd": str(total), "note": "reservation estimate is not a provider billing cap"}, indent=2))
            return 0
        if not args.output_dir:
            raise ValueError("--output-dir is required")
        if args.command == "live":
            if not args.allow_live or not args.base_url or args.max_reserved_usd is None:
                raise ValueError("live requires --allow-live, --base-url and --max-reserved-usd")
            if total > money(args.max_reserved_usd):
                raise ValueError("arm reservations exceed aggregate ceiling")
            if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
                raise ValueError("live matrix requires a clean committed source")
        elif args.allow_live or args.base_url or args.max_reserved_usd:
            raise ValueError("live-only flags supplied to mock")
        args.output_dir.mkdir(parents=True, exist_ok=False)
        for arm, config in zip(ARMS, configs):
            if args.command == "live" and subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
                raise ValueError("source changed between arms; stopping")
            if args.command == "mock":
                config = replace(config, model="mock-workflow", revision="synthetic-v1", input_usd_per_million="0",
                                 output_usd_per_million="0", max_reserved_usd="0", pricing_note="offline mock; no billing")
            path = args.output_dir / f"{arm}-config.json"
            path.write_text(json.dumps(asdict(config), indent=2) + "\n", encoding="utf-8", newline="\n")
            command = [sys.executable, str(ROOT / "model.py"), args.command, "--config", str(path),
                       "--output-dir", str(args.output_dir / arm)]
            if args.command == "live":
                command.extend(["--allow-live", "--base-url", args.base_url])
            print(f"Starting {args.command} arm: {arm}", flush=True)
            completed = subprocess.run(command, capture_output=True, encoding="utf-8")
            if completed.returncode not in (0, 1):
                raise ValueError(f"arm {arm} did not complete: {completed.stderr.strip()}")
            report = read_json((args.output_dir / arm / "report.json").read_text(encoding="utf-8"))
            print(json.dumps({"arm": arm, **{k: report[k] for k in ("passed", "total", "requests", "estimated_cost_usd")}}), flush=True)
            if not report["usage_complete"]:
                raise ValueError("unknown usage; refusing to start subsequent arms")
        return 0
    except (OSError, ValueError, TypeError, KeyError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
