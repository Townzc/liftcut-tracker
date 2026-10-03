import hashlib,json,time
from datetime import datetime,timezone
from pathlib import Path
import sys
ops=Path('/root/autodl-tmp/liftcut/ops/overnight-20261003')
sys.path.insert(0,str(ops))
import overnight_lease_v2 as lease
now=lambda:datetime.now(timezone.utc)
start=datetime.fromisoformat('2026-10-03T13:50:00+00:00')
end=datetime.fromisoformat('2026-10-03T14:05:00+00:00')
if not start<=now()<end:raise ValueError('Outside fixed closure observation interval')
cfg=lease.read(ops/'lease.json')
if cfg['deadline']!='2026-10-03T14:00:00+00:00':raise ValueError('Power deadline changed')
lease.guard_alive(ops,cfg)
def emit(obj): print(json.dumps(obj,separators=(',',':')),flush=True)
emit({'event':'existing_guard_verified','at_utc':now().isoformat(),
      'armed':lease.read(ops/'guard-armed.json'),'lease':cfg,
      'scope':'read-only; no new guard, shutdown command, receipt or model launch'})
seen={}
until=time.monotonic()+(end-now()).total_seconds()
while time.monotonic()<until:
 for name in ('events.jsonl','shutdown-return.json'):
  p=ops/name
  try:raw=p.read_bytes()
  except FileNotFoundError:continue
  sha=hashlib.sha256(raw).hexdigest()
  if seen.get(name)==sha:continue
  try:
   text=raw.decode('utf-8')
   parsed=[json.loads(line) for line in text.splitlines()] if name.endswith('.jsonl') else json.loads(text)
  except (UnicodeDecodeError,json.JSONDecodeError):continue
  emit({'event':'server_file_observed','at_utc':now().isoformat(),'name':name,
        'sha256':sha,'utf8':text,'parsed':parsed})
  seen[name]=sha
 time.sleep(.1 if now().hour>=14 else 1)
emit({'event':'observation_limit_reached','at_utc':now().isoformat(),
      'provider_power_verified':False,'provider_billing_verified':False})
