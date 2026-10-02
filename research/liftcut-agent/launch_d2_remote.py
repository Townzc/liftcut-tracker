"""Offline-first local D2 launcher with verified resume and an early setup guard.

Uses transport Python only for Paramiko; tokenizer preflight/restoration always
use the already-pinned separate interpreter. Does not change frozen GPU sources.
"""
import argparse
from contextlib import closing
from datetime import timedelta
import getpass
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import stat
import subprocess
import threading
import time

from d2_execution import ROOT, aware, deadlines, event_file, expected_runtime, read, utcnow, verify_plan
from monitor_counterfactual_diagnostics import collect, parse_config
from monitor_coverage_replication import TimeBudget, io_budget, remote_bytes, json_lines
from server_workspace import dump_new, sha256

EXECUTION = "06654db287a5d51c4aad6bf57fcee40d21555afc"
PERSIST = "/root/autodl-tmp/liftcut"


def local_preflight(config_file, *, runner=subprocess.run):
    """Never import Transformers/SciPy in the transport Python process."""
    cfg = parse_config(read(config_file))
    if cfg["execution_commit"] != EXECUTION:
        raise ValueError("this launcher is for the reviewed D2 GPU commit only")
    result = runner([str(cfg["restore_python"]), str(ROOT / "monitor_counterfactual_diagnostics.py"),
                     "--config", str(config_file)], check=True, capture_output=True, text=True,
                    encoding="utf-8", timeout=90)
    report = json.loads(result.stdout)
    if not report["offline_only"] or not report["actual_seed42_adapter_bytes_verified"] or report["gpu_calls"] != 0:
        raise ValueError("pinned offline preflight did not pass")
    return cfg, report


def prefix_hash(path, count):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        while count:
            chunk = stream.read(min(1024 * 1024, count))
            if not chunk:
                raise ValueError("prefix longer than local source")
            result.update(chunk)
            count -= len(chunk)
    return result.hexdigest()


def upload_verified(local, remote, sftp, remote_hash, budget, emit, *, tick=time.monotonic):
    """Resume only after hashing the remote prefix; never overwrite a mismatch."""
    size, start = local.stat().st_size, 0
    io_budget(sftp, budget)
    try:
        info = sftp.lstat(remote)
    except FileNotFoundError:
        info = None
    if info is not None:
        if not stat.S_ISREG(info.st_mode) or not 0 <= info.st_size <= size:
            raise ValueError("staged target is not a bounded regular partial/complete file")
        start = info.st_size
        if remote_hash(remote) != prefix_hash(local, start):
            raise ValueError("remote prefix differs; preserve it and stop")
        if start == size:
            emit("staged_file_reused", name=local.name, bytes=size, sha256=sha256(local))
            return {"reused_bytes": size, "uploaded_bytes": 0}
    emit("transfer_started", name=local.name, verified_prefix_bytes=start, remaining_bytes=size-start)
    before, logged, offset = tick(), tick(), start
    io_budget(sftp, budget)
    with local.open("rb") as source, closing(sftp.open(remote, "r+b" if info is not None else "wx", bufsize=0)) as target:
        source.seek(start)
        if start:
            target.seek(start)
        target.set_pipelined(True)
        while chunk := source.read(65536):
            io_budget(sftp, budget)
            target.write(chunk)
            offset += len(chunk)
            if tick() - logged >= 10:
                logged = tick()
                emit("transfer_progress", name=local.name, queued_bytes=offset, total_bytes=size,
                     acknowledged_complete=False, elapsed_seconds=tick()-before)
    budget.check()
    io_budget(sftp, budget)
    if sftp.lstat(remote).st_size != size or remote_hash(remote) != sha256(local):
        raise ValueError("closed remote payload differs from local SHA256")
    emit("staged_file_verified", name=local.name, bytes=size, resumed_bytes=start, sha256=sha256(local))
    return {"reused_bytes": start, "uploaded_bytes": size-start}


def configure(raw, opening_id, boot):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", opening_id):
        raise ValueError("simple unique opening ID required")
    result = dict(raw)
    result.update(booted_at=boot, remote_ops=f"{PERSIST}/runs/d2-ops-{opening_id}",
                  remote_run=f"{PERSIST}/runs/d2-run-{opening_id}")
    for name in ("downloads", "restored", "operations"):
        result[name] = str(ROOT / "outputs/autodl" / f"d2-{opening_id}-{name}")
    return result


