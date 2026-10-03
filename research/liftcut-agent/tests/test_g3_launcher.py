"""Synthetic SFTP and clocks; no network, credentials, inference or shutdown."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import launch_g3_remote as launch
from g3_prelaunch_guard import opening_matches, watch
from monitor_coverage_replication import TimeBudget
from server_workspace import dump_new

EXECUTION = "0" * 40  # Explicit synthetic execution ref, not a GPU run.


class Clock:
    def __init__(self):
        self.value = datetime(2026,10,2,12,tzinfo=timezone.utc)
        self.tick = 0.
    def now(self):
        return self.value
    def sleep(self, seconds):
        self.value += timedelta(seconds=seconds)
        self.tick += seconds


class Handle:
    def __init__(self, remote, path):
        self.remote, self.path, self.offset, self.pipeline = remote, path, 0, False
    def seek(self, offset):
        self.offset = offset
    def set_pipelined(self, value):
        self.pipeline = value
        self.remote.events.append(("pipeline", value))
    def write(self, chunk):
        if not self.pipeline:
            raise AssertionError("synchronous upload is forbidden by regression test")
        self.remote.events.append(("write", self.offset, len(chunk)))
        existing = self.remote.files[self.path]
        self.remote.files[self.path] = existing[:self.offset] + chunk + existing[self.offset+len(chunk):]
        self.offset += len(chunk)
        if self.remote.after_write:
            self.remote.after_write()
    def close(self):
        self.remote.events.append(("close", self.path))


class SFTP:
    def __init__(self, files=None, after_write=None, mode=stat.S_IFREG):
        self.files, self.events, self.after_write, self.mode = files or {}, [], after_write, mode
    def get_channel(self):
        return SimpleNamespace(settimeout=lambda _: None)
    def lstat(self, path):
        if path not in self.files:
            raise FileNotFoundError(path)
        return SimpleNamespace(st_size=len(self.files[path]), st_mode=self.mode)
    def open(self, path, mode, bufsize=0):
        self.events.append(("open", mode))
        if mode == "wx":
            if path in self.files:
                raise FileExistsError(path)
            self.files[path] = b""
        elif mode != "r+b":
            raise AssertionError("unexpected open mode")
        return Handle(self, path)
    def digest(self, path):
        return hashlib.sha256(self.files[path]).hexdigest()


class TransferTests(unittest.TestCase):
    def test_complete_launcher_path_compiles_remote_commands_and_reuses_one_connection(self):
        import ast
        import shutil
        from datetime import datetime, timezone
        cfg_source = ROOT / "configs/g3-monitor.template.json"
        with tempfile.TemporaryDirectory() as tmp:
            root, boot = Path(tmp), datetime.now(timezone.utc).isoformat()
            stage = root / "stage"
            stage.mkdir()
            for name in ("g3_setup.py", "shutdown_guard.py", "d2_bundle.py"):
                shutil.copyfile(ROOT/name, stage/name)
            for name in ("code.bundle", "assets.tar.gz", "asset-index.json"):
                (stage/name).write_bytes(b"SYNTHETIC-INTEGRATION-ONLY")
            files = {p.name:{"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in stage.iterdir()}
            remote_stage = launch.PERSIST + "/staging/g3-integration-only"
            dump_new(stage/"stage.json", {"execution_commit":EXECUTION,"remote_stage":remote_stage,"files":files,
                "execution_plan_sha256":launch.sha256(launch.REVIEWED)})
            raw = json.loads(cfg_source.read_text())
            raw["execution_commit"] = EXECUTION
            config = root/"input.json"
            dump_new(config, raw)
            original_configure = launch.configure
            def configure(raw, opening_id, boot):
                result=original_configure(raw,opening_id,boot)
                for name in ("operations","downloads","restored"):
                    result[name]=str(root/name)
                return result
            expected=configure(raw,"integration-only",boot)
            class Network(SFTP):
                def stat(self,path):
                    return self.lstat(path)
                def mkdir(self,path):
                    pass
                def open(self,path,mode,bufsize=0):
                    return io.BytesIO(self.files[path]) if mode=="rb" else super().open(path,mode,bufsize)
            network, client = Network(), Mock()
            @contextmanager
            def session():
                yield network
            client.open_sftp.side_effect=session
            compiled, labels=[] ,[]
            class Remote:
                def __init__(self,client,operations,budget,emit):
                    self.budget=budget
                def run(self,argv,label,**_):
                    labels.append(label)
                    if "-c" in argv:
                        code=argv[argv.index("-c")+1]
                        compiled.append(compile(code,"<synthetic-remote-command>","exec"))
                    if label=="hash":
                        assignment=next(n for n in ast.walk(ast.parse(code)) if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=="p")
                        path=ast.literal_eval(assignment.value.args[0])
                        return network.digest(path)
                    if label=="setup-guard":
                        return json.dumps({"guard_armed":True,"booted_at_proxy":boot,"hard_cutoff":(datetime.fromisoformat(boot)+timedelta(minutes=180)).isoformat()})
                    if label=="prelaunch-guard":
                        row={"event":"armed","deadline":(datetime.fromisoformat(boot)+timedelta(minutes=10)).isoformat()}
                        network.files[expected["remote_ops"]+"/prelaunch-guard.jsonl"]=(json.dumps(row)+"\n").encode()
                        return '{"pid":123,"argv":[]}'
                    if label=="install":
                        return '{"checkout_verified":true,"assets_verified":1,"disk_free_bytes":4000000000}'
                    if label=="live-preflight":
                        expected_runtime=launch.expected_runtime()
                        return json.dumps({"packages":expected_runtime["packages"],"python":expected_runtime["python"]})
                    if label=="controller-launch":
                        network.files[expected["remote_run"]+"/deadline-guard.jsonl"]=b'{"status":"armed"}\n'
                        return '{"controller_pid":456}'
                    raise AssertionError(label)
            cfg = launch.parse_config(raw)
            collector=Mock(return_value={"synthetic_integration_only":True})
            fake_paramiko=SimpleNamespace(SSHClient=lambda:client,RejectPolicy=lambda:object())
            with patch.object(launch,"local_preflight",return_value=(cfg,{"offline_only":True})), patch.object(launch,"verify_plan",return_value={}), patch.object(launch,"configure",side_effect=configure), patch.object(launch,"Remote",Remote), patch.object(launch,"collect",collector), patch.object(launch.getpass,"getpass",return_value="SYNTHETIC-NOT-A-CREDENTIAL"), patch.dict(sys.modules,{"paramiko":fake_paramiko}):
                result=launch.execute(config,stage,"integration-only",boot)
            self.assertTrue(result["synthetic_integration_only"])
            self.assertGreater(len(compiled),5)
            self.assertLess(labels.index("prelaunch-guard"),labels.index("install"))
            self.assertLess(labels.index("live-preflight"),labels.index("install"))
            self.assertLess(labels.index("install"),labels.index("controller-launch"))
            client.connect.assert_called_once()
            collector.assert_called_once()
            client.close.assert_called_once()
            for p in (root/"operations").rglob("*"):
                if p.is_file():
                    self.assertNotIn(b"SYNTHETIC-NOT-A-CREDENTIAL",p.read_bytes())


if __name__ == "__main__":
    unittest.main()
