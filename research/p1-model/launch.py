"""Offline-first, single-dispatch P1-M relay; --connect requires NEW authorization.

Database and auth stay on loopback. The remote model sees only synthetic public
tool messages. No asset transfer, server opening, paid API, or automatic retry.
"""
import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time

from protocol import ROOT, MANIFEST, bind, aware, sha, read, verify_sources
from prepare import stage
from relay import drive, exclusive, now
from restore import pg, backup, verify_parent


def offline(config):
    cfg = read(config); plan = verify_sources()
    if cfg['study'] != plan['study'] or not re.fullmatch(r'[a-z0-9.-]+', cfg['host']) or not 1 <= cfg['port'] <= 65535:
        raise ValueError('invalid endpoint/study')
    if not re.fullmatch(r'[0-9a-f]{64}', cfg['hostKeySha256']): raise ValueError('trusted host fingerprint required')
    for key in ('model', 'adapter', 'remotePython', 'bootstrapPython'):
        if not re.fullmatch(r'/root/[A-Za-z0-9_./-]+', cfg[key]) or '..' in Path(cfg[key]).parts:
            raise ValueError('remote absolute asset/runtime path required')
    commit = cfg['codeCommit']
    if not re.fullmatch(r'[0-9a-f]{40}', commit): raise ValueError('exact tested execution commit required')
    for name, wanted in {**plan['sources'], str(MANIFEST.relative_to(ROOT)).replace('\\', '/'): sha(MANIFEST)}.items():
        result = subprocess.run(['git', 'show', f'{commit}:{name}'], cwd=ROOT, capture_output=True, timeout=10)
        if result.returncode or hashlib.sha256(result.stdout).hexdigest() != wanted: raise ValueError('frozen Git bytes differ: ' + name)
    subprocess.run(['git', 'merge-base', '--is-ancestor', commit, 'main'], cwd=ROOT, check=True, capture_output=True, timeout=10)
    if not Path(cfg['restorePython']).is_file() or not Path(cfg['tokenizer']).is_dir(): raise ValueError('pinned local restore runtime missing')
    if not Path(cfg['knownHosts']).is_file(): raise ValueError('existing known_hosts required')
    verify_parent(cfg['localAdapter'])
    return cfg, {'offline_only': True, 'frozen_sources': len(plan['sources']), 'assets_uploaded': 0, 'model_calls': 0,
                 'explicit_new_authorization_required': True, 'code_commit': commit}


class Session:
    def __init__(self, client, end, bootstrap): self.client, self.end, self.bootstrap = client, end, bootstrap
    def check(self):
        if time.time() >= self.end: raise TimeoutError('original collection cutoff')
    def command(self, argv, *, timeout=45):
        self.check()
        channel = self.client.get_transport().open_session(timeout=10)
        channel.settimeout(min(timeout, max(1, self.end - time.time())))
        channel.exec_command(shlex.join(argv))
        out, err = channel.makefile('rb').read(), channel.makefile_stderr('rb').read()
        code = channel.recv_exit_status(); channel.close()
        if code: raise RuntimeError(f'remote command failed ({code}); preserve operations; no automatic retry')
        return out
    def python(self, code, *args):
        return self.command([self.bootstrap, '-c', code, *args])