class Remote:
    def __init__(self, client, operations, budget, emit):
        self.client, self.operations, self.budget, self.emit = client, operations, budget, emit
        self.number = 0

    def run(self, argv, label, *, timeout=60):
        self.budget.check()
        timeout = min(timeout, self.budget.remaining())
        self.number += 1
        _, stdout, stderr = self.client.exec_command(" ".join(shlex.quote(str(x)) for x in argv), timeout=timeout)
        raw, error = stdout.read(2_000_000), stderr.read(2_000_000)
        code = stdout.channel.recv_exit_status()
        for suffix, content in (("stdout", raw), ("stderr", error)):
            (self.operations / f"remote-{self.number:03}-{label}.{suffix}").write_bytes(content)
        self.emit("remote_command", label=label, returncode=code)
        if code != 0:
            raise RuntimeError("remote step failed: " + label)
        return raw.decode("utf-8")


def execute(config_file, stage, opening_id, supplied_boot):
    cfg, preflight = local_preflight(config_file)
    deadlines(supplied_boot, utcnow())  # No network after an already-stale opening.
    plan, spec = verify_plan(cfg["prepared"]), read(stage / "stage.json")
    remote_stage = PurePosixPath(spec["remote_stage"])
    if (spec["execution_commit"] != EXECUTION or remote_stage.parent != PurePosixPath(PERSIST + "/staging")
            or not re.fullmatch(r"d2-[A-Za-z0-9_-]+", remote_stage.name)):
        raise ValueError("reviewed immutable staging directory required")
    for name, item in spec["files"].items():
        if Path(name).name != name or sha256(stage/name) != item["sha256"] or (stage/name).stat().st_size != item["bytes"]:
            raise ValueError("staged local payload changed")
    for name in ("d2_setup.py", "shutdown_guard.py"):
        if sha256(stage/name) != sha256(ROOT/name):
            raise ValueError("bootstrap differs from locally verified frozen sources")
    raw = configure(read(config_file), opening_id, supplied_boot)
    cfg = parse_config(raw)
    for name in ("operations", "downloads", "restored"):
        cfg[name].mkdir(parents=True, exist_ok=False)
    operations = cfg["operations"]
    (operations / "monitor.lock").write_text("exclusive-launch-and-collector\n", encoding="utf-8")
    dump_new(operations / "offline-preflight.json", preflight)
    dump_new(operations / "local-source.json", {"cloud_commit": EXECUTION,
        "local_source_sha256": {n: sha256(ROOT/n) for n in ("launch_d2_remote.py", "d2_prelaunch_guard.py")}})
    def emit(event, **fields):
        event_file(operations / "events.jsonl", event, **fields)
        print(json.dumps({"event":event, **fields}, ensure_ascii=False), flush=True)
    import paramiko  # No tokenizer imports in this interpreter.
    client, timer, launched = paramiko.SSHClient(), None, False
    client.load_host_keys(str(cfg["known_hosts"]))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    password = getpass.getpass("D2 AutoDL password (not stored): ")
    setup_budget = TimeBudget(aware(supplied_boot) + timedelta(minutes=10))
    python = PERSIST + "/envs/qwen-pilot-py312/bin/python"
    remote = Remote(client, operations, setup_budget, emit)
    try:
        setup_budget.check()
        timeout = min(15, setup_budget.remaining())
        client.connect(cfg["ssh_host"], port=cfg["ssh_port"], username=cfg["ssh_user"], password=password,
                       look_for_keys=False, allow_agent=False, timeout=timeout, auth_timeout=timeout, banner_timeout=timeout)
        password = None
        emit("ssh_connected")
        with client.open_sftp() as sftp:
            for directory in (str(remote_stage.parent), str(remote_stage)):
                try:
                    sftp.stat(directory)
                except FileNotFoundError:
                    sftp.mkdir(directory)
            def remote_hash(path):
                code = "import hashlib; from pathlib import Path; p=Path(" + repr(path) + "); print(hashlib.file_digest(p.open('rb'),'sha256').hexdigest())"
                return remote.run([python, "-c", code], "hash").strip()
            def upload(path):
                return upload_verified(path, str(remote_stage/path.name), sftp, remote_hash, setup_budget, emit)
            for name in ("d2_setup.py", "shutdown_guard.py"):
                upload(stage/name)
            # The legacy setup path arms the SAME original120-minute guard.
            opened = json.loads(remote.run([python, str(remote_stage/"d2_setup.py"), "--arm-only", "--ops-dir",
                cfg["remote_ops"], "--booted-at", supplied_boot], "setup-guard"))
            raw["booted_at"] = opened["booted_at_proxy"]
            cfg = parse_config(raw)
            boot = aware(raw["booted_at"])
            setup_budget = TimeBudget(boot + timedelta(minutes=10))
            remote.budget = setup_budget
            dump_new(operations / "config.json", raw)
            emit("original_guard_armed", **opened)
            upload(ROOT/"d2_prelaunch_guard.py")
            guard_argv = [python, str(remote_stage/"d2_prelaunch_guard.py"), "--arm", "--booted-at", boot.isoformat(),
                "--commit", EXECUTION, "--opening", cfg["remote_run"] + "/opening.json",
                "--receipt", cfg["remote_ops"] + "/prelaunch-guard.jsonl"]
            code = "import subprocess,json; from pathlib import Path; argv=" + repr(guard_argv) + "; log=Path(" + repr(cfg["remote_ops"] + "/prelaunch-guard.log") + ").open('x'); p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True); print(json.dumps({'pid':p.pid,'argv':argv}))"
            guard = json.loads(remote.run([python, "-c", code], "prelaunch-guard"))
            dump_new(operations / "prelaunch-guard-launch.json", guard)
            for _ in range(40):
                rows = json_lines(remote_bytes(sftp, cfg["remote_ops"] + "/prelaunch-guard.jsonl", setup_budget))
                if rows and rows[0].get("event") == "armed" and aware(rows[0]["deadline"]) == setup_budget.deadline:
                    break
                time.sleep(.1)
            else:
                raise ValueError("independent prelaunch guard did not arm")
            emit("prelaunch_guard_armed", deadline=setup_budget.deadline.isoformat())
            probe = """import json,shutil,subprocess,importlib.metadata,platform
from pathlib import Path
p=Path('/root/autodl-tmp/liftcut')
model=p/'cache/huggingface/hub/models--Qwen--Qwen3-4B-Instruct-2507/snapshots/cdbee75f17c01a7cc42f958dc650907174af0554'
adapters=p/'runs/state-coverage-v1-20260929/training'
assert shutil.disk_usage(p).free >= 3000000000
assert model.is_dir() and (p/'data/qwen-model-manifest.json').is_file()
assert all((adapters/a/'final/adapter_model.safetensors').is_file() for a in ('s0','t','m','tm'))
gpu=subprocess.check_output(['nvidia-smi','--query-gpu=name,memory.total','--format=csv,noheader'],text=True,timeout=15).strip()
assert 'RTX 4090' in gpu
print(json.dumps({'disk_free_bytes':shutil.disk_usage(p).free,'gpu':gpu,'python':platform.python_version(),
    'packages':{n:importlib.metadata.version(n) for n in ('torch','transformers','tokenizers','jinja2','accelerate','peft','bitsandbytes')},
    'hourly_cny_assumed':2.18,'provider_price_independently_verified':False}))
"""
            observed = json.loads(remote.run([python, "-c", probe], "live-preflight"))
            expected = expected_runtime()
            if observed["packages"] != expected["packages"] or observed["python"] != expected["python"]:
                raise ValueError("live package versions differ from frozen execution")
            emit("live_preflight_passed", **observed)
            for name in spec["files"]:
                if name not in ("d2_setup.py", "shutdown_guard.py", "launch.sh"):
                    upload(stage/name)
            checkout, data = PERSIST + "/code/" + EXECUTION, PERSIST + "/data/" + remote_stage.name
            # Installation is idempotent only for exact verified existing bytes.
            code = """import hashlib,json,subprocess,tarfile,shutil
from pathlib import Path
stage=Path(STAGE); checkout=Path(CHECKOUT); data=Path(DATA)
assert shutil.disk_usage(stage).free >= 3000000000
if not checkout.exists():
    subprocess.run(['git','clone','--no-checkout',str(stage/'code.bundle'),str(checkout)],check=True)
    subprocess.run(['git','-C',str(checkout),'checkout','--detach',COMMIT],check=True)
assert subprocess.check_output(['git','-C',str(checkout),'rev-parse','HEAD'],text=True).strip()==COMMIT
assert not subprocess.check_output(['git','-C',str(checkout),'status','--porcelain'],text=True).strip()
inventory=json.loads((stage/'asset-index.json').read_text())
assert len(inventory) <= 32 and sum(x['bytes'] for x in inventory.values()) <= 64000000
assert not data.is_symlink()
if not data.exists():
    with tarfile.open(stage/'assets.tar.gz','r:gz') as tar:
        members=tar.getmembers()
        assert len(members)==len(inventory) and {m.name for m in members}==set(inventory)
        assert all(m.isfile() and m.size==inventory[m.name]['bytes'] for m in members)
        assert all(not Path(n).is_absolute() and '..' not in Path(n).parts and ':' not in n and '\\\\' not in n for n in inventory)
        data.mkdir(parents=True,exist_ok=False)
        tar.extractall(data,filter='data')
for name,item in inventory.items():
    p=data/name
    assert p.is_file() and not p.is_symlink() and p.stat().st_size==item['bytes']
    assert hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==item['sha256']
print(json.dumps({'checkout_verified':True,'assets_verified':len(inventory),'disk_free_bytes':shutil.disk_usage(stage).free}))
"""
            code = "STAGE=" + repr(str(remote_stage)) + ";CHECKOUT=" + repr(checkout) + ";DATA=" + repr(data) + ";COMMIT=" + repr(EXECUTION) + "\n" + code
            emit("remote_assets_verified", **json.loads(remote.run([python, "-c", code], "install", timeout=90)))
            model = PERSIST + "/cache/huggingface/hub/models--Qwen--Qwen3-4B-Instruct-2507/snapshots/cdbee75f17c01a7cc42f958dc650907174af0554"
            argv = [python, checkout + "/research/liftcut-agent/d2_setup.py", "--ops-dir", cfg["remote_ops"],
                "--expected-code-commit", EXECUTION, "--model-dir", model, "--model-manifest", PERSIST + "/data/qwen-model-manifest.json",
                "--prepared-dir", data + "/prepared", "--tokenizer-dir", data + "/tokenizer",
                "--adapters-root", PERSIST + "/runs/state-coverage-v1-20260929/training", "--output-dir", cfg["remote_run"]]
            # Intent is recorded before dispatch. Never repeat after ambiguity.
            dump_new(operations / "launch-dispatch.json", {"argv":argv,"at_utc":utcnow().isoformat()})
            launched = True
            remote.run(argv, "controller-launch", timeout=45)
            budget = TimeBudget(boot + timedelta(minutes=120))
            timer = threading.Timer(budget.remaining(), client.close)
            timer.daemon = True
            timer.start()
            for _ in range(40):
                if remote_bytes(sftp, cfg["remote_run"] + "/deadline-guard.jsonl", budget):
                    break
                time.sleep(.25)
            result = collect(sftp, cfg, plan, budget, emit)
            emit("monitor_finished", result=result)
            return result
    except BaseException as error:
        emit("launcher_or_collector_stopped", error_type=type(error).__name__, launch_issued=launched,
             provider_billing_stopped="unknown", no_automatic_reconnect=True)
        if not launched and client.get_transport() and client.get_transport().is_active():
            try:
                code = "import subprocess; from pathlib import Path; p=Path('/usr/bin/shutdown'); b=p.read_bytes()[:4]; a=[str(p)] if b.startswith((b'#!',b'\\x7fELF')) else ['/bin/bash',str(p)]; print(subprocess.run(a,capture_output=True,timeout=30).returncode)"
                _, stream, _ = client.exec_command(" ".join(shlex.quote(x) for x in (python,"-c",code)), timeout=35)
                emit("setup_failure_shutdown_return", observed_stdout=stream.read(128).decode(), provider_billing_stopped="unknown")
            except Exception as failed:
                emit("setup_shutdown_unobserved", error_type=type(failed).__name__)
        raise
    finally:
        password = None
        client.close()
        if timer:
            timer.cancel()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage-dir", type=Path)
    parser.add_argument("--opening-id")
    parser.add_argument("--booted-at")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not args.execute:
        _, report = local_preflight(args.config)
        print(json.dumps(report, indent=2))
    else:
        if not all((args.stage_dir, args.opening_id, args.booted_at)):
            parser.error("execution requires staged files, new opening ID and actual boot proxy")
        execute(args.config, args.stage_dir, args.opening_id, args.booted_at)
