"""Bounded three-hour coverage study; four early adapter backups then verified restore."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

from state_coverage import ROOT, ARMS
from liftcut_agent.interactive import digest
from prepare_state_coverage import verify_prepared
from prepare_state_diagnostics import verify_prepared as verify_diagnostics
from run_controlled_window import evidence_backup
from run_recovery_window import archive_run, execute_phases, wait_guard_armed
from server_workspace import command, dump_new
from shutdown_guard import shutdown_command


def phases(model, manifest, prepared, diagnostic, output):
    common = ["--model-dir", str(model), "--model-manifest", str(manifest), "--prepared-dir", str(prepared)]
    result = []
    for arm in ARMS:
        result.append(("train-" + arm, [sys.executable, str(ROOT / "gpu_train_state_coverage.py"), *common,
            "--arm", arm, "--output-dir", str(output / "training" / arm), "--allow-gpu"]))
        result.append(("evaluate-" + arm, [sys.executable, str(ROOT / "gpu_state_coverage.py"), *common,
            "--arm", arm, "--diagnostic-dir", str(diagnostic), "--training-dir", str(output / "training" / arm),
            "--output-dir", str(output / "evaluation" / arm), "--allow-gpu"]))
    result.append(("audit", [sys.executable, str(ROOT / "audit_state_coverage.py"), "--run-dir", str(output),
        "--prepared-dir", str(prepared), "--diagnostic-dir", str(diagnostic), "--output", str(output / "comparison.json")]))
    return result


def deadline(booted_at, now):
    boot = datetime.fromisoformat(booted_at)
    if boot.tzinfo is None or boot > now or (now - boot).total_seconds() > 600:
        raise ValueError("aware boot time within the first ten minutes required; do not extend budget")
    return boot + timedelta(minutes=180)


def valid_ack(path, index):
    try:
        receipt = json.loads(path.read_text(encoding="utf-8"))
        if (receipt["inventory_digest"] != digest(index) or receipt["all_archive_files_verified"] is not True
                or receipt["run_status"] != index["status"]):
            return False
        return (receipt["complete_study_replayed"] is True and receipt["episodes_replayed"] == 124
                and receipt["adapter_files_verified"] is True) if index["status"] == "complete" else receipt["complete_study_replayed"] is False
    except (OSError, ValueError, KeyError, TypeError):
        return False


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model-dir", type=Path, required=True)
    p.add_argument("--model-manifest", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--diagnostic-dir", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--booted-at")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--shutdown-when-done", action="store_true")
    args = p.parse_args()
    plan = verify_prepared(args.prepared_dir)
    verify_diagnostics(args.diagnostic_dir)
    commands = phases(args.model_dir, args.model_manifest, args.prepared_dir, args.diagnostic_dir, args.output_dir)
    if not args.execute:
        print(json.dumps({"dry_run": True, "gpu_calls": 0, "budget": plan["budget"], "phases": commands}, indent=2))
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
                "backup_rule": "Four complete final-adapter training archives plus complete rollout/evidence archive"})
            # If a training process failed, preserve its partial logs too, but
            # never treat it as a complete trained arm or create a false report.
            for arm in ARMS:
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
                    verified = valid_ack(ack, index)
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
