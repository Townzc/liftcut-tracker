"""D2 boot-relative 90-minute work / 120-minute shutdown controller; dry-run default."""
import argparse
from datetime import timedelta
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

from d2_execution import (ARMS, BUDGET, ROOT, Clock, aware, binding, deadlines, event_file,
                          read, utcnow, verify_adapters, verify_plan)
from d2_receipt_transfer import validate_receipt
from gpu_counterfactual_diagnostics import verify_model
from run_controlled_window import evidence_backup
from run_recovery_window import archive_run, wait_guard_armed
from server_workspace import command, dump_new
from shutdown_guard import shutdown_command


def phases(model, manifest, prepared, adapters, tokenizer, output, commit):
    shared = ["--model-dir", str(model), "--model-manifest", str(manifest), "--prepared-dir", str(prepared),
              "--adapters-root", str(adapters), "--run-dir", str(output), "--expected-code-commit", commit]
    commands = [("evaluate-" + arm, [sys.executable, str(ROOT / "gpu_counterfactual_diagnostics.py"), *shared,
                                    "--arm", arm, "--allow-gpu"]) for arm in ARMS]
    commands.append(("audit", [sys.executable, str(ROOT / "audit_counterfactual_diagnostics.py"),
        "--run-dir", str(output), "--prepared-dir", str(prepared), "--tokenizer-dir", str(tokenizer),
        "--adapters-root", str(adapters), "--output", str(output / "comparison.json")]))
    return commands


