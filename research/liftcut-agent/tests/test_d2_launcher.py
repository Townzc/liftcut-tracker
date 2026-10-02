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
import launch_d2_remote as launch
from d2_prelaunch_guard import opening_matches, watch
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
        cfg_source = ROOT / "configs/d2-monitor.template.json"
        with tempfile.TemporaryDirectory() as tmp:
            root, boot = Path(tmp), datetime.now(timezone.utc).isoformat()
            stage = root / "stage"
            stage.mkdir()
            for name in ("d2_setup.py", "shutdown_guard.py", "d2_bundle.py"):
                shutil.copyfile(ROOT/name, stage/name)
            for name in ("code.bundle", "assets.tar.gz", "asset-index.json"):
                (stage/name).write_bytes(b"SYNTHETIC-INTEGRATION-ONLY")
            files = {p.name:{"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in stage.iterdir()}
            remote_stage = launch.PERSIST + "/staging/d2-integration-only"
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
                        return json.dumps({"guard_armed":True,"booted_at_proxy":boot,"hard_cutoff":(datetime.fromisoformat(boot)+timedelta(minutes=120)).isoformat()})
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

    def perform(self, initial=None, after_write=None, mode=stat.S_IFREG):
        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp) / "SYNTHETIC-code.bundle"
            content = bytes(range(256)) * 700
            local.write_bytes(content)
            clock, remote, events = Clock(), "/synthetic-stage/payload", []
            sftp = SFTP({remote: initial} if initial is not None else None, after_write, mode)
            budget = TimeBudget(clock.now()+timedelta(minutes=10), now=clock.now, monotonic=lambda: clock.tick)
            result = launch.upload_verified(local, remote, sftp, sftp.digest, budget,
                                            lambda event, **data: events.append((event,data)))
            self.assertEqual(sftp.files[remote], content)
            return result, sftp.events, events

    def test_fresh_upload_uses_exclusive_pipelined_writes(self):
        result, operations, events = self.perform()
        self.assertEqual(result["reused_bytes"], 0)
        self.assertIn(("open", "wx"), operations)
        self.assertEqual(events[-1][0], "staged_file_verified")

    def test_verified_partial_resumes_only_missing_suffix(self):
        prefix = bytes(range(256))*300
        result, operations, _ = self.perform(prefix)
        writes = [x for x in operations if x[0] == "write"]
        self.assertEqual(writes[0][1], len(prefix))
        self.assertEqual(sum(x[2] for x in writes), result["uploaded_bytes"])
        self.assertEqual(result["reused_bytes"], len(prefix))
        self.assertIn(("open", "r+b"), operations)

    def test_complete_matching_bytes_are_reused_without_open(self):
        content = bytes(range(256))*700
        result, operations, events = self.perform(content)
        self.assertEqual(result["uploaded_bytes"], 0)
        self.assertEqual(operations, [])
        self.assertEqual(events[-1][0], "staged_file_reused")

    def test_wrong_prefix_or_oversize_or_symlink_is_not_overwritten(self):
        for content, mode in ((b"wrong", stat.S_IFREG), (b"x"*200000, stat.S_IFREG), (b"", stat.S_IFLNK)):
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                self.perform(content, mode=mode)

    def test_deadline_between_writes_preserves_partial(self):
        clock, remote = Clock(), "/synthetic-stage/payload"
        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp) / "fixture"
            local.write_bytes(b"x"*200000)
            sftp = SFTP(after_write=lambda: clock.sleep(601))
            budget = TimeBudget(clock.now()+timedelta(minutes=10), now=clock.now, monotonic=lambda: clock.tick)
            with self.assertRaises(TimeoutError):
                launch.upload_verified(local, remote, sftp, sftp.digest, budget, lambda *_a, **_k: None)
            self.assertEqual(len(sftp.files[remote]), 65536)
            self.assertIn(("close", remote), sftp.events)

    def test_close_failure_does_not_emit_verified_receipt(self):
        with patch.object(Handle, "close", side_effect=OSError("synthetic lost write acknowledgement")):
            with self.assertRaises(OSError):
                self.perform()

    def test_same_size_remote_corruption_fails_final_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            local, remote, events = Path(tmp)/"fixture", "/synthetic-stage/payload", []
            local.write_bytes(b"x"*100)
            sftp = SFTP()
            sftp.after_write = lambda: sftp.files.update({remote:b"y"*100})
            clock = Clock()
            budget = TimeBudget(clock.now()+timedelta(minutes=10), now=clock.now, monotonic=lambda:clock.tick)
            with self.assertRaises(ValueError):
                launch.upload_verified(local,remote,sftp,sftp.digest,budget,lambda event,**_:events.append(event))
            self.assertNotIn("staged_file_verified",events)

    def test_progress_reports_queued_bytes_without_claiming_acknowledgement(self):
        with tempfile.TemporaryDirectory() as tmp:
            local, events, clock = Path(tmp)/"fixture", [], Clock()
            local.write_bytes(b"x"*200000)
            sftp = SFTP(after_write=lambda:clock.sleep(11))
            budget = TimeBudget(clock.now()+timedelta(minutes=10),now=clock.now,monotonic=lambda:clock.tick)
            launch.upload_verified(local,"/synthetic-stage/payload",sftp,sftp.digest,budget,
                                   lambda event,**data:events.append((event,data)),tick=lambda:clock.tick)
            progress=[data for event,data in events if event=="transfer_progress"]
            self.assertTrue(progress)
            self.assertTrue(all(not row["acknowledged_complete"] for row in progress))
            self.assertEqual(events[-1][0],"staged_file_verified")

    def test_pinned_preflight_uses_separate_interpreter(self):
        cfg = ROOT / "configs/d2-monitor.template.json"
        with tempfile.TemporaryDirectory() as tmp:
            raw = json.loads(cfg.read_text())
            raw["execution_commit"] = EXECUTION
            path = Path(tmp) / "config.json"
            dump_new(path, raw)
            run = Mock(return_value=SimpleNamespace(stdout=json.dumps({"offline_only":True,"actual_seed42_adapter_bytes_verified":True,"gpu_calls":0})))
            resolved, _ = launch.local_preflight(path, runner=run)
            argv = run.call_args.args[0]
            self.assertEqual(argv[0], str(resolved["restore_python"]))
            self.assertNotEqual(argv[0], sys.executable)
            self.assertNotIn("--connect", argv)

    def test_new_opening_never_reuses_previous_run_or_output_paths(self):
        raw = json.loads((ROOT / "configs/d2-monitor.template.json").read_text())
        result = launch.configure(raw, "fresh-test", "2026-10-02T12:00:00+00:00")
        for field in ("remote_run", "remote_ops", "operations", "downloads", "restored"):
            self.assertIn("fresh-test", result[field])
            self.assertNotEqual(result[field], raw[field])
        with self.assertRaises(ValueError):
            launch.configure(raw, "../escape", "unused")


