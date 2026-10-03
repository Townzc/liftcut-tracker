"""Two-step AutoDL setup. Upload this file and shutdown_guard.py FIRST.

--arm-only uses the standard library and starts the independent shutdown guard
before uploading the checkout/data. A second invocation from the checked-out
commit launches the controller. Neither invocation installs or downloads models.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

PERSIST = Path("/root/autodl-tmp/liftcut")


def write_new(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def boot_proxy(supplied, now, process_start):
    boot = datetime.fromisoformat(supplied)
    if boot.utcoffset() is None or boot > now or process_start > now:
        raise ValueError("valid aware boot proxy required")
    # A reconnect or clone must not move the proxy later than this container.
    return min(boot, process_start)


def container_started(now):
    fields = Path("/proc/1/stat").read_text().rsplit(")", 1)[1].split()
    seconds = float(Path("/proc/uptime").read_text().split()[0])
    start_seconds = int(fields[19]) / os.sysconf("SC_CLK_TCK")
    return now - timedelta(seconds=max(0, seconds - start_seconds))


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--ops-dir", type=Path, required=True)
    parser.add_argument("--arm-only", action="store_true")
    parser.add_argument("--booted-at")
    parser.add_argument("--expected-code-commit")
    for name in ("model-dir", "model-manifest", "prepared-dir", "diagnostic-dir", "d2-dir", "tokenizer-dir", "output-dir"):
        parser.add_argument("--" + name, type=Path)
    args = parser.parse_args()
    if (platform.system() != "Linux" or not Path("/root/autodl-tmp").is_dir()
            or args.ops_dir.resolve().parent != PERSIST / "runs" or not args.ops_dir.name.startswith("g2-ops-")):
        raise ValueError("intended persistent AutoDL operations path required")
    if args.arm_only:
        if args.booted_at is None or args.ops_dir.exists():
            raise ValueError("explicit opening and fresh operations directory required; never re-arm")
        now = datetime.now(timezone.utc)
        started = container_started(now)
        boot = boot_proxy(args.booted_at, now, started)
        hard = boot + timedelta(minutes=180)
        args.ops_dir.mkdir(parents=True, exist_ok=False)
        write_new(args.ops_dir / "setup-opening.json", {"supplied_boot_proxy": args.booted_at,
            "container_start_proxy": started.isoformat(), "booted_at_proxy": boot.isoformat(),
            "hard_cutoff": hard.isoformat(), "work_cutoff": (boot + timedelta(minutes=150)).isoformat(),
            "hourly_cny": 2.18, "reserve_cny": 8, "provider_billing_verified": False})
        from shutdown_guard import shutdown_command
        try:
            if not 0 <= (now - boot).total_seconds() <= 600:
                raise ValueError("late opening; stop and do not reset original budget")
            script = Path(__file__).with_name("shutdown_guard.py")
            argv = [sys.executable, str(script), "--arm", "--deadline", hard.isoformat(),
                    "--receipt", str(args.ops_dir / "setup-guard.jsonl")]
            with (args.ops_dir / "setup-guard.log").open("x") as log:
                guard = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log,
                                         stderr=subprocess.STDOUT, start_new_session=True)
            for _ in range(100):
                receipt = args.ops_dir / "setup-guard.jsonl"
                if receipt.exists() and receipt.stat().st_size:
                    row = json.loads(receipt.read_text().splitlines()[0])
                    if row.get("status") == "armed" and row["deadline"] == hard.isoformat():
                        write_new(args.ops_dir / "setup-guard-launch.json", {"pid": guard.pid, "argv": argv})
                        print(json.dumps({"guard_armed": True, "booted_at_proxy": boot.isoformat(),
                                          "hard_cutoff": hard.isoformat()}), flush=True)
                        return 0
                if guard.poll() is not None:
                    break
                time.sleep(.1)
            raise RuntimeError("setup guard did not arm")
        except BaseException:
            subprocess.run(shutdown_command(Path("/usr/bin/shutdown")), capture_output=True, timeout=30)
            raise
    # Only the small standalone arm step precedes this full-checkout import.
    from g2_execution import ROOT, deadlines, verify_plan, utcnow
    from run_g2_window import budget_from_setup
    from server_workspace import command
    for name in ("model_dir", "model_manifest", "prepared_dir", "diagnostic_dir", "d2_dir", "tokenizer_dir", "output_dir", "expected_code_commit"):
        if getattr(args, name) is None:
            raise ValueError("all fixed execution assets required")
    opening = json.loads((args.ops_dir / "setup-opening.json").read_text())
    boot = opening["booted_at_proxy"]
    deadlines(boot, utcnow())
    budget_from_setup(args.ops_dir / "setup-guard.jsonl", boot)
    launch = args.ops_dir / "controller-launch.json"
    if launch.exists() or args.output_dir.exists():
        raise ValueError("controller/run already exists; inspect instead of relaunching")
    if command(["git", "rev-parse", "HEAD"], ROOT) != args.expected_code_commit or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("exact clean execution commit required")
    if ROOT != PERSIST / "code" / args.expected_code_commit / "research/liftcut-agent":
        raise ValueError("immutable commit checkout path required")
    verify_plan(args.prepared_dir)
    argv = [sys.executable, str(ROOT / "run_g2_window.py")]
    for name in ("model_dir", "model_manifest", "prepared_dir", "diagnostic_dir", "d2_dir", "tokenizer_dir", "output_dir", "expected_code_commit"):
        argv.extend(["--" + name.replace("_", "-"), str(getattr(args, name))])
    argv.extend(["--hourly-cny", "2.18", "--booted-at", boot, "--setup-guard",
                 str(args.ops_dir / "setup-guard.jsonl"), "--execute", "--shutdown-when-done"])
    # Exclusive intent is durable BEFORE Popen: ambiguous launches cannot repeat.
    write_new(launch, {"argv": argv, "at_utc": utcnow().isoformat(), "booted_at_proxy": boot})
    with (args.ops_dir / "controller.log").open("x") as log:
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
    write_new(args.ops_dir / "controller-pid.json", {"pid": process.pid})
    print(json.dumps({"controller_pid": process.pid, "original_deadline_retained": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
