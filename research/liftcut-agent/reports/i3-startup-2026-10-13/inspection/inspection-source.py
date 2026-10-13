import sys,json,subprocess
from pathlib import Path
from datetime import datetime,timezone
root=Path('/root/autodl-tmp/liftcut');base=root/'code/acbba44cb16dce519823f2277206a8cdf3fcfca6/research/liftcut-agent'
sys.path[:0]=[str(base),str(base/'src')]
from research_lease import verify_live
from i2_setup import active_workers
lease=verify_live('/root/autodl-tmp/liftcut/ops/overnight-20261013-042700/lease.json')
paths=['staging/i3-20261013-080401','runs/i3-run-20261013-080401','runs/i3-ops-20261013-080401','ops/followups-452c2f667f371174bdf2']
value={'version':'i3-pre-dispatch-inspection-v1','at_utc':datetime.now(timezone.utc).isoformat(),'power_lease':lease,
       'workers':active_workers(),'gpu_pids':subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip(),
       'path_exists':{n:(root/n).exists() for n in paths},'remote_files_modified':0,'new_model_calls':0}
print(json.dumps(value))