class PrelaunchGuardTests(unittest.TestCase):
    def opening(self, path, boot, **overrides):
        value = {"evidence_kind":"model","started_at_utc":(boot+timedelta(minutes=1)).isoformat(),
            "binding":{"code_commit":EXECUTION,"booted_at_proxy":boot.isoformat(),
                       "work_cutoff":(boot+timedelta(minutes=90)).isoformat(),
                       "hard_cutoff":(boot+timedelta(minutes=120)).isoformat()}}
        value.update(overrides)
        dump_new(path,value)

    def test_matching_controller_opening_exits_without_shutdown(self):
        clock, logs, shutdown = Clock(), [], Mock(return_value=0)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"opening.json"
            self.opening(path,clock.now())
            result = watch(path,clock.now(),EXECUTION,lambda event,**_:logs.append(event),shutdown,
                           now=clock.now,tick=lambda:clock.tick,sleep=clock.sleep)
        self.assertEqual(result,"opened")
        shutdown.assert_not_called()

    def test_no_opening_triggers_setup_shutdown_at_ten_minutes(self):
        clock, shutdown = Clock(), Mock(return_value=0)
        with tempfile.TemporaryDirectory() as tmp:
            result = watch(Path(tmp)/"missing",clock.now(),EXECUTION,lambda *_a,**_k:None,shutdown,
                           now=clock.now,tick=lambda:clock.tick,sleep=clock.sleep)
        self.assertEqual(result,"shutdown_requested")
        self.assertEqual(clock.tick,600)
        shutdown.assert_called_once()

    def test_late_watchdog_start_requests_shutdown_without_new_allowance(self):
        clock, shutdown = Clock(), Mock(return_value=0)
        with tempfile.TemporaryDirectory() as tmp:
            result=watch(Path(tmp)/"missing",clock.now()-timedelta(seconds=601),EXECUTION,
                         lambda *_a,**_k:None,shutdown,now=clock.now,tick=lambda:clock.tick,sleep=clock.sleep)
        self.assertEqual(result,"shutdown_requested")
        self.assertEqual(clock.tick,0.)
        shutdown.assert_called_once()

    def test_clock_rollback_does_not_extend_setup_deadline(self):
        clock, shutdown = Clock(), Mock(return_value=0)
        def backwards(seconds):
            clock.tick += seconds
            clock.value -= timedelta(seconds=seconds)
        with tempfile.TemporaryDirectory() as tmp:
            watch(Path(tmp)/"missing",clock.now(),EXECUTION,lambda *_a,**_k:None,shutdown,
                  now=clock.now,tick=lambda:clock.tick,sleep=backwards)
        self.assertEqual(clock.tick,600)
        shutdown.assert_called_once()

    def test_wrong_late_scripted_and_reset_openings_do_not_cancel_guard(self):
        boot=Clock().now()
        for change in ({"evidence_kind":"scripted_contract"}, {"started_at_utc":(boot+timedelta(minutes=11)).isoformat()},
                       {"started_at_utc":"malformed"}, {"binding":{}}):
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/"opening.json"
                self.opening(path,boot,**change)
                self.assertFalse(opening_matches(path,boot,EXECUTION))

    def test_invalid_json_shape_does_not_kill_shutdown_watchdog(self):
        for value in ([], None, {"binding":[]}, {"binding":None}):
            clock, shutdown = Clock(), Mock(return_value=0)
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/"opening.json"
                path.write_text(json.dumps(value),encoding="utf-8")
                result=watch(path,clock.now(),EXECUTION,lambda *_a,**_k:None,shutdown,
                             now=clock.now,tick=lambda:clock.tick,sleep=clock.sleep)
            self.assertEqual(result,"shutdown_requested")
            shutdown.assert_called_once()


