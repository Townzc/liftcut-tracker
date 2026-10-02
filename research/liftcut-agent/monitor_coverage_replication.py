"""Local R1 collector: no training, remote commands, reboot, or automatic reconnect.

Default is an offline preflight. --connect explicitly attaches to an already
running, authorized window. Credentials are prompted, never serialized.
"""
import argparse
from datetime import datetime, timedelta, timezone
import getpass
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT / "src"))
from prepare_coverage_replication import (ARMS, REVIEWED, SOURCE_FILES, arm_binding,
    read, require_binding, run_binding, verify_prepared)
from restore_coverage_replication import validate_index
from replication_receipt_transfer import transfer_receipt, validate_receipt
from server_workspace import sha256, dump_new

FROZEN_COMMIT = "f18cb5820881a048b19b6007fc4ca231dfd64de9"
FROZEN_REPORT = "76bd66338dfc64ef9f1884a68c4aca83324557b7ce1d4342fc0657417c9f0b52"
PATH_FIELDS = ("downloads", "restored", "operations", "prepared", "diagnostic",
               "replication", "tokenizer", "restore_python", "known_hosts")


def utcnow():
    return datetime.now(timezone.utc)


def aware(value):
    result = datetime.fromisoformat(value)
    if result.tzinfo is None:
        raise ValueError("time must include its UTC offset")
    return result


class TimeBudget:
    """Absolute deadline with a monotonic backstop against local clock rollback."""
    def __init__(self, deadline, *, now=utcnow, monotonic=time.monotonic):
        if deadline.tzinfo is None:
            raise ValueError("aware deadline required")
        self.deadline, self.clock, self.monotonic = deadline, now, monotonic
        self.started, self.tick = now(), monotonic()

    def now(self):
        return max(self.clock(), self.started + timedelta(seconds=self.monotonic() - self.tick))

    def remaining(self):
        return max(0.0, (self.deadline - self.now()).total_seconds())

    def check(self):
        if self.remaining() <= 0:
            raise TimeoutError("original hard deadline reached; no reconnect or extension")


def parse_config(raw, base=REPO):
    allowed = {"version", "seed", "execution_commit", "remote_run", "remote_ops", "booted_at",
               "hourly_cny", "ssh_host", "ssh_port", "ssh_user", *PATH_FIELDS}
    if set(raw) != allowed or raw["version"] != 1:
        raise ValueError("unexpected monitor configuration fields/version (never store credentials)")
    cfg = dict(raw)
    if type(cfg["seed"]) is not int or cfg["seed"] not in (43, 44):
        raise ValueError("registered execution seed required")
    if cfg["execution_commit"] != FROZEN_COMMIT or cfg["hourly_cny"] != 2.18:
        raise ValueError("frozen code and reviewed price required")
    for name, prefix in (("remote_run", "coverage-replication-v1-seed"),
                         ("remote_ops", "coverage-replication-seed")):
        value = cfg[name]
        p = PurePosixPath(value)
        suffix = "-ops-" if name == "remote_ops" else "-"
        if (str(p) != value or p.parent != PurePosixPath("/root/autodl-tmp/liftcut/runs")
                or not re.fullmatch(prefix + str(cfg["seed"]) + suffix + r"[A-Za-z0-9_-]+", p.name)):
            raise ValueError("remote path must identify the selected seed in persistent runs")
    if (not isinstance(cfg["ssh_host"], str) or not re.fullmatch(r"[A-Za-z0-9.-]+", cfg["ssh_host"])
            or type(cfg["ssh_port"]) is not int or not 1 <= cfg["ssh_port"] <= 65535
            or not re.fullmatch(r"[A-Za-z0-9_-]+", cfg["ssh_user"])):
        raise ValueError("explicit SSH endpoint required")
    cfg["booted_at"] = aware(cfg["booted_at"]) if cfg["booted_at"] is not None else None
    for name in PATH_FIELDS:
        p = Path(cfg[name]).expanduser()
        cfg[name] = (base / p).resolve() if not p.is_absolute() else p.resolve()
    outputs = [cfg[k] for k in ("downloads", "restored", "operations")]
    inputs = [cfg[k] for k in ("prepared", "diagnostic", "replication", "tokenizer")]
    if any(a == b or a.is_relative_to(b) or b.is_relative_to(a)
           for i, a in enumerate(outputs) for b in outputs[i + 1:] + inputs):
        raise ValueError("input and output directories must not overlap")
    return cfg


