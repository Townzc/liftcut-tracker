"""Single-connection G2 collector; offline preflight by default, never launches GPU."""
import argparse
from datetime import timedelta
import getpass
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import threading
import time
import uuid

from g2_execution import ARMS, ROOT, aware, binding, deadlines, read, utcnow, verify_plan, validate_opening
from d2_execution import event_file
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from prepare_counterfactual_diagnostics import verify_prepared as verify_d2
from g2_receipt_transfer import transfer_receipt, validate_index, validate_receipt
from monitor_coverage_replication import TimeBudget, io_budget, remote_bytes, json_lines, persist_json
from prepare_counterfactual_diagnostics import load_tokenizer
from server_workspace import dump_new, sha256

REPO = ROOT.parents[1]
PATHS = ("prepared", "diagnostic", "d2", "tokenizer", "restore_python", "known_hosts", "downloads", "restored", "operations")


def parse_config(raw, base=REPO):
    keys = {"version", "execution_commit", "remote_run", "remote_ops", "booted_at", "hourly_cny",
            "ssh_host", "ssh_port", "ssh_user", *PATHS}
    if set(raw) != keys or raw["version"] != "g2-monitor-v1" or raw["hourly_cny"] != 2.18:
        raise ValueError("exact G2 monitor schema/price required; never store credentials")
    cfg = dict(raw)
    if not re.fullmatch(r"[0-9a-f]{40}", cfg["execution_commit"]):
        raise ValueError("full reviewed execution commit required")
    for name, prefix in (("remote_run", "g2-run-"), ("remote_ops", "g2-ops-")):
        p = PurePosixPath(cfg[name])
        if (str(p) != cfg[name] or p.parent != PurePosixPath("/root/autodl-tmp/liftcut/runs")
                or not re.fullmatch(prefix + r"[A-Za-z0-9_-]+", p.name)):
            raise ValueError("canonical persistent G2 paths required")
    if (not re.fullmatch(r"[A-Za-z0-9.-]+", cfg["ssh_host"]) or type(cfg["ssh_port"]) is not int
            or not 1 <= cfg["ssh_port"] <= 65535 or not re.fullmatch(r"[A-Za-z0-9_-]+", cfg["ssh_user"])):
        raise ValueError("explicit SSH endpoint required")
    cfg["booted_at"] = aware(cfg["booted_at"]) if cfg["booted_at"] is not None else None
    for key in PATHS:
        p = Path(cfg[key]).expanduser()
        cfg[key] = (base / p).resolve() if not p.is_absolute() else p.resolve()
    outputs = [cfg[k] for k in ("downloads", "restored", "operations")]
    inputs = [cfg[k] for k in ("prepared", "diagnostic", "d2", "tokenizer")]
    if any(a == b or a.is_relative_to(b) or b.is_relative_to(a)
           for i, a in enumerate(outputs) for b in outputs[i + 1:] + inputs):
        raise ValueError("inputs and output directories must be disjoint")
    return cfg


def offline_preflight(cfg):
    plan = verify_plan(cfg["prepared"])
    verify_diagnostic(cfg["diagnostic"])
    verify_d2(cfg["d2"])
    _, pinned = load_tokenizer(cfg["tokenizer"])
    if not cfg["restore_python"].is_file() or not cfg["known_hosts"].is_file():
        raise ValueError("existing restoration Python and verified known_hosts required")
    disk = cfg["downloads"]
    while not disk.exists():
        disk = disk.parent
    free = shutil.disk_usage(disk).free
    if free < 3_000_000_000:
        raise ValueError("at least 3GB local disk free required; preserve existing archives")
    return plan, {"offline_only": True, "g2_preparation_verified": True,
        "tokenizer": pinned, "local_free_bytes": free, "gpu_calls": 0, "server_state_verified": False,
        "boot_time_configured": cfg["booted_at"] is not None, "budget": plan["budget"]}


def validate_remote(cfg, plan, opening, launch, setup, guards):
    bind = binding(plan, cfg["execution_commit"], cfg["booted_at"].isoformat())
    if validate_opening(opening, plan) != bind:
        raise ValueError("remote opening differs from original window")
    for rows in (setup, guards):
        if not rows or rows[0].get("status") != "armed" or rows[0]["deadline"] != bind["hard_cutoff"]:
            raise ValueError("both original-deadline guard records required")
    argv = launch["argv"]
    values = {"--model-dir", "--model-manifest", "--prepared-dir", "--diagnostic-dir", "--d2-dir", "--tokenizer-dir",
              "--output-dir", "--expected-code-commit", "--hourly-cny", "--booted-at", "--setup-guard"}
    switches = {"--execute", "--shutdown-when-done"}
    expected_script = f'/root/autodl-tmp/liftcut/code/{cfg["execution_commit"]}/research/liftcut-agent/run_g2_window.py'
    if not isinstance(argv, list) or len(argv) < 2 or argv[1] != expected_script:
        raise ValueError("controller must run the checked immutable checkout")
    parsed, i = {}, 2
    while i < len(argv):
        flag = argv[i]
        if flag not in values | switches or flag in parsed:
            raise ValueError("unique canonical flags required")
        if flag in switches:
            parsed[flag], i = True, i + 1
        else:
            if i + 1 >= len(argv) or not isinstance(argv[i + 1], str) or not argv[i + 1] or argv[i + 1].startswith("--"):
                raise ValueError("missing controller flag value")
            parsed[flag], i = argv[i + 1], i + 2
    if set(parsed) != values | switches:
        raise ValueError("incomplete launch flags")
    for flag, value in (("--output-dir", cfg["remote_run"]), ("--expected-code-commit", cfg["execution_commit"]),
                        ("--hourly-cny", "2.18"), ("--setup-guard", cfg["remote_ops"] + "/setup-guard.jsonl")):
        if parsed[flag] != value:
            raise ValueError("launch binding differs: " + flag)
    if aware(parsed["--booted-at"]) != cfg["booted_at"] or aware(launch["booted_at_proxy"]) != cfg["booted_at"]:
        raise ValueError("launch budget was reset")
    deadlines(parsed["--booted-at"], aware(launch["at_utc"]))
    return bind


