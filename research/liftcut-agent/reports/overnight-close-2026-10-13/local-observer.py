"""One read-only final power observation. Never requests a shutdown or restart."""
import getpass,json,os,shlex,socket,sys,time
from datetime import datetime,timezone
from pathlib import Path
import paramiko

root=Path(__file__).resolve().parents[2]
now=lambda:datetime.now(timezone.utc)
start=now()
begin=datetime(2026,10,13,14,45,tzinfo=timezone.utc)
end=datetime(2026,10,13,15,5,tzinfo=timezone.utc)
if not begin<=start<end:raise ValueError('Final observation window only; no early or stale connection')
output=root/'outputs/autodl'/('overnight-close-'+start.strftime('%Y%m%d-%H%M%S'))
output.mkdir(exist_ok=False)
with (root/'outputs/autodl/overnight-close-20261013-reservation.json').open('x') as f:
    json.dump({'local_pid':os.getpid(),'output':str(output),'started_at_utc':start.isoformat()},f)
def event(kind,**fields):
    value={'event':kind,'at_utc':now().isoformat(),**fields}
    with (output/'local-events.jsonl').open('a',encoding='utf-8') as f:
        f.write(json.dumps(value)+'\n');f.flush();os.fsync(f.fileno())
    print(json.dumps(value),flush=True)
code="""import json,sys,time
from pathlib import Path
from datetime import datetime,timezone
p=Path('/root/autodl-tmp/liftcut/ops/overnight-20261013-042700')
sys.path.insert(0,str(p))
from research_lease import verify_live,identity
end=datetime(2026,10,13,15,5,tzinfo=timezone.utc)
lease=json.loads((p/'lease.json').read_text())
assert lease['shutdown_at_utc']=='2026-10-13T15:00:00+00:00'
if datetime.now(timezone.utc)<datetime(2026,10,13,15,tzinfo=timezone.utc):
    verify_live(p/'lease.json')
    print(json.dumps({'event':'original_guard_verified','at_utc':datetime.now(timezone.utc).isoformat(),'identity':identity(1552),'lease':lease}),flush=True)
seen={}
while datetime.now(timezone.utc)<end:
    for name in ('events.jsonl','shutdown-return.json'):
        path=p/name
        raw=path.read_text() if path.exists() else None
        if seen.get(name)!=raw:
            seen[name]=raw
            print(json.dumps({'event':'actual_file_observed','at_utc':datetime.now(timezone.utc).isoformat(),'name':name,'content':raw}),flush=True)
    time.sleep(.2)
"""
(output/'remote-read-only.py').write_text(code,encoding='utf-8')
c=paramiko.SSHClient();c.load_host_keys(str(Path.home()/'.ssh/known_hosts'));c.set_missing_host_key_policy(paramiko.RejectPolicy())
pw=getpass.getpass('Final read-only observation password (not stored): ')
channel=None
try:
    c.connect('connect.bjb1.seetacloud.com',port=15138,username='root',password=pw,look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15,banner_timeout=15)
    pw=None;event('ssh_connected',local_pid=os.getpid())
    channel=c.get_transport().open_session(timeout=15)
    channel.exec_command(shlex.join(['/root/miniconda3/bin/python','-u','-c',code]))
    event('read_only_stream_requested',original_power_deadline='2026-10-13T15:00:00+00:00')
    with (output/'server-stream.jsonl').open('xb') as stream,(output/'server-stderr').open('xb') as err:
        while now()<end:
            if channel.recv_ready():stream.write(channel.recv(65536));stream.flush();os.fsync(stream.fileno())
            if channel.recv_stderr_ready():err.write(channel.recv_stderr(65536));err.flush()
            if channel.exit_status_ready():
                while channel.recv_ready():stream.write(channel.recv(65536))
                stream.flush();os.fsync(stream.fileno())
                event('ssh_channel_return',returncode=channel.recv_exit_status(),transport_active=c.get_transport().is_active(),provider_power_state='unknown',provider_billing_stopped='unknown')
                break
            if not c.get_transport().is_active():
                event('ssh_transport_inactive',provider_power_state='unknown',provider_billing_stopped='unknown');break
            time.sleep(.1)
        else:event('local_observation_deadline',provider_power_state='unknown',provider_billing_stopped='unknown')
except BaseException as exc:
    event('observer_error',error_type=type(exc).__name__,message=str(exc),no_automatic_retry=True)
    raise
finally:
    pw=None;c.close();event('observer_closed',local_exit_is_not_power_confirmation=True)
