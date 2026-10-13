import sys,json,subprocess
from pathlib import Path
from datetime import datetime,timezone
p=Path('/root/autodl-tmp/liftcut')
ops=p/'ops/overnight-20261013-042700'
sys.path.insert(0,str(ops))
from research_lease import verify_live,identity
lease=verify_live(ops/'lease.json')
sys.path.insert(0,str(p/'code/32fbbac18d48493a8f37221a3e4b090e3b431cf2/research/liftcut-agent'))
from i2_setup import active_workers
stage=p/'staging/i2-night-20261013-050255'
result={'at_utc':datetime.now(timezone.utc).isoformat(),'lease':lease,'guard_identity':identity(1552),
        'active_workers':active_workers(),
        'gpu_processes':subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip(),
        'remote_reservation_exists':(ops/'i2-dispatch-reservation.json').exists(),
        'failed_ops_exists':(p/'runs/i2-ops-20261013-050255').exists(),
        'failed_run_exists':(p/'runs/i2-run-20261013-050255').exists(),
        'failed_code_checkout_exists':(p/'code/99c29d6145072599f58306fb1a670515e1991079').exists(),
        'failed_stage_exists':stage.exists(),
        'failed_stage_entries':sorted(x.name for x in stage.iterdir()) if stage.exists() else None,
        'read_only':True,'model_calls':0}
print(json.dumps(result))
assert not result['active_workers'] and not result['gpu_processes']
assert not any(result[k] for k in ('remote_reservation_exists','failed_ops_exists','failed_run_exists','failed_code_checkout_exists'))
assert result['failed_stage_exists'] and result['failed_stage_entries']==[]
assert lease['booted_at_proxy']=='2026-10-13T04:27:00+00:00' and lease['shutdown_at_utc']=='2026-10-13T15:00:00+00:00'