def offline_preflight(cfg):
    if sha256(REVIEWED) != FROZEN_REPORT:
        raise ValueError("frozen preparation report changed")
    report = read(REVIEWED)
    for name in SOURCE_FILES:
        if sha256(ROOT / name) != report["source_sha256"][name]:
            raise ValueError("frozen execution/recovery source changed: " + name)
    plan = verify_prepared(cfg["prepared"], cfg["diagnostic"], cfg["replication"], cfg["seed"])
    if not cfg["restore_python"].is_file() or not cfg["tokenizer"].is_dir():
        raise ValueError("local restoration Python and pinned tokenizer must already exist")
    parent = cfg["downloads"]
    while not parent.exists():
        parent = parent.parent
    free = shutil.disk_usage(parent).free
    if free < 3_000_000_000:
        raise ValueError("at least 3GB local free space required; preserve old backups")
    return plan, {"offline_only": True, "seed": cfg["seed"], "execution_commit": FROZEN_COMMIT,
        "frozen_sources_verified": list(SOURCE_FILES), "local_free_bytes": free,
        "run_binding": run_binding(plan, FROZEN_COMMIT), "gpu_calls": 0,
        "server_state_verified": False, "boot_time_configured": cfg["booted_at"] is not None}


def validate_remote_state(cfg, opening, launch, guard_rows, setup_rows, binding, plan):
    boot = cfg["booted_at"]
    if boot is None:
        raise ValueError("explicit authorized window boot time required")
    hard, work = boot + timedelta(minutes=180), boot + timedelta(minutes=150)
    if (aware(opening["booted_at_proxy"]) != boot or aware(opening["deadline"]) != hard
            or aware(opening["work_cutoff"]) != work
            or opening["expected_code_commit"] != FROZEN_COMMIT
            or opening["hourly_cny_assumed"] != 2.18):
        raise ValueError("remote opening does not match the original budget window")
    require_binding(binding, run_binding(plan, FROZEN_COMMIT))
    for rows in (guard_rows, setup_rows):
        if not rows or rows[0].get("status") != "armed" or aware(rows[0]["deadline"]) != hard:
            raise ValueError("both original-deadline guard armed records required")
    argv = launch["argv"]
    if (not isinstance(argv, list) or len(argv) < 2
            or argv[1] != f"/root/autodl-tmp/liftcut/code/{FROZEN_COMMIT}/research/liftcut-agent/run_coverage_replication_window.py"):
        raise ValueError("controller must run frozen source")
    values = {"--model-dir", "--model-manifest", "--prepared-dir", "--diagnostic-dir",
              "--replication-dir", "--tokenizer-dir", "--output-dir", "--seed",
              "--expected-code-commit", "--hourly-cny", "--booted-at"}
    switches = {"--execute", "--shutdown-when-done"}
    parsed, cursor = {}, 2
    while cursor < len(argv):
        flag = argv[cursor]
        if not isinstance(flag, str) or flag not in values | switches or flag in parsed:
            raise ValueError("controller requires unique canonical full flags; no equals forms or abbreviations")
        if flag in switches:
            parsed[flag] = True
            cursor += 1
        else:
            if (cursor + 1 >= len(argv) or not isinstance(argv[cursor + 1], str)
                    or not argv[cursor + 1] or argv[cursor + 1].startswith("--")):
                raise ValueError("controller flag missing value")
            parsed[flag] = argv[cursor + 1]
            cursor += 2
    if set(parsed) != values | switches:
        raise ValueError("controller launch arguments incomplete")
    for flag, expected in (("--seed", str(cfg["seed"])), ("--output-dir", cfg["remote_run"]),
            ("--expected-code-commit", FROZEN_COMMIT), ("--hourly-cny", "2.18")):
        if parsed[flag] != expected:
            raise ValueError("controller launch binding mismatch: " + flag)
    if aware(parsed["--booted-at"]) != boot:
        raise ValueError("controller launch boot mismatch")
    if not 0 <= (aware(launch["at_utc"]) - boot).total_seconds() <= 600:
        raise ValueError("controller was not launched within the original ten-minute allowance")


def io_budget(sftp, budget):
    budget.check()
    sftp.get_channel().settimeout(min(15.0, budget.remaining()))


def remote_bytes(sftp, path, budget, *, limit=262144, tail=False):
    io_budget(sftp, budget)
    try:
        size = sftp.stat(path).st_size
        if size > limit and not tail:
            raise ValueError("remote evidence exceeds size limit")
        io_budget(sftp, budget)
        with sftp.open(path, "rb") as stream:
            if size > limit:
                stream.seek(size - limit)
            data = stream.read(limit + (0 if tail else 1))
        budget.check()
        if len(data) > limit:
            raise ValueError("remote evidence grew beyond size limit")
        return data
    except OSError as exc:
        if getattr(exc, "errno", None) == 2:
            return None
        raise


