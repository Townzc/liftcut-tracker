"""R1: one seed per bounded AutoDL window; dry-run by default, no rental/start/reconnect."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

from state_coverage import ROOT, ARMS
from liftcut_agent.interactive import digest
from prepare_coverage_replication import REVIEWED, RUN_SEEDS, verify_prepared, run_binding, arm_binding, require_seed
from prepare_state_diagnostics import verify_prepared as verify_diagnostics
from run_controlled_window import evidence_backup
from run_recovery_window import archive_run, execute_phases, wait_guard_armed
from server_workspace import command, dump_new
from shutdown_guard import shutdown_command


def phases(model, manifest, prepared, diagnostic, replication, tokenizer, output, seed, commit):
    require_seed(seed, executing=True)
    common = ["--model-dir", str(model), "--model-manifest", str(manifest), "--prepared-dir", str(prepared),
              "--diagnostic-dir", str(diagnostic), "--replication-dir", str(replication),
              "--seed", str(seed), "--expected-code-commit", commit]
    result = []
    for arm in ARMS:
        result.append(("train-" + arm, [sys.executable, str(ROOT / "gpu_train_coverage_replication.py"), *common,
            "--arm", arm, "--output-dir", str(output / "training" / arm), "--allow-gpu"]))
        result.append(("evaluate-" + arm, [sys.executable, str(ROOT / "gpu_coverage_replication.py"), *common,
            "--arm", arm, "--training-dir", str(output / "training" / arm),
            "--output-dir", str(output / "evaluation" / arm), "--allow-gpu"]))
    result.append(("audit-tokens", [sys.executable, str(ROOT / "audit_coverage_tokens.py"), "--run-dir", str(output),
        "--tokenizer-dir", str(tokenizer), "--output", str(output / "generation-token-audit.json")]))
    result.append(("audit", [sys.executable, str(ROOT / "audit_coverage_replication.py"), "--run-dir", str(output),
        "--prepared-dir", str(prepared), "--diagnostic-dir", str(diagnostic), "--replication-dir", str(replication),
        "--tokenizer-dir", str(tokenizer), "--seed", str(seed), "--output", str(output / "comparison.json")]))
    return result

def deadline(booted_at, now):
    boot = datetime.fromisoformat(booted_at)
    if boot.tzinfo is None or boot > now or (now - boot).total_seconds() > 600:
        raise ValueError("aware boot time within the first ten minutes required; do not extend budget")
    return boot + timedelta(minutes=180)


def valid_ack(path, index):
    try:
        if index["status"] not in {"complete", "failed"}:
            return False
        receipt = json.loads(path.read_text(encoding="utf-8"))
        if (receipt["inventory_digest"] != digest(index) or receipt["all_archive_files_verified"] is not True
                or receipt["run_status"] != index["status"] or receipt["run_binding"] != index["run_binding"]):
            return False
        return (receipt["complete_study_replayed"] is True and receipt["episodes_replayed"] == 124
                and receipt["adapter_files_verified"] is True and receipt["token_ids_verified"] is True) if index["status"] == "complete" else (receipt["complete_study_replayed"] is False and receipt["episodes_replayed"] == 0
                    and receipt["adapter_files_verified"] is False and receipt["token_ids_verified"] is False)
    except (OSError, ValueError, KeyError, TypeError):
        return False


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model-dir", type=Path, required=True)
    p.add_argument("--model-manifest", type=Path, required=True)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--diagnostic-dir", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--replication-dir", type=Path, required=True)
    p.add_argument("--tokenizer-dir", type=Path, required=True)
    p.add_argument("--seed", type=int, choices=RUN_SEEDS, required=True)
    p.add_argument("--expected-code-commit", required=True)
    p.add_argument("--hourly-cny", type=float, required=True)
    p.add_argument("--booted-at")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--shutdown-when-done", action="store_true")
    args = p.parse_args()
    plan = verify_prepared(args.prepared_dir, args.diagnostic_dir, args.replication_dir, args.seed)
    verify_diagnostics(args.diagnostic_dir)
    binding = run_binding(plan, args.expected_code_commit)
    budget = json.loads(REVIEWED.read_text(encoding="utf-8"))["budget"]
    if args.hourly_cny != budget["hourly_cny_assumed"]:
        raise ValueError("price differs from reviewed replication budget")
    commands = phases(args.model_dir, args.model_manifest, args.prepared_dir, args.diagnostic_dir,
                      args.replication_dir, args.tokenizer_dir, args.output_dir, args.seed, args.expected_code_commit)
    if not args.execute:
        print(json.dumps({"dry_run": True, "gpu_calls": 0, "budget": budget, "run_binding": binding, "phases": commands}, indent=2))
        return
    if (platform.system() != "Linux" or not Path("/root/autodl-tmp").is_dir()
            or not args.shutdown_when_done or not args.booted_at):
        p.error("AutoDL, start time and shutdown-when-done are required")
    if not args.output_dir.resolve().is_relative_to(Path("/root/autodl-tmp/liftcut/runs")):
        raise ValueError("output must be in persistent experiment runs")
    if args.output_dir.exists() or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("new output and clean committed code required")
    if command(["git", "rev-parse", "HEAD"], ROOT) != args.expected_code_commit:
        raise ValueError("unexpected execution commit")
    cutoff = deadline(args.booted_at, datetime.now(timezone.utc))
    args.output_dir.mkdir(parents=True, exist_ok=False)
    dump_new(args.output_dir / "run-binding.json", binding)
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
                archives.append({"part": arm, "binding": arm_binding(plan, args.expected_code_commit, arm), "path": "training/" + backup["archive"], **backup})
                print(json.dumps({"adapter_backup_ready": archives[-1]}), flush=True)
        status = "complete"
    except (OSError, ValueError, TimeoutError, subprocess.SubprocessError) as exc:
        failures.append(type(exc).__name__ + ": " + str(exc))
    finally:
        try:
            dump_new(output / "window-status.json", {"status": status, "failures": failures, "run_binding": binding,
                "booted_at_proxy": args.booted_at, "deadline": cutoff.isoformat(),
                "work_cutoff": (cutoff - timedelta(minutes=30)).isoformat(), "hourly_cny_assumed": args.hourly_cny,
                "code_commit": command(["git", "rev-parse", "HEAD"], ROOT), "test_episodes": 0,
                "backup_rule": "Four complete final-adapter training archives plus complete rollout/evidence archive"})
            # If a training process failed, preserve its partial logs too, but
            # never treat it as a complete trained arm or create a false report.
            for arm in ARMS:
                partial = output / "training" / arm
                if partial.exists() and arm not in {a["part"] for a in archives}:
                    backup = archive_run(partial)
                    archives.append({"part": arm, "binding": arm_binding(plan, args.expected_code_commit, arm), "path": "training/" + backup["archive"], **backup})
            backup = evidence_backup(output)
            archives.append({"part": "evidence", "binding": binding, "path": backup["archive"], **backup})
            index = {"archives": archives, "status": status, "run_binding": binding}
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
