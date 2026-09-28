"""Explicitly arm a <=4 hour AutoDL shutdown deadline, independently of SSH."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import subprocess
import time


def shutdown_command(path):
    with path.open("rb") as stream:
        prefix = stream.read(4)
    # Some AutoDL images install a shell snippet without a shebang. Direct
    # subprocess execution raises Exec format error even when it is executable.
    return [str(path)] if prefix.startswith((b"#!", b"\x7fELF")) else ["/bin/bash", str(path)]


def remaining_seconds(deadline, now):
    cutoff = datetime.fromisoformat(deadline)
    if cutoff.tzinfo is None:
        raise ValueError("deadline must include a UTC offset")
    remaining = (cutoff - now).total_seconds()
    if not 0 < remaining <= 4 * 3600:
        raise ValueError("deadline must be in the next four hours")
    return remaining


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deadline", required=True, help="Absolute ISO8601 cutoff with UTC offset")
    parser.add_argument("--receipt", type=Path, required=True, help="New log file outside the Git checkout")
    parser.add_argument("--arm", action="store_true")
    args = parser.parse_args()
    if not args.arm or platform.system() != "Linux" or not Path("/root/autodl-tmp").is_dir():
        parser.error("requires --arm on the intended Linux AutoDL instance")
    now = datetime.now(timezone.utc)
    remaining = remaining_seconds(args.deadline, now)
    command = shutdown_command(Path("/usr/bin/shutdown"))
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    with args.receipt.open("x", encoding="utf-8") as stream:
        def log(status, **extra):
            stream.write(json.dumps({"status": status, "at_utc": datetime.now(timezone.utc).isoformat(), **extra}) + "\n")
            stream.flush()
        log("armed", deadline=args.deadline, command=command)
        end = time.monotonic() + remaining
        while time.monotonic() < end:
            time.sleep(min(30, max(0, end - time.monotonic())))
        log("shutdown_requested")
        # Avoid publishing platform response bodies, which could contain secrets.
        result = subprocess.run(command, capture_output=True, timeout=30)
        log("command_returned", returncode=result.returncode)
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