def json_lines(data):
    rows = []
    for line in (data or b"").decode("utf-8").splitlines():
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                rows.append(obj)
        except ValueError:
            pass  # A live log/tail may begin or end with one incomplete line.
    return rows


def archive_identity(item, plan):
    part = item["part"]
    if part not in (*ARMS, "evidence"):
        raise ValueError("unexpected archive part")
    name = part + ".tar.gz"
    if (item["archive"] != name or item["path"] != ("" if part == "evidence" else "training/") + name
            or type(item["bytes"]) is not int or not 0 < item["bytes"] <= 2_000_000_000
            or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])):
        raise ValueError("invalid archive metadata")
    require_binding(item["binding"], run_binding(plan, FROZEN_COMMIT) if part == "evidence"
                    else arm_binding(plan, FROZEN_COMMIT, part))
    return {k: item[k] for k in ("part", "archive", "path", "bytes", "sha256", "binding")}


def download_archive(sftp, item, cfg, plan, budget, emit, observed):
    identity = archive_identity(item, plan)
    part = item["part"]
    if part in observed and observed[part] != identity:
        raise ValueError("early archive metadata changed before final index")
    observed[part] = identity
    target = cfg["downloads"] / item["archive"]
    budget.check()
    if target.exists():
        if target.stat().st_size != item["bytes"] or sha256(target) != item["sha256"]:
            raise ValueError("existing local archive differs; never overwrite")
        budget.check()
        return target
    temporary = target.with_name(target.name + "." + uuid.uuid4().hex + ".partial")
    emit("download_started", part=part, bytes=item["bytes"])
    io_budget(sftp, budget)
    sftp.get(cfg["remote_run"] + "/" + item["path"], str(temporary), callback=lambda *_: budget.check())
    budget.check()
    if temporary.stat().st_size != item["bytes"] or sha256(temporary) != item["sha256"]:
        raise ValueError("downloaded archive integrity mismatch; partial retained")
    budget.check()
    # Monitor lock serializes our collectors. Never replace an existing backup.
    if target.exists():
        raise ValueError("archive appeared during transfer; do not overwrite")
    temporary.rename(target)
    emit("archive_bytes_verified", part=part, bytes=item["bytes"], sha256=item["sha256"])
    return target


def restore_and_publish(sftp, index, cfg, plan, budget, emit, *, runner=subprocess.run):
    validate_index(index, plan, FROZEN_COMMIT, allow_partial=True)
    remaining = budget.remaining() - 90
    if remaining <= 0:
        raise TimeoutError("no restoration allowance before original hard deadline")
    attempt = uuid.uuid4().hex
    output = cfg["restored"] / attempt
    log_path = cfg["operations"] / ("restore-" + attempt + ".log")
    argv = [str(cfg["restore_python"]), str(ROOT / "restore_coverage_replication.py"),
        "--archive-dir", str(cfg["downloads"]), "--prepared-dir", str(cfg["prepared"]),
        "--diagnostic-dir", str(cfg["diagnostic"]), "--replication-dir", str(cfg["replication"]),
        "--tokenizer-dir", str(cfg["tokenizer"]), "--seed", str(cfg["seed"]),
        "--expected-code-commit", FROZEN_COMMIT, "--output-dir", str(output)]
    if index["status"] != "complete":
        argv.append("--allow-partial")
    emit("restore_started", attempt=attempt, run_status=index["status"])
    with log_path.open("x", encoding="utf-8") as log:
        runner(argv, cwd=REPO, check=True, stdout=log, stderr=subprocess.STDOUT, timeout=remaining)
    budget.check()
    receipt_path = output / "off-instance-backup.json"
    receipt = validate_receipt(receipt_path.read_bytes(), index, plan, FROZEN_COMMIT)
    emit("off_instance_verified", attempt=attempt, receipt=receipt)
    io_budget(sftp, budget)
    # No optional log/network reads between actual recovery and receipt publication.
    return transfer_receipt(sftp, receipt_path, cfg["remote_run"], index, plan, FROZEN_COMMIT,
                            budget.deadline, now=budget.now, emit=emit)


def persist_json(path, payload):
    if path.exists():
        if read(path) != payload:
            raise ValueError("saved monitor identity/evidence differs: " + path.name)
    else:
        dump_new(path, payload)


