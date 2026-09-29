"""Bounded recovery-v2 window with early adapter archives and verified backup ack."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

from controlled_recovery import ROOT
from liftcut_agent.interactive import digest
from prepare_controlled import verify_prepared
from run_recovery_window import archive_run, execute_phases, wait_guard_armed
from server_workspace import command, dump_new
from shutdown_guard import shutdown_command


def phases(model, manifest, prepared, output):
    common = ["--model-dir", str(model), "--model-manifest", str(manifest), "--prepared-dir", str(prepared)]
    result = []
    for arm in ("clean", "mixed"):
        result.append(("train-" + arm, [sys.executable, str(ROOT / "gpu_train_recovery.py"), *common,
            "--study", "v2", "--arm", arm, "--output-dir", str(output / "training" / arm), "--allow-gpu"]))
    for arm in ("unadapted", "clean", "mixed"):
        argv = [sys.executable, str(ROOT / "gpu_controlled.py"), *common,
                "--output-dir", str(output / "evaluation" / arm), "--allow-gpu"]
        if arm != "unadapted":
            argv += ["--adapter-dir", str(output / "training" / arm / "final")]
        result.append(("evaluate-" + arm, argv))
    result.append(("audit", [sys.executable, str(ROOT / "audit_controlled.py"), "--run-dir", str(output),
        "--prepared-dir", str(prepared), "--output", str(output / "comparison.json")]))
    return result


def deadline(booted_at, now):
    boot = datetime.fromisoformat(booted_at)
    if boot.tzinfo is None or boot > now:
        raise ValueError("invalid container start proxy")
    cutoff = boot + timedelta(hours=4)
    if (cutoff - now).total_seconds() < 100 * 60:
        raise ValueError("less than 100 minutes remain including backup; do not launch")
    return cutoff


def evidence_backup(output):
    """Training archives already contain the weights and their complete arm logs."""
    staging = output / "evidence"
    staging.mkdir(exist_ok=False)
    for path in sorted(output.iterdir()):
        if path.name in {"training", "evidence", "deadline-guard.jsonl", "deadline-guard.log"}:
            continue
        if path.is_symlink():
            raise ValueError("evidence must not contain symlinks")
        if path.is_dir():
            shutil.copytree(path, staging / path.name)
        else:
            shutil.copy2(path, staging / path.name)
    return archive_run(staging)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model-dir", type=Path, required=True)
    p.add_argument("--model-manifest", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--booted-at")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--shutdown-when-done", action="store_true")
    args = p.parse_args()
    plan = verify_prepared(args.prepared_dir)
    commands = phases(args.model_dir, args.model_manifest, args.prepared_dir, args.output_dir)
    if not args.execute:
        print(json.dumps({"dry_run": True, "budget": plan["budget"], "phases": commands}, indent=2))
        return
    if (platform.system() != "Linux" or not Path("/root/autodl-tmp").is_dir()
            or not args.shutdown_when_done or not args.booted_at):
        p.error("AutoDL, start time and shutdown-when-done are required")
    if not args.output_dir.resolve().is_relative_to(Path("/root/autodl-tmp/liftcut/runs")):
        raise ValueError("output must be in persistent experiment runs")
    if args.output_dir.exists() or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("new output and clean committed code required")
    cutoff = deadline(args.booted_at, datetime.now(timezone.utc))
    args.output_dir.mkdir(parents=True, exist_ok=False)
    output, archives, status, failures = args.output_dir, [], "failed", []
    try:
        with (output / "deadline-guard.log").open("x") as log:
            guard = subprocess.Popen([sys.executable, str(ROOT / "shutdown_guard.py"), "--arm",
                "--deadline", cutoff.isoformat(), "--receipt", str(output / "deadline-guard.jsonl")],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        wait_guard_armed(guard, output / "deadline-guard.jsonl")
        for name, argv in commands:
            # Existing helper reserves ten minutes; moving its deadline back
            # twenty minutes gives this study a full thirty-minute backup margin.
            execute_phases([(name, argv)], cutoff - timedelta(minutes=20), output)
            if name.startswith("train-"):
                arm = name.removeprefix("train-")
                backup = archive_run(output / "training" / arm)
                archives.append({"part": arm, "path": "training/" + backup["archive"], **backup})
                print(json.dumps({"adapter_backup_ready": archives[-1]}), flush=True)
        status = "complete"
    except (OSError, ValueError, TimeoutError, subprocess.SubprocessError) as exc:
        failures.append(type(exc).__name__ + ": " + str(exc))
    finally:
        try:
            dump_new(output / "window-status.json", {"status": status, "failures": failures,
                "booted_at_proxy": args.booted_at, "deadline": cutoff.isoformat(), "hourly_cny_assumed": 2.18,
                "code_commit": command(["git", "rev-parse", "HEAD"], ROOT), "test_episodes": 0,
                "backup_rule": "Two complete final-adapter training archives plus complete rollout/evidence archive"})
            # If a training process failed, preserve its partial logs too, but
            # never treat it as a complete trained arm or create a false report.
            for arm in ("clean", "mixed"):
                partial = output / "training" / arm
                if partial.exists() and arm not in {a["part"] for a in archives}:
                    backup = archive_run(partial)
                    archives.append({"part": arm, "path": "training/" + backup["archive"], **backup})
            backup = evidence_backup(output)
            archives.append({"part": "evidence", "path": backup["archive"], **backup})
            index = {"archives": archives, "status": status}
            dump_new(output / "backup-ready.json", {**index, "inventory_digest": digest(index)})
            print(json.dumps({"backup_ready": True, "inventory_digest": digest(index), "archives": archives}), flush=True)
            end = time.monotonic() + max(0, (cutoff - datetime.now(timezone.utc)).total_seconds() - 60)
            verified = False
            while time.monotonic() < end:
                ack = output / "off-instance-backup.json"
                if ack.exists():
                    try:
                        verified = json.loads(ack.read_text())["inventory_digest"] == digest(index)
                    except (OSError, ValueError, KeyError):
                        pass
                    if verified:
                        break
                time.sleep(2)
            dump_new(output / "backup-copy-status.json", {"off_instance_acknowledged": verified})
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            print(json.dumps({"backup_error": type(exc).__name__}), flush=True)
        try:
            result = subprocess.run(shutdown_command(Path("/usr/bin/shutdown")), capture_output=True, timeout=30)
            dump_new(output / "shutdown-request.json", {"returncode": result.returncode,
                "at_utc": datetime.now(timezone.utc).isoformat(), "provider_power_state_verified": False})
        except (OSError, subprocess.SubprocessError) as exc:
            print(json.dumps({"shutdown_error": type(exc).__name__, "deadline_guard_retained": True}), flush=True)
    return 0 if status == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