def download(sftp, path, item, cfg, budget, emit):
    """Bound the actual stream, not merely its claimed size; preserve partials."""
    import stat
    if (type(item["bytes"]) is not int or not 0 < item["bytes"] <= 512_000_000
            or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])):
        raise ValueError("invalid download bounds")
    target = cfg["downloads"] / PurePosixPath(path).name
    if target.exists():
        if target.stat().st_size != item["bytes"] or sha256(target) != item["sha256"]:
            raise ValueError("different existing archive; never overwrite")
        return target
    remote = cfg["remote_run"] + "/" + path
    io_budget(sftp, budget)
    st = sftp.lstat(remote)
    if not stat.S_ISREG(st.st_mode) or st.st_size != item["bytes"]:
        raise ValueError("remote archive not a regular file of the announced size")
    temp = target.with_name(target.name + "." + uuid.uuid4().hex + ".partial")
    remaining = item["bytes"]
    io_budget(sftp, budget)
    with sftp.open(remote, "rb") as source, temp.open("xb") as sink:
        while remaining:
            io_budget(sftp, budget)
            chunk = source.read(min(65536, remaining))
            if not chunk or len(chunk) > remaining:
                raise ValueError("archive ended early or exceeded bound")
            sink.write(chunk)
            remaining -= len(chunk)
        io_budget(sftp, budget)
        if source.read(1):
            raise ValueError("archive grew during transfer")
    budget.check()
    if sha256(temp) != item["sha256"] or target.exists():
        raise ValueError("archive integrity/race failure; partial retained")
    temp.rename(target)
    emit("archive_bytes_verified", archive=target.name, bytes=item["bytes"], sha256=item["sha256"])
    return target


def restore_and_publish(sftp, index, cfg, bind, budget, emit, *, runner=subprocess.run):
    remaining = budget.remaining() - 60
    if remaining <= 0:
        raise TimeoutError("no restoration allowance before original deadline")
    output = cfg["restored"] / uuid.uuid4().hex
    argv = [str(cfg["restore_python"]), str(ROOT / "restore_g2.py"),
        "--archive-dir", str(cfg["downloads"]), "--output-dir", str(output),
        "--prepared-dir", str(cfg["prepared"]), "--diagnostic-dir", str(cfg["diagnostic"]),
        "--d2-dir", str(cfg["d2"]), "--tokenizer-dir", str(cfg["tokenizer"]), "--allow-partial"]
    emit("restore_started", attempt=output.name, run_status=index["status"])
    with (cfg["operations"] / ("restore-" + output.name + ".log")).open("x", encoding="utf-8") as log:
        runner(argv, check=True, timeout=remaining, stdout=log, stderr=subprocess.STDOUT)
    receipt = output / "off-instance-backup.json"
    actual = validate_receipt(receipt.read_bytes(), index, bind)
    emit("off_instance_verified", attempt=output.name, receipt=actual)
    io_budget(sftp, budget)
    return transfer_receipt(sftp, receipt, cfg["remote_run"], index, bind, budget.deadline, now=budget.now, emit=emit)