def collect(sftp, cfg, plan, budget, emit, *, sleep=time.sleep):
    def required(path):
        data = remote_bytes(sftp, path, budget)
        if data is None:
            raise ValueError("required startup evidence missing")
        return data
    opening = json.loads(required(cfg["remote_ops"] + "/opening.json"))
    launch = json.loads(required(cfg["remote_ops"] + "/controller-launch.json"))
    setup = json_lines(required(cfg["remote_ops"] + "/setup-guard.jsonl"))
    guard = json_lines(required(cfg["remote_run"] + "/deadline-guard.jsonl"))
    binding = json.loads(required(cfg["remote_run"] + "/run-binding.json"))
    validate_remote_state(cfg, opening, launch, guard, setup, binding, plan)
    for name, payload in (("opening.json", opening), ("controller-launch.json", launch),
                          ("setup-guard-records.json", setup), ("deadline-guard-records.json", guard)):
        persist_json(cfg["operations"] / name, payload)
    emit("monitor_ready", seed=cfg["seed"], execution_commit=FROZEN_COMMIT,
         deadline=budget.deadline.isoformat(), guard_records_observed=True,
         guard_process_liveness_verified=False, provider_power_state_verified=False)
    observed, phase, invalid_index_reads, receipt_result, milestones = {}, None, 0, None, {}
    run_status, local_restore_verified, server_acknowledged = None, False, None
    while budget.remaining() > 0:
        raw = remote_bytes(sftp, cfg["remote_ops"] + "/controller.log", budget, tail=True)
        records = json_lines(raw)
        (cfg["operations"] / "controller-latest.log").write_bytes(raw or b"")
        phases = [r for r in records if "phase" in r]
        if phases and phases[-1] != phase:
            phase = phases[-1]
            emit("phase", record=phase)
        if receipt_result is None:
            for arm in ARMS:
                progress = json_lines(remote_bytes(sftp,
                    cfg["remote_run"] + "/training/" + arm + "/training.jsonl", budget, limit=4096, tail=True))
                if progress:
                    row = progress[-1]
                    step = row.get("step")
                    if type(step) is int and 0 <= step <= 126 and milestones.get(arm) != step // 10:
                        milestones[arm] = step // 10
                        emit("training_progress", arm=arm, step=step, loss=row.get("loss"),
                             elapsed_seconds=row.get("elapsed_seconds"))
            for row in records:
                if "adapter_backup_ready" in row:
                    download_archive(sftp, row["adapter_backup_ready"], cfg, plan, budget, emit, observed)
            data = remote_bytes(sftp, cfg["remote_run"] + "/backup-ready.json", budget)
            if data is not None:
                try:
                    index = json.loads(data)
                except ValueError:
                    invalid_index_reads += 1
                    if invalid_index_reads >= 3:
                        raise ValueError("backup index remains incomplete after three bounded reads")
                    emit("backup_index_read_retry", attempt=invalid_index_reads)
                    sleep(min(1, budget.remaining()))
                    continue
                validate_index(index, plan, FROZEN_COMMIT, allow_partial=True)
                final_items = {item["part"]: archive_identity(item, plan) for item in index["archives"]}
                if any(final_items.get(part) != identity for part, identity in observed.items()):
                    raise ValueError("final index differs from early downloaded archive metadata")
                persist_json(cfg["downloads"] / "backup-ready.json", index)
                for item in index["archives"]:
                    download_archive(sftp, item, cfg, plan, budget, emit, observed)
                emit("all_archives_downloaded", run_status=index["status"], archive_count=len(index["archives"]))
                receipt_result = restore_and_publish(sftp, index, cfg, plan, budget, emit)
                run_status, local_restore_verified = index["status"], True
                if receipt_result["status"] not in ("published", "already_present"):
                    emit("monitor_receipt_unconfirmed", result=receipt_result, provider_power_state_verified=False)
                    return {**receipt_result, "run_status": run_status, "local_restore_verified": True,
                            "complete_study_replayed": run_status == "complete", "server_acknowledged": None,
                            "provider_power_state_verified": False}
        if receipt_result is not None:
            for name in ("backup-copy-status.json", "shutdown-request.json"):
                data = remote_bytes(sftp, cfg["remote_run"] + "/" + name, budget)
                if data is not None:
                    obj = json.loads(data)
                    persist_json(cfg["operations"] / name, obj)
                    emit("server_receipt_observed", file=name, receipt=obj, provider_power_state_verified=False)
                    if name == "backup-copy-status.json":
                        if type(obj.get("off_instance_acknowledged")) is not bool:
                            raise ValueError("invalid server backup acknowledgment observation")
                        server_acknowledged = obj["off_instance_acknowledged"]
                    if name == "shutdown-request.json":
                        if type(obj.get("returncode")) is not int:
                            raise ValueError("invalid shutdown-request observation")
                        return {"status": "shutdown_request_observed" if obj["returncode"] == 0 else "shutdown_request_failed",
                                "returncode": obj["returncode"], "run_status": run_status,
                                "local_restore_verified": local_restore_verified,
                                "complete_study_replayed": run_status == "complete",
                                "server_acknowledged": server_acknowledged, "provider_power_state_verified": False}
        sleep(min(5 if receipt_result else 30, budget.remaining()))
    emit("monitor_deadline_reached", provider_power_state_verified=False)
    return {"status": "deadline_reached", "run_status": run_status,
            "local_restore_verified": local_restore_verified,
            "complete_study_replayed": local_restore_verified and run_status == "complete",
            "server_acknowledged": server_acknowledged, "provider_power_state_verified": False}


