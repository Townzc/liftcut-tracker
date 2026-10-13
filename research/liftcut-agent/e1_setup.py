"""Future E1 dispatch checks. No held-out payload is read before durable reservation."""
import argparse
import importlib.metadata
import json
import platform
from pathlib import Path
import shutil
import subprocess
import sys
from d2_execution import read, utcnow, aware, expected_runtime
from e1_execution import ROOT, binding, verify_plan, verify_parent
from e1_power import PERSIST, verify_guard, safe_ops, active_workers, identity, validate_bound_power
from e1_data_use import reserve
from gpu_counterfactual_diagnostics import verify_model
from server_workspace import command, dump_new


def dispatch(a):
    if sys.platform != 'linux':
        raise ValueError('authorized Linux dispatch only')
    plan = verify_plan(); b = json.loads(a.binding_json)
    if b != binding(plan, b['code_commit'], b['authorization'], b['run_id'], b['trial_started_at_utc']):
        raise ValueError('exact frozen execution binding required')
    validate_bound_power(b, utcnow()); safe_ops(a.ops, b); verify_guard(a.ops, b)
    if (command(['git', 'rev-parse', 'HEAD'], ROOT) != b['code_commit']
            or command(['git', 'status', '--porcelain'], ROOT)
            or a.run != PERSIST / 'runs' / ('e1-run-' + b['run_id'])
            or a.run.resolve() != a.run or a.run.exists()
            or (a.ops / 'dispatch-reservation.json').exists()):
        raise ValueError('clean reviewed checkout and unique canonical run required')
    if active_workers() or command(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader'], ROOT):
        raise ValueError('worker/GPU already running')
    expected = expected_runtime()
    if (platform.python_version() != expected['python']
            or any(importlib.metadata.version(k) != v for k, v in expected['packages'].items())):
        raise ValueError('pinned runtime required; no install in a paid window')
    verify_parent(a.parent_run, plan); verify_model(a.model_dir, a.model_manifest)
    from prepare_counterfactual_diagnostics import load_tokenizer
    load_tokenizer(a.tokenizer_dir)
    if shutil.disk_usage(a.ops).free < 500_000_000:
        raise ValueError('500MB existing result space required; no expansion')
    validate_bound_power(b, utcnow())  # expensive checks cannot reset the ten-minute startup limit
    ledger = reserve(PERSIST / 'ops/e1-data-use', plan['protocol'], b, side='server')
    opening = {'binding': b, 'at_utc': utcnow().isoformat(), 'evidence_kind': 'model'}
    dump_new(a.ops / 'opening.json', opening)
    dump_new(a.ops / 'dispatch-reservation.json', {'binding': b, 'run': str(a.run), 'data_ledger': str(ledger)})
    argv = [sys.executable, str(ROOT / 'run_e1_window.py'), '--execute']
    for name in ('ops', 'run', 'parent_run', 'model_dir', 'model_manifest', 'tokenizer_dir'):
        argv += ['--' + name.replace('_', '-'), str(getattr(a, name))]
    argv += ['--data-ledger', str(ledger)]
    with (a.ops / 'controller.log').open('x') as log:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log,
                                 stderr=subprocess.STDOUT, start_new_session=True)
    value = {'opening': opening, 'controller_pid': child.pid, 'controller_identity': identity(child.pid),
             'original_deadlines_preserved': True, 'new_training': False}
    dump_new(a.ops / 'launch.json', value)
    return value


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--dispatch', action='store_true', required=True)
    for n in ('ops', 'run', 'parent-run', 'model-dir', 'model-manifest', 'tokenizer-dir'):
        p.add_argument('--' + n, type=Path, required=True)
    p.add_argument('--binding-json', required=True)
    print(json.dumps(dispatch(p.parse_args())))