def connect(config, authorization, operations):
    cfg, report = offline(config)
    b = bind(authorization, cfg['codeCommit'])
    operations = Path(operations).resolve(); operations.mkdir(parents=True, exist_ok=False)
    exclusive(operations / 'binding.json', b); exclusive(operations / 'offline.json', report)
    # This permanent reservation belongs to this development protocol, not an
    # output directory. A new run-id cannot silently rerun the same model study.
    reservation = ROOT / 'research/liftcut-agent/outputs/autodl/p1m-data-use-v1.json'
    exclusive(reservation, {'binding': b, 'operations': str(operations), 'pid': os.getpid(), 'at_utc': now()})
    def event(name, **details):
        with (operations / 'events.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'event': name, 'at_utc': now(), **details}) + '\n'); stream.flush(); os.fsync(stream.fileno())
    event('reserved', pid=os.getpid(), binding=b)
    url = os.environ['P1_TEST_DATABASE_URL']
    count = pg('psql', ['-tA', '--set=ON_ERROR_STOP=1', '--command', 'select count(*) from agent_private.runs;'], url).strip()
    if count != b'0': raise ValueError('fresh initialized empty synthetic database required')
    stage_path = operations / 'code.tar.gz'; stage_report = stage(stage_path)
    event('stage_created', **stage_report)
    import paramiko
    class PinnedHost(paramiko.MissingHostKeyPolicy):
        def missing_host_key(self, client, hostname, key):
            if hashlib.sha256(key.asbytes()).hexdigest() != cfg['hostKeySha256']: raise ValueError('untrusted SSH host key')
            # Explicit fingerprint from an already trusted host. No trust-on-first-use.
            client.get_host_keys().add(hostname, key.get_name(), key)
    client = paramiko.SSHClient(); client.load_host_keys(cfg['knownHosts']); client.set_missing_host_key_policy(PinnedHost())
    remote = '/root/autodl-tmp/liftcut/ops/' + b['runId']
    guard_started, worker_started = False, False
    try:
        client.connect(cfg['host'], cfg['port'], username='root', password=getpass.getpass('AutoDL SSH password (not stored): '),
                       look_for_keys=False, allow_agent=False, timeout=12, banner_timeout=12, auth_timeout=12)
        if hashlib.sha256(client.get_transport().get_remote_server_key().asbytes()).hexdigest() != cfg['hostKeySha256']:
            raise ValueError('connected key differs from explicit pin')
        session = Session(client, aware(b['collectionCutoff']).timestamp(), cfg['bootstrapPython']); event('ssh_connected')
        session.python('import pathlib,sys; pathlib.Path(sys.argv[1]).mkdir(parents=True,exist_ok=False)', remote)
        sftp = client.open_sftp(); sftp.get_channel().settimeout(15)
        def put(local, path):
            session.check()
            with sftp.open(path, 'wx') as target, Path(local).open('rb') as source:
                while chunk := source.read(65536): target.write(chunk)
            observed = session.python('import hashlib,pathlib,sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())', path).decode().strip()
            if observed != sha(local): raise ValueError('uploaded bytes differ')
        put(operations / 'binding.json', remote + '/binding.json')
        guard = ROOT / 'research/liftcut-agent/shutdown_guard.py'; put(guard, remote + '/shutdown_guard.py')
        code = ('import subprocess,sys,json; p=subprocess.Popen([sys.argv[1],sys.argv[2],"--arm","--deadline",sys.argv[3],"--receipt",sys.argv[4]],'
                'stdin=subprocess.DEVNULL,stdout=open(sys.argv[5],"x"),stderr=subprocess.STDOUT,start_new_session=True); print(json.dumps({"pid":p.pid}))')
        identity = json.loads(session.python(code, cfg['bootstrapPython'], remote + '/shutdown_guard.py', b['hardCutoff'], remote + '/guard-events.jsonl', remote + '/guard.log'))
        guard_started = True; event('guard_dispatched', **identity)
        code = ('import pathlib,json,sys,time,os; p=pathlib.Path(sys.argv[1]); end=time.monotonic()+8\n'
                'while (not p.exists() or not p.read_text().endswith("\\n")) and time.monotonic()<end: time.sleep(.1)\n'
                'rows=[json.loads(s) for s in p.read_text().splitlines()]; assert rows[0]["status"]=="armed" and rows[0]["deadline"]==sys.argv[2]; '
                'os.kill(int(sys.argv[3]),0); argv=pathlib.Path("/proc/"+sys.argv[3]+"/cmdline").read_bytes().split(bytes([0])); '
                'assert sys.argv[2].encode() in argv and sys.argv[1].encode() in argv; print(json.dumps(rows[0]))')
        armed = json.loads(session.python(code, remote + '/guard-events.jsonl', b['hardCutoff'], str(identity['pid'])))
        exclusive(operations / 'guard-verified.json', armed); event('guard_verified', **identity)
        # Refuse busy compute before uploading/installing the larger source pack.
        busy = session.command(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader']).strip()
        if busy: raise ValueError('existing GPU process; do not dispatch')
        put(stage_path, remote + '/code.tar.gz')
        install = ('import tarfile,pathlib,sys; root=pathlib.Path(sys.argv[2]); root.mkdir(); names=set()\n'
                   'with tarfile.open(sys.argv[1],"r:gz") as t:\n'
                   ' for m in t:\n'
                   '  p=pathlib.PurePosixPath(m.name); assert m.isfile() and not p.is_absolute() and ".." not in p.parts and "\\\\" not in m.name and ":" not in m.name and m.name not in names; names.add(m.name); out=root/m.name; out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(t.extractfile(m).read())')
        session.python(install, remote + '/code.tar.gz', remote + '/code')
        verify = 'import sys;sys.path.insert(0,sys.argv[1]);from protocol import verify_sources;print(len(verify_sources()["sources"]))'
        sources = int(session.python(verify, remote + '/code/research/p1-model').decode().strip()); event('remote_sources_verified', sources=sources)
        work_end = aware(b['workCutoff']).timestamp()
        if time.time() > aware(b['opening']).timestamp() + 600: raise TimeoutError('startup budget exceeded; preserve failed reservation')
        channel = client.get_transport().open_session(timeout=10); channel.settimeout(1)
        argv = [cfg['remotePython'], '-u', remote + '/code/research/p1-model/worker.py', '--binding', remote + '/binding.json',
                '--output', remote + '/evidence', '--model', cfg['model'], '--adapter', cfg['adapter'],
                '--reservation', '/root/autodl-tmp/liftcut/ops/p1m-data-use-v1.json']
        channel.exec_command(shlex.join(argv)); worker_started = True; event('worker_dispatched', argv=argv)
        buffer = bytearray()
        def receive(expected, end):
            while time.time() < end:
                if channel.recv_stderr_ready():
                    with (operations / 'server-stderr.log').open('ab') as f: f.write(channel.recv_stderr(65536))
                if b'\n' in buffer:
                    line, _, remaining = buffer.partition(b'\n'); buffer[:] = remaining
                    value = json.loads(line)
                    with (operations / 'server-stream.jsonl').open('ab') as f: f.write(line + b'\n')
                    if expected is None or value['command'] == expected: return value
                    raise ValueError('unexpected server protocol frame')
                if channel.recv_ready():
                    data = channel.recv(65536)
                    if not data: raise ConnectionError('server channel ended')
                    buffer.extend(data)
                    if len(buffer) > 4000000: raise ValueError('server frame too large')
                elif channel.exit_status_ready() or not client.get_transport().is_active():
                    raise ConnectionError('server disconnected; no automatic retry')
                else: time.sleep(.05)
            raise TimeoutError('original deadline')
        ready = receive('ready', min(work_end, time.time() + 180)); event('worker_ready', **{k: v for k, v in ready.items() if k != 'command'})
        records = []
        def complete(payload):
            channel.sendall((json.dumps({'command': 'generate', 'number': len(records) + 1, 'payload': payload}, ensure_ascii=False) + '\n').encode())
            reply = receive('reply', work_end)['value']
            records.append({'request': payload, 'reply': reply})
            with (directory / 'local-native-replies.jsonl').open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(records[-1], ensure_ascii=False) + '\n'); stream.flush(); os.fsync(stream.fileno())
            return reply
        directory = operations / 'evidence'
        result = drive(directory, complete, mode='model', work_end=work_end, binding_file=operations / 'binding.json')
        exclusive(directory / 'binding.json', b)
        exclusive(directory / 'native-records.json', {'kind': 'model', 'model_calls': result['summary']['modelCalls'], 'records': records})
        channel.sendall(b'{"command":"finish"}\n'); done = receive('complete', work_end)['value']
        for name in [*done['files'], 'server-complete.json']:
            if not re.fullmatch(r'[a-z-]+\.(json|jsonl)', name): raise ValueError('unsafe remote evidence name')
            with sftp.open(remote + '/evidence/' + name, 'rb') as source: data = source.read()
            if name in done['files'] and hashlib.sha256(data).hexdigest() != done['files'][name]: raise ValueError('download SHA differs')
            with (directory / name).open('xb') as f: f.write(data)
        backup(directory, url); event('actual_database_backup_sealed')
        restore_dir = operations / 'restored'
        argv = [cfg['restorePython'], str(ROOT / 'research/p1-model/restore.py'), 'restore', '--directory', str(directory),
                '--output', str(restore_dir), '--tokenizer-dir', cfg['tokenizer'], '--parent', cfg['localAdapter']]
        restored = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=max(1, min(180, session.end-time.time())))
        exclusive(operations / 'restore-process.json', {'returncode': restored.returncode, 'stdout': restored.stdout, 'stderr': restored.stderr})
        if restored.returncode: raise ValueError('genuine full restore failed; no ACK')
        receipt = restore_dir / 'backup-receipt.json'
        put(receipt, remote + '/evidence/ack.pending.json'); event('receipt_uploaded_verified', sha256=sha(receipt))
        sftp.rename(remote + '/evidence/ack.pending.json', remote + '/evidence/ack.json'); event('receipt_atomic_publish_returned', sha256=sha(receipt))
        consumed = receive('ack_consumed', session.end)
        if consumed['sha256'] != sha(receipt): raise ValueError('server consumed a different receipt')
        event('server_ack_consumed', sha256=consumed['sha256'])
        try:
            while time.time() < session.end:
                observed = receive(None, min(session.end, time.time()+35)); event('server_power_frame', value=observed)
        except (ConnectionError, TimeoutError, OSError) as exc: event('post_ack_transport_end', error_type=type(exc).__name__, platform_power='unknown')
        event('collector_complete', platform_power='unknown')
    except Exception as exc:
        event('collector_failed', error_type=type(exc).__name__, guard_dispatched=guard_started, worker_dispatched=worker_started)
        incomplete = operations / 'evidence'
        if incomplete.exists() and not (incomplete / 'inventory.json').exists():
            try:
                if not (incomplete / 'database.dump').exists(): backup(incomplete, url)
                event('partial_database_preserved', complete_model_receipt=False)
            except Exception as partial: event('partial_backup_failed', error_type=type(partial).__name__)
        # If setup failed before the worker owns cleanup, request early shutdown
        # within this already authorized window. Never create/reboot an instance.
        if not worker_started and client.get_transport() and client.get_transport().is_active():
            try:
                event('setup_shutdown_requested')
                response = session.python('import pathlib,subprocess,json; p=pathlib.Path("/usr/bin/shutdown"); prefix=p.read_bytes()[:4]; '
                    'args=[str(p)] if prefix.startswith((b"#!",b"\\x7fELF")) else ["/bin/bash",str(p)]; '
                    'r=subprocess.run(args,capture_output=True,timeout=30); print(json.dumps({"returncode":r.returncode}))')
                event('setup_shutdown_returned', returncode=json.loads(response)['returncode'], platform_power='unknown')
            except Exception as shut: event('setup_shutdown_unknown', error_type=type(shut).__name__, platform_power='unknown')
        raise
    finally:
        client.close(); event('local_transport_closed', platform_power='unknown')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', type=Path, required=True); p.add_argument('--authorization', type=Path)
    p.add_argument('--operations', type=Path); p.add_argument('--connect', action='store_true')
    a = p.parse_args()
    if a.connect:
        if not a.authorization or not a.operations: p.error('new authorization and unique operations required')
        connect(a.config, a.authorization, a.operations)
    else: print(json.dumps(offline(a.config)[1]))