def connect(cfg, plan):
    if cfg["booted_at"] is None or cfg["booted_at"] > utcnow():
        raise ValueError("actual authorized opening time required before connecting")
    budget = TimeBudget(cfg["booted_at"] + timedelta(minutes=180))
    budget.check()
    if not cfg["known_hosts"].is_file() or cfg["ssh_host"].endswith(".invalid"):
        raise ValueError("current endpoint and verified known_hosts required")
    for name in ("downloads", "restored", "operations"):
        cfg[name].mkdir(parents=True, exist_ok=True)
    lock_path = cfg["operations"] / "monitor.lock"
    with lock_path.open("x", encoding="utf-8") as lock:
        lock.write(str(os.getpid()))
    client = None
    transport_guard = None
    password = None
    def emit(event, **data):
        row = {"at_utc": utcnow().isoformat(), "event": event, **data}
        with (cfg["operations"] / "events.jsonl").open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            stream.flush()
        print(json.dumps(row, ensure_ascii=False), flush=True)
    try:
        identity = {k: (v.isoformat() if isinstance(v, datetime) else str(v) if isinstance(v, Path) else v)
                    for k, v in cfg.items()}
        persist_json(cfg["operations"] / "monitor-config.json", identity)
        import paramiko  # Optional local transport only; never needed for CPU tests or dry-run.
        password = getpass.getpass("AutoDL monitor SSH password: ")
        budget.check()
        client = paramiko.SSHClient()
        client.load_host_keys(str(cfg["known_hosts"]))
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        transport_guard = threading.Timer(budget.remaining(), client.close)
        transport_guard.daemon = True
        transport_guard.start()
        timeout = min(15, budget.remaining())
        client.connect(cfg["ssh_host"], port=cfg["ssh_port"], username=cfg["ssh_user"],
            password=password, look_for_keys=False, allow_agent=False, timeout=timeout,
            auth_timeout=timeout, banner_timeout=timeout)
        password = None
        budget.check()
        transport = client.get_transport()
        transport.set_keepalive(20)
        channel = transport.open_session(timeout=min(15, budget.remaining()))
        channel.settimeout(min(15, budget.remaining()))
        # Paramiko 2.x subsystem negotiation waits on an Event, not socket timeout.
        # Closing the channel also bounds this negotiation without remote exec.
        negotiation_guard = threading.Timer(min(15, budget.remaining()), channel.close)
        negotiation_guard.daemon = True
        negotiation_guard.start()
        try:
            channel.invoke_subsystem("sftp")
            sftp = paramiko.SFTPClient(channel)
        finally:
            negotiation_guard.cancel()
        return collect(sftp, cfg, plan, budget, emit)
    except Exception as exc:
        # Do not echo arbitrary transport errors: they may contain local/remote access details.
        emit("monitor_stopped", error=type(exc).__name__, provider_power_state_verified=False)
        raise
    finally:
        password = None
        if transport_guard is not None:
            transport_guard.cancel()
        if client is not None:
            client.close()
        lock_path.unlink()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--connect", action="store_true", help="attach to an already authorized running window")
    args = p.parse_args()
    try:
        cfg = parse_config(read(args.config))
        plan, report = offline_preflight(cfg)
        if not args.connect:
            print(json.dumps(report, indent=2))
            return 0
        result = connect(cfg, plan)
        print(json.dumps(result))
        return 0 if (result["status"] == "shutdown_request_observed"
                     and result["complete_study_replayed"] and result["server_acknowledged"] is True) else 2
    except Exception as exc:
        # Tracebacks can include arbitrary transport messages. Preserve the type
        # and private event trail without echoing access details to the terminal.
        print(json.dumps({"status": "failed", "error": type(exc).__name__,
                          "provider_power_state_verified": False}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