class IncidentEvidenceTests(unittest.TestCase):
    def test_published_startup_failure_matches_raw_closure_and_cost_proxy(self):
        directory=ROOT/"reports/d2-startup-failure-2026-10-02"
        observed=json.loads((directory/"observations.json").read_text())
        for name,digest in observed["evidence_sha256"].items():
            self.assertEqual(hashlib.sha256((directory/name).read_bytes()).hexdigest(),digest)
        events=[json.loads(line) for line in (directory/"closure.jsonl").read_text().splitlines()]
        event=lambda name:next(row for row in events if row["event"]==name)
        before=event("before_shutdown")["observation"]
        self.assertEqual(before,observed["before_shutdown"])
        self.assertFalse(before["controller_launch_exists"] or before["run_exists"])
        self.assertEqual(before["gpu"],"0 %, 0 MiB")
        self.assertEqual(observed["shutdown_request_issued_at_utc"],event("shutdown_request_issued")["at_utc"])
        returned=event("shutdown_rpc_return")
        self.assertEqual(returned["stdout"],observed["shutdown_helper_stdout"])
        self.assertEqual(returned["exit_status"],observed["shutdown_ssh_channel_exit_status"])
        self.assertEqual(returned["provider_billing_stopped"],"unknown")
        boot=datetime.fromisoformat(observed["booted_at_proxy"])
        seconds=(datetime.fromisoformat(returned["at_utc"])-boot).total_seconds()
        self.assertEqual(seconds,observed["proxy_to_shutdown_rpc_seconds"])
        self.assertEqual(seconds/3600*observed["hourly_cny_assumed"],observed["compute_proxy_cny"])
        self.assertFalse(observed["controller_launched"])
        self.assertEqual(observed["new_model_calls"],0)
        self.assertEqual(observed["training_steps"],0)
        self.assertEqual(observed["reserved_test_reads"],0)


if __name__ == "__main__":
    unittest.main()
