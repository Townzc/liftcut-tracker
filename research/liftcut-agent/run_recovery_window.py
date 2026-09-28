"""Dry-run by default; bounded AutoDL training/evaluation, backup, then shutdown.

The deadline is measured from the supplied instance boot time, not script start.
Never rents, starts, or reconnects an instance. No hosted model credentials.
"""

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import time

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from prepare_recovery import verify_prepared
from recovery_dataset import DATA
from server_workspace import command, dump_new, sha256
from shutdown_guard import shutdown_command


def deadline_from_boot(booted_at, now):
    boot = datetime.fromisoformat(booted_at)
    if boot.tzinfo is None or boot > now:
        raise ValueError("boot time must be timezone-aware and no later than now")
    deadline = boot + timedelta(hours=2)
    if (deadline - now).total_seconds() <= 15 * 60:
        raise ValueError("too little time remains; do not start a partial late window")
    return deadline


def phase_commands(model_dir, model_manifest, prepared, output):
    common = ["--model-dir", str(model_dir), "--model-manifest", str(model_manifest)]
    phases = []
    for arm in ("clean", "mixed"):
        phases.append((f"train-{arm}", [sys.executable, str(ROOT / "gpu_train_recovery.py"), *common,
            "--prepared-dir", str(prepared), "--output-dir", str(output / "training" / arm), "--arm", arm, "--allow-gpu"]))
    for arm in ("unadapted", "clean", "mixed"):
        args = [sys.executable, str(ROOT / "gpu_rollout.py"), *common,
                "--cases", str(DATA / "dev.jsonl"), "--cases", str(DATA / "test.jsonl"),
                "--output-dir", str(output / "evaluation" / arm), "--allow-gpu"]
        if arm != "unadapted":
            args.extend(["--adapter-dir", str(output / "training" / arm / "final")])
        phases.append((f"evaluate-{arm}", args))
    phases.append(("audit", [sys.executable, str(ROOT / "audit_recovery.py"), "--run-dir", str(output),
                             "--prepared-dir", str(prepared), "--output", str(output / "comparison.json")]))
    return phases


def archive_run(output):
    # Archive only this run, never model caches, environment variables or keys.
    files = []
    for path in sorted(output.rglob("*")):
        if path.is_symlink():
            raise ValueError("run backup must not contain symlinks")
        if path.is_file():
            if path.name.startswith("."):
                raise ValueError("unexpected hidden file in run")
            files.append({"path": path.relative_to(output).as_posix(), "bytes": path.stat().st_size,
                          "sha256": sha256(path)})
    inventory = output / "backup-inventory.json"
    dump_new(inventory, {"files": files})
    archive = output.parent / f"{output.name}.tar.gz"
    with archive.open("xb") as stream:
        with tarfile.open(fileobj=stream, mode="w:gz") as tar:
            tar.add(output, arcname=output.name, recursive=True)
    result = {"archive": archive.name, "bytes": archive.stat().st_size, "sha256": sha256(archive)}
    dump_new(output / "backup-ready.json", result)
    return result


def execute_phases(phases, deadline, output):
    for name, argv in phases:
        # Reserve ten minutes for archiving, off-instance copy and shutdown.
        remaining = (deadline - datetime.now(timezone.utc)).total_seconds() - 600
        if remaining <= 0:
            raise TimeoutError("soft deadline before next phase")
        print(json.dumps({"phase": name, "status": "started"}), flush=True)
        with (output / f"{name}.log").open("x", encoding="utf-8") as log:
            subprocess.run(argv, check=True, timeout=remaining, stdout=log, stderr=subprocess.STDOUT,
                           stdin=subprocess.DEVNULL)