def collect(sftp, cfg, plan, budget, emit, *, sleep=time.sleep):
    def required(path):
        result = remote_bytes(sftp, path, budget)
        if result is None:
            raise ValueError("startup evidence missing; inspect without relaunching")
        return result
    opening = json.loads(required(cfg["remote_run"] + "/opening.json"))
    launch = json.loads(required(cfg["remote_ops"] + "/controller-launch.json"))
    setup = json_lines(required(cfg["remote_ops"] + "/setup-guard.jsonl"))
    guard = json_lines(required(cfg["remote_run"] + "/deadline-guard.jsonl"))
    bind = validate_remote(cfg, plan, opening, launch, setup, guard)
    for name, obj in (("opening.json", opening), ("launch.json", launch), ("setup-guard.json", setup), ("deadline-guard.json", guard)):
        persist_json(cfg["operations"] / name, obj)
    emit("monitor_ready", binding=bind, guard_process_liveness_verified=False, provider_billing_stopped="unknown")
    seen, sent, captured, last_event, index_retries = {}, None, set(), None, 0
    while budget.remaining() > 0:
        data = remote_bytes(sftp, cfg["remote_run"] + "/events.jsonl", budget, tail=True)
        (cfg["operations"] / "server-events-latest.jsonl").write_bytes(data or b"")
        records = json_lines(data)
        if records and records[-1] != last_event:
            last_event = records[-1]
            emit("server_event", record=last_event)
        if sent is None:
            for row in json_lines(remote_bytes(sftp, cfg["remote_run"] + "/early-index.jsonl", budget)):
                arm = row["arm"]
                if arm not in ARMS or row["binding"] != bind or row["path"] != "training/" + arm + ".tar.gz":
                    raise ValueError("early archive binding/path mismatch")
                if arm in seen and seen[arm] != row:
                    raise ValueError("early archive identity changed")
                download(sftp, row["path"], row, cfg, budget, emit)
                seen[arm] = row
            raw = remote_bytes(sftp, cfg["remote_run"] + "/backup-index.json", budget)
            if raw is not None:
                try:
                    index = json.loads(raw)
                except ValueError:
                    index_retries += 1
                    if index_retries >= 3:
                        raise ValueError("backup index incomplete across three reads")
                    sleep(min(1, budget.remaining()))
                    continue
                validate_index(index, bind)
                persist_json(cfg["downloads"] / "backup-index.json", index)
                for item in index["archives"]:
                    if item["part"] in seen:
                        early = seen[item["part"]]
                        if any(item[k] != early[k] for k in ("path", "archive", "bytes", "sha256")):
                            raise ValueError("final index changed an early archive")
                    download(sftp, item["path"], item, cfg, budget, emit)
                sent = restore_and_publish(sftp, index, cfg, bind, budget, emit)
                if sent["status"] not in {"published", "already_present"}:
                    return {**sent, "local_restore_verified": True, "provider_billing_stopped": "unknown"}
        for name in ("backup-copy-status.json", "shutdown-request.json"):
            if name not in captured:
                raw = remote_bytes(sftp, cfg["remote_run"] + "/" + name, budget)
                if raw is not None:
                    obj = json.loads(raw)
                    persist_json(cfg["operations"] / name, obj)
                    emit("server_observation", file=name, value=obj, provider_billing_stopped="unknown")
                    captured.add(name)
                    if name == "shutdown-request.json":
                        return {"status": "shutdown_request_observed", "request": obj,
                                "receipt_transfer": sent, "provider_billing_stopped": "unknown"}
        sleep(min(5 if sent else 20, budget.remaining()))
    return {"status": "original_deadline_reached", "provider_billing_stopped": "unknown"}


def connect(cfg, plan):
    if cfg["booted_at"] is None or cfg["booted_at"] > utcnow() or cfg["ssh_host"].endswith(".invalid"):
        raise ValueError("real authorized opening and endpoint required")
    _, hard = deadlines(cfg["booted_at"].isoformat(), utcnow(), launching=False)
    budget = TimeBudget(hard)
    budget.check()
    # Always fresh operations and restoration directories, including recovery.
    # An old lock is inspected, never silently removed or restarted.
    for key in ("downloads", "restored", "operations"):
        cfg[key].mkdir(parents=True, exist_ok=False)
    with (cfg["operations"] / "monitor.lock").open("x") as stream:
        stream.write(str(os.getpid()))
    emit = lambda event, **fields: event_file(cfg["operations"] / "events.jsonl", event, **fields)
    dump_new(cfg["operations"] / "config.json", {k: v.isoformat() if k == "booted_at" else str(v) if isinstance(v, Path) else v for k, v in cfg.items()})
    import paramiko
    client, timer, password = paramiko.SSHClient(), None, None
    try:
        client.load_host_keys(str(cfg["known_hosts"]))
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        password = getpass.getpass("AutoDL G2 monitor password: ")
        budget.check()
        timer = threading.Timer(budget.remaining(), client.close)
        timer.daemon = True
        timer.start()
        timeout = min(15, budget.remaining())
        client.connect(cfg["ssh_host"], port=cfg["ssh_port"], username=cfg["ssh_user"], password=password,
                       look_for_keys=False, allow_agent=False, timeout=timeout, auth_timeout=timeout, banner_timeout=timeout)
        password = None
        with client.open_sftp() as sftp:
            result = collect(sftp, cfg, plan, budget, emit)
        emit("monitor_finished", result=result)
        return result
    except Exception as error:
        result = {"status": "collector_stopped", "error_type": type(error).__name__,
                  "no_automatic_reconnect": True, "provider_billing_stopped": "unknown"}
        emit("monitor_stopped", **result)
        raise
    finally:
        password = None
        client.close()
        if timer:
            timer.cancel()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--connect", action="store_true")
    args = parser.parse_args()
    cfg = parse_config(read(args.config))
    plan, report = offline_preflight(cfg)
    print(json.dumps(connect(cfg, plan) if args.connect else report, indent=2))
