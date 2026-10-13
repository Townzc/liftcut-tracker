import json,sys,time
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