def wait_guard_armed(guard, receipt):
    ready_by = time.monotonic() + 10
    while guard.poll() is None and time.monotonic() < ready_by:
        if receipt.exists():
            try:
                if json.loads(receipt.read_text(encoding="utf-8").splitlines()[0])["status"] == "armed":
                    return
            except (OSError, ValueError, IndexError, KeyError):
                pass  # Creating the file can precede flushing the first record.
        time.sleep(.1)
    raise ValueError("shutdown guard did not arm")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-manifest", type=Path, required=True)
    parser.add_argument("--prepared-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--booted-at", help="Actual boot ISO8601 timestamp with UTC offset; required for execution")
    parser.add_argument("--hourly-cny", type=float, default=2.18)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--shutdown-when-done", action="store_true")
    args = parser.parse_args()
    plan = verify_prepared(args.prepared_dir)
    phases = phase_commands(args.model_dir, args.model_manifest, args.prepared_dir, args.output_dir)
    if not args.execute:
        print(json.dumps({"dry_run": True, "gpu_calls": 0, "budget": plan["budget"],
                          "phases": [{"name": name, "argv": argv} for name, argv in phases]}, indent=2))
        return 0
    if (platform.system() != "Linux" or not Path("/root/autodl-tmp").is_dir()
            or not args.shutdown_when_done or not args.booted_at):
        parser.error("execution requires AutoDL Linux, --booted-at and --shutdown-when-done")
    if args.hourly_cny != plan["budget"]["hourly_cny"]:
        raise ValueError("price differs from reviewed plan; revise budget before running")
    if not args.output_dir.resolve().is_relative_to(Path("/root/autodl-tmp/liftcut/runs")):
        raise ValueError("run output must be on the persistent experiment data disk")
    if args.output_dir.exists() or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("fresh output and clean Git checkout required")
    deadline = deadline_from_boot(args.booted_at, datetime.now(timezone.utc))
    args.output_dir.mkdir(parents=True, exist_ok=False)
    guard_receipt = args.output_dir / "deadline-guard.jsonl"
    status, failures = "failed", []
    backup = None
    shutdown_ok = False
    try:
        # Keep an independent process alive if SSH or this runner disappears.
        with (args.output_dir / "deadline-guard.log").open("x", encoding="utf-8") as guard_log:
            guard = subprocess.Popen([sys.executable, str(ROOT / "shutdown_guard.py"), "--arm",
                "--deadline", deadline.isoformat(), "--receipt", str(guard_receipt)],
                stdin=subprocess.DEVNULL, stdout=guard_log, stderr=subprocess.STDOUT, start_new_session=True)
        wait_guard_armed(guard, guard_receipt)
        execute_phases(phases, deadline, args.output_dir)
        status = "complete"
    except (OSError, ValueError, TimeoutError, subprocess.SubprocessError) as error:
        failures.append(type(error).__name__ + ": " + str(error))
    finally:
        try:
            dump_new(args.output_dir / "window-status.json", {"status": status, "failures": failures,
                "booted_at": args.booted_at, "deadline": deadline.isoformat(), "hourly_cny": args.hourly_cny,
                "code_commit": command(["git", "rev-parse", "HEAD"], ROOT),
                "result_rule": "Only complete, replay-audited arms are comparable; partial runs are not a result"})
            backup = archive_run(args.output_dir)
            print(json.dumps({"status": "backup_ready", **backup}), flush=True)
            # Controller copies the archive, checks SHA-256, then writes this ack.
            # Missing acknowledgment never keeps a paid instance alive indefinitely.
            grace = min(300, max(0, (deadline - datetime.now(timezone.utc)).total_seconds() - 60))
            end = time.monotonic() + grace
            verified = False
            while time.monotonic() < end:
                ack = args.output_dir / "off-instance-backup.json"
                if ack.exists():
                    try:
                        verified = json.loads(ack.read_text(encoding="utf-8")).get("sha256") == backup["sha256"]
                    except (OSError, ValueError):
                        pass
                    if verified:
                        break
                time.sleep(1)
            dump_new(args.output_dir / "backup-copy-status.json", {"off_instance_acknowledged": verified})
        except (OSError, ValueError, tarfile.TarError) as error:
            print(json.dumps({"backup_error": type(error).__name__}), flush=True)
        # The separate deadline guard remains armed if this command fails.
        try:
            result = subprocess.run(shutdown_command(Path("/usr/bin/shutdown")), capture_output=True, timeout=30)
            shutdown_ok = result.returncode == 0
            dump_new(args.output_dir / "shutdown-request.json", {"returncode": result.returncode,
                "at_utc": datetime.now(timezone.utc).isoformat(), "provider_power_state_verified": False})
        except (OSError, subprocess.SubprocessError) as error:
            print(json.dumps({"shutdown_error": type(error).__name__, "deadline_guard_retained": True}), flush=True)
    return 0 if status == "complete" and backup is not None and shutdown_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