def run_phase(name, argv, output, work, clock, *, runner=subprocess.run):
    seconds = (work - clock.now()).total_seconds()
    if seconds <= 0:
        raise TimeoutError("original work deadline before next phase")
    event_file(output / "events.jsonl", "phase_started", phase=name)
    with (output / (name + ".log")).open("x", encoding="utf-8") as log:
        runner(argv, check=True, timeout=seconds, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
    event_file(output / "events.jsonl", "phase_completed", phase=name)


def execute_phases(commands, output, bind, work, clock, *, phase_runner=run_phase):
    """One production/drill path for phase ordering and durable early archives."""
    for name, argv in commands:
        phase_runner(name, argv, output, work, clock)
        if name.startswith("evaluate-"):
            arm = name.removeprefix("evaluate-")
            if arm not in ARMS:
                raise ValueError("unknown D2 evaluation arm")
            backup = archive_run(output / "evaluation" / arm)
            event_file(output / "early-index.jsonl", "arm_archive", arm=arm, binding=bind,
                       path="evaluation/" + backup["archive"], **backup)


def budget_from_setup(path, booted_at):
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    _, hard = deadlines(booted_at, aware(booted_at))
    if not rows or rows[0].get("status") != "armed" or aware(rows[0]["deadline"]) != hard:
        raise ValueError("independent original-deadline setup guard must already be armed")


def observed_progress(output, cases):
    """Crash-safe denominator without inventing missing episode traces."""
    rows = []
    for arm in ARMS:
        completed, seen = 0, set()
        path = output / "evaluation" / arm / "episodes.jsonl"
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    row = json.loads(line)
                except ValueError:
                    break
                if completed >= 80 or row.get("case_id") != cases[completed]["id"] or row["case_id"] in seen:
                    raise ValueError("corrupt or reordered durable episode prefix")
                seen.add(row["case_id"])
                completed += 1
        rows.extend({"arm": arm, "case_id": c["id"], "durable_episode_present": i < completed,
                     "missing_is_not_an_observed_model_failure": i >= completed} for i, c in enumerate(cases))
    return {"total": 320, "durable_episodes": sum(r["durable_episode_present"] for r in rows), "rows": rows,
            "scope": "Presence inventory only, not a replay-verified score; every registered case retained"}


def finalize(output, status, failures, bind, hard, clock, *, evidence_kind="model", archive=evidence_backup,
             sleep=time.sleep, shutdown=None, grace_seconds=900):
    """Always attempt shutdown, even when backup, acknowledgment or logging fails."""
    shutdown = shutdown or (lambda: subprocess.run(shutdown_command(Path("/usr/bin/shutdown")), capture_output=True, timeout=30).returncode)
    acknowledged, index = False, None
    try:
        dump_new(output / "window-status.json", {"status": status, "failures": failures, "binding": bind,
            "finished_work_at_utc": clock.now().isoformat(), "provider_billing_stopped": "unknown"})
        backup = archive(output)
        index = {"version": "d2-backup-v1", "binding": bind, "evidence_kind": evidence_kind, "status": status, **backup}
        if backup["archive"] != "evidence.tar.gz":
            raise ValueError("unexpected backup name")
        dump_new(output / "backup-index.json", index)
        event_file(output / "events.jsonl", "backup_ready", index=index)
        until = min(hard - timedelta(seconds=60), clock.now() + timedelta(seconds=grace_seconds))
        while clock.now() < until:
            receipt = output / "off-instance-backup.json"
            if receipt.exists():
                try:
                    validate_receipt(receipt.read_bytes(), index, bind, kind=evidence_kind)
                    acknowledged = True
                    event_file(output / "events.jsonl", "server_receipt_consumed", sha256=index["sha256"])
                    break
                except (ValueError, KeyError, TypeError, OSError):
                    pass
            sleep(min(2, max(0, (until - clock.now()).total_seconds())))
        dump_new(output / "backup-copy-status.json", {"off_instance_acknowledged": acknowledged})
    except Exception as error:
        print(json.dumps({"backup_failure": type(error).__name__, "persistent_bytes_retained": True}), flush=True)
    finally:
        # Observation and billing are separate even if shutdown returns zero.
        try:
            event_file(output / "events.jsonl", "shutdown_requested", acknowledged=acknowledged)
        except Exception:
            pass
        try:
            code = shutdown()
            dump_new(output / "shutdown-request.json", {"returncode": code, "at_utc": clock.now().isoformat(),
                "provider_power_state_verified": False, "provider_billing_stopped": "unknown"})
        except Exception as error:
            print(json.dumps({"shutdown_error": type(error).__name__, "independent_guard_retained": True}), flush=True)
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ("model-dir", "model-manifest", "prepared-dir", "adapters-root", "tokenizer-dir", "output-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--expected-code-commit", required=True)
    parser.add_argument("--hourly-cny", type=float, required=True)
    parser.add_argument("--booted-at")
    parser.add_argument("--setup-guard", type=Path)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--shutdown-when-done", action="store_true")
    args = parser.parse_args()
    plan = verify_plan(args.prepared_dir)
    if args.hourly_cny != BUDGET["hourly_cny"]:
        raise ValueError("quote differs from reviewed D2 budget")
    commands = phases(args.model_dir, args.model_manifest, args.prepared_dir, args.adapters_root,
                      args.tokenizer_dir, args.output_dir, args.expected_code_commit)
    if not args.execute:
        print(json.dumps({"dry_run": True, "gpu_calls": 0, "budget": BUDGET, "calibration": plan["calibration_case_ids"],
                          "estimate": plan["estimate_rule"], "phases": commands}, indent=2))
        return 0
    if (platform.system() != "Linux" or not Path("/root/autodl-tmp").is_dir() or not args.booted_at
            or not args.shutdown_when_done or args.setup_guard is None):
        raise ValueError("authorized AutoDL opening and pre-armed setup guard required")
    work, hard = deadlines(args.booted_at, utcnow())
    budget_from_setup(args.setup_guard, args.booted_at)
    if (args.output_dir.exists() or args.output_dir.resolve().parent != Path("/root/autodl-tmp/liftcut/runs")
            or not args.output_dir.name.startswith("d2-") or command(["git", "status", "--porcelain"], ROOT)
            or command(["git", "rev-parse", "HEAD"], ROOT) != args.expected_code_commit):
        raise ValueError("fresh persistent run and exact clean committed checkout required")
    args.output_dir.mkdir(parents=True, exist_ok=False)
    output, clock, status, failures = args.output_dir, Clock(), "partial", []
    bind = binding(plan, args.expected_code_commit, args.booted_at)
    dump_new(output / "opening.json", {"binding": bind, "booted_at_proxy": args.booted_at,
        "budget": BUDGET, "evidence_kind": "model", "started_at_utc": utcnow().isoformat()})
    try:
        with (output / "deadline-guard.log").open("x") as stream:
            guard = subprocess.Popen([sys.executable, str(ROOT / "shutdown_guard.py"), "--arm",
                "--deadline", hard.isoformat(), "--receipt", str(output / "deadline-guard.jsonl")],
                stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        wait_guard_armed(guard, output / "deadline-guard.jsonl")
        if shutil.disk_usage(output).free < 3_000_000_000:
            raise ValueError("less than 3GB experiment disk free; do not expand disk automatically")
        verify_model(args.model_dir, args.model_manifest)
        verify_adapters(args.adapters_root)
        execute_phases(commands, output, bind, work, clock)
        status = "complete"
    except Exception as error:
        failures.append({"type": type(error).__name__, "message": str(error)})
    finally:
        try:
            from d2_execution import ordered_cases
            from counterfactual_diagnostics import load_prepared
            dump_new(output / "presence.json", observed_progress(output, ordered_cases(load_prepared(args.prepared_dir))))
        except Exception as error:
            failures.append({"presence_inventory_error": type(error).__name__})
            status = "partial"
        finalize(output, status, failures, bind, hard, clock)
    return 0 if status == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
