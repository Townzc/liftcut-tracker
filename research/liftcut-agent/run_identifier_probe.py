"""Run a bounded identifier probe after the original GPU child finishes.

The original controller must be paused intentionally. Independent shutdown guards
remain active. Always resume that controller, so its audit/backup/shutdown runs.
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

from blind_recovery_ids import PROBE
from recovery_dataset import load_frozen
from server_workspace import command, dump_new


def process_state(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
    except FileNotFoundError:
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--controller-pid", type=int, required=True)
    parser.add_argument("--original-gpu-pid", type=int, required=True)
    parser.add_argument("--rollout-script", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-manifest", type=Path, required=True)
    parser.add_argument("--deadline", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not args.execute or sys.platform != "linux":
        parser.error("explicit --execute on the existing Linux instance required")
    cmdline = Path(f"/proc/{args.controller_pid}/cmdline").read_bytes().replace(b"\0", b" ").decode()
    if "run_recovery_window.py" not in cmdline or str(args.run_dir) not in cmdline or process_state(args.controller_pid) != "T":
        raise ValueError("expected the intentionally paused original controller")
    output = args.run_dir / "identifier-probe"
    status, error = "failed", None
    try:
        deadline = datetime.fromisoformat(args.deadline)
        if deadline.tzinfo is None or (deadline - datetime.now(timezone.utc)).total_seconds() > 7200:
            raise ValueError("invalid fixed deadline")
        output.mkdir(exist_ok=False)
        load_frozen(PROBE)
        shutil.copytree(PROBE, output / "cases")
        dump_new(output / "manifest.json", {"scope": "Post-hoc opaque-ID diagnostic; original training unchanged",
            "supervisor_commit": command(["git", "rev-parse", "HEAD"], Path(__file__).parent),
            "original_rollout_script": str(args.rollout_script), "deadline": args.deadline,
            "reason": "Original record/memory IDs contain category hints; invalidate original held-out claims"})
        while process_state(args.original_gpu_pid) not in {None, "Z"}:
            if (deadline - datetime.now(timezone.utc)).total_seconds() <= 600:
                raise TimeoutError("deadline while waiting for original GPU child")
            time.sleep(5)
        if not (args.run_dir / "evaluation/mixed/report.json").is_file():
            raise ValueError("original evaluation did not complete; skip probe")
        for arm in ("unadapted", "clean", "mixed"):
            remaining = (deadline - datetime.now(timezone.utc)).total_seconds() - 600
            if remaining <= 0:
                raise TimeoutError("soft deadline before next identifier probe arm")
            argv = [sys.executable, str(args.rollout_script), "--model-dir", str(args.model_dir),
                    "--model-manifest", str(args.model_manifest), "--cases", str(PROBE / "dev.jsonl"),
                    "--cases", str(PROBE / "test.jsonl"), "--output-dir", str(output / arm), "--allow-gpu"]
            if arm != "unadapted":
                argv.extend(["--adapter-dir", str(args.run_dir / "training" / arm / "final")])
            print(json.dumps({"phase": f"identifier-{arm}", "status": "started"}), flush=True)
            with (output / f"{arm}.log").open("x", encoding="utf-8") as log:
                subprocess.run(argv, check=True, timeout=remaining, stdin=subprocess.DEVNULL,
                               stdout=log, stderr=subprocess.STDOUT)
        status = "complete"
    except (OSError, ValueError, TimeoutError, subprocess.SubprocessError) as exc:
        error = type(exc).__name__ + ": " + str(exc)
    finally:
        try:
            if output.exists():
                dump_new(output / "status.json", {"status": status, "error": error,
                    "finished_at_utc": datetime.now(timezone.utc).isoformat()})
        finally:
            os.kill(args.controller_pid, signal.SIGCONT)
    return 0 if status == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
