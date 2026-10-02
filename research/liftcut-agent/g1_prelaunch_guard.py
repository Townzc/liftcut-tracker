"""Stop a G1 rental at the original 10-minute setup limit if no run opened.

Standard library only. This extra setup guard does not replace or reset the
frozen controller's 150/180-minute deadlines, and never starts inference.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import platform
import re
import subprocess
import time


def opening_matches(path, boot, commit):
    try:
        opening = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if not isinstance(opening, dict) or not isinstance(opening.get("binding"), dict):
        return False
    bind = opening.get("binding", {})
    try:
        started = datetime.fromisoformat(opening["started_at_utc"])
        in_time = boot <= started <= boot + timedelta(minutes=10)
    except (KeyError, ValueError, TypeError):
        return False
    return (bind.get("code_commit") == commit and bind.get("booted_at_proxy") == boot.isoformat()
            and in_time
            and opening.get("evidence_kind") == "model"
            and bind.get("work_cutoff") == (boot + timedelta(minutes=150)).isoformat()
            and bind.get("hard_cutoff") == (boot + timedelta(minutes=180)).isoformat())


def watch(opening, boot, commit, log, shutdown, *, now=lambda: datetime.now(timezone.utc), tick=time.monotonic, sleep=time.sleep):
    cutoff = boot + timedelta(minutes=10)
    remaining = (cutoff - now()).total_seconds()
    if remaining > 600:
        raise ValueError("setup guard cannot use a future boot time")
    # A delayed process start must immediately close an expired setup window.
    end = tick() + max(0., remaining)
    log("armed", deadline=cutoff.isoformat())
    while tick() < end and now() < cutoff:
        if opening_matches(opening, boot, commit):
            log("controller_opening_observed")
            return "opened"
        sleep(min(1., max(0., end - tick()), max(0., (cutoff - now()).total_seconds())))
    if opening_matches(opening, boot, commit):
        log("controller_opening_observed")
        return "opened"
    log("shutdown_requested", reason="original_setup_deadline_without_controller_opening")
    result = shutdown()
    log("shutdown_return", returncode=result, provider_billing_stopped="unknown")
    return "shutdown_requested"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--booted-at", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--opening", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--arm", action="store_true")
    args = parser.parse_args()
    boot = datetime.fromisoformat(args.booted_at)
    root = Path("/root/autodl-tmp/liftcut/runs")
    if (not args.arm or platform.system() != "Linux" or boot.utcoffset() is None
            or not re.fullmatch(r"[0-9a-f]{40}", args.commit)
            or args.opening.resolve().parent.parent != root or args.receipt.resolve().parent.parent != root
            or not args.opening.parent.name.startswith("g1-run-") or not args.receipt.parent.name.startswith("g1-ops-")):
        raise ValueError("explicit intended G1 paths and aware original boot required")
    from shutdown_guard import shutdown_command
    with args.receipt.open("x", encoding="utf-8") as stream:
        def log(event, **values):
            stream.write(json.dumps({"event":event,"at_utc":datetime.now(timezone.utc).isoformat(),**values}) + "\n")
            stream.flush()
        watch(args.opening, boot, args.commit, log,
              lambda: subprocess.run(shutdown_command(Path("/usr/bin/shutdown")), capture_output=True, timeout=30).returncode)
