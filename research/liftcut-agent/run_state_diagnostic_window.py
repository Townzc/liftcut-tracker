"""Dry-run first; at most one boot-relative hour for existing-adapter inference."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

from state_diagnostics import ROOT
from prepare_state_diagnostics import verify_prepared
from gpu_state_diagnostics import verify_adapter
from run_controlled_window import evidence_backup
from run_recovery_window import execute_phases, wait_guard_armed
from server_workspace import command, dump_new
from shutdown_guard import shutdown_command


def deadlines(booted_at, now):
    boot = datetime.fromisoformat(booted_at)
    if boot.tzinfo is None or boot > now or now > boot + timedelta(minutes=10):
        raise ValueError("boot time must be aware, not future, and at most ten minutes old; do not silently extend window")
    return boot + timedelta(minutes=35), boot + timedelta(minutes=60)


def phases(model, manifest, prepared, adapters, output):
    result = []
    for arm in ("clean", "mixed"):
        result.append(("evaluate-" + arm, [sys.executable, str(ROOT / "gpu_state_diagnostics.py"),
            "--model-dir", str(model), "--model-manifest", str(manifest), "--prepared-dir", str(prepared),
            "--adapter-dir", str(adapters / arm / "final"), "--arm", arm,
            "--output-dir", str(output / "evaluation" / arm), "--allow-gpu"]))
    result.append(("audit", [sys.executable, str(ROOT / "audit_state_diagnostics.py"),
        "--run-dir", str(output), "--prepared-dir", str(prepared), "--output", str(output / "comparison.json")]))
    return result


def valid_ack(path, backup, status):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return (value.get("sha256") == backup["sha256"] and value.get("all_inventory_files_verified") is True
                and (status != "complete" or value.get("complete_pair_replayed") is True))
    except (OSError, ValueError):
        return False


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model-dir", type=Path, required=True)
    p.add_argument("--model-manifest", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--adapters-root", type=Path, required=True, help="Existing recovery-v2 training directory")
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--booted-at")
    p.add_argument("--hourly-cny", type=float, default=2.18)
    p.add_argument("--execute", action="store_true")
    p.add_argument("--shutdown-when-done", action="store_true")
    args = p.parse_args()
    plan = verify_prepared(args.prepared_dir)
    commands = phases(args.model_dir, args.model_manifest, args.prepared_dir, args.adapters_root, args.output_dir)
    if not args.execute:
        print(json.dumps({"dry_run": True, "gpu_calls": 0, "budget": plan["budget"], "phases": commands}, indent=2))
        return 0
    if (platform.system() != "Linux" or not Path("/root/autodl-tmp").is_dir()
            or not args.shutdown_when_done or not args.booted_at):
        p.error("AutoDL, boot time and shutdown-when-done required")
    if args.hourly_cny != plan["budget"]["hourly_cny_assumed"]:
        raise ValueError("quote changed; revise budget before execution")
    if not args.output_dir.resolve().is_relative_to(Path("/root/autodl-tmp/liftcut/runs")):
        raise ValueError("output must be on persistent experiment disk")
    if args.output_dir.exists() or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("fresh output and clean committed code required")
    for arm in ("clean", "mixed"):
        verify_adapter(arm, args.adapters_root / arm / "final")
    soft, hard = deadlines(args.booted_at, datetime.now(timezone.utc))
    output, status, failures = args.output_dir, "failed", []
    output.mkdir(parents=True, exist_ok=False)
    try:
        with (output / "deadline-guard.log").open("x") as log:
            guard = subprocess.Popen([sys.executable, str(ROOT / "shutdown_guard.py"), "--arm",
                "--deadline", hard.isoformat(), "--receipt", str(output / "deadline-guard.jsonl")],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        wait_guard_armed(guard, output / "deadline-guard.jsonl")
        # execute_phases subtracts ten minutes internally: effective stop is soft.
        execute_phases(commands, soft + timedelta(minutes=10), output)
        status = "complete"
    except (OSError, ValueError, TimeoutError, subprocess.SubprocessError) as error:
        failures.append(type(error).__name__ + ": " + str(error))
    finally:
        try:
            dump_new(output / "window-status.json", {"status": status, "failures": failures,
                "booted_at_proxy": args.booted_at, "inference_cutoff": soft.isoformat(), "deadline": hard.isoformat(),
                "hourly_cny_assumed": args.hourly_cny, "code_commit": command(["git", "rev-parse", "HEAD"], ROOT),
                "training_steps": 0, "test_episodes": 0,
                "partial_rule": "Preserve partial raw calls/generations; never score an incomplete comparison"})
            backup = evidence_backup(output)
            dump_new(output / "backup-ready.json", {**backup, "status": status})
            print(json.dumps({"backup_ready": True, **backup, "status": status}), flush=True)
            end = time.monotonic() + max(0, (hard - datetime.now(timezone.utc)).total_seconds() - 60)
            verified = False
            while time.monotonic() < end:
                verified = valid_ack(output / "off-instance-backup.json", backup, status)
                if verified:
                    break
                time.sleep(2)
            dump_new(output / "backup-copy-status.json", {"off_instance_acknowledged": verified})
        except Exception as error:
            # Failure to archive must not defeat the independent cost deadline.
            print(json.dumps({"backup_error": type(error).__name__, "persistent_data_retained": True}), flush=True)
        try:
            result = subprocess.run(shutdown_command(Path("/usr/bin/shutdown")), capture_output=True, timeout=30)
            dump_new(output / "shutdown-request.json", {"returncode": result.returncode,
                "at_utc": datetime.now(timezone.utc).isoformat(), "provider_power_state_verified": False})
        except (OSError, subprocess.SubprocessError) as error:
            print(json.dumps({"shutdown_error": type(error).__name__, "deadline_guard_retained": True}), flush=True)
    return 0 if status == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
