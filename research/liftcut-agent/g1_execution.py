"""G1 seed42 work/backup boundaries; historical R1 and D2 contracts stay frozen."""
from datetime import timedelta
import re

from d2_execution import ROOT, Clock, aware, read, utcnow
from liftcut_agent.interactive import digest
from prepare_g1 import ARMS, BUDGET, arm_binding, verify_prepared
from server_workspace import command, sha256

EXECUTION = ROOT / 'reports/g1-execution-v1.json'
SOURCES = ('g1_execution.py', 'gpu_train_g1.py', 'gpu_g1.py', 'g1_rollout.py', 'audit_g1.py',
           'run_g1_window.py', 'restore_g1.py', 'g1_receipt_transfer.py', 'prepare_g1.py',
           'g1_pair_feasibility.py', 'shutdown_guard.py', 'run_recovery_window.py',
           'restore_recovery.py', 'run_controlled_window.py', 'audit_recovery.py',
           'audit_coverage_tokens.py', 'audit_controlled.py', 'src/liftcut_agent/qwen_transport.py',
           'g1_setup.py', 'g1_prelaunch_guard.py', 'launch_g1_remote.py', 'monitor_g1.py',
           'stage_g1.py', 'd2_bundle.py', 'run_counterfactual_window.py', 'monitor_counterfactual_diagnostics.py',
           'replication_receipt_transfer.py', 'monitor_coverage_replication.py', 'server_workspace.py',
           'counterfactual_diagnostics.py', 'state_diagnostics.py', 'coverage_rollout.py',
           'prepare_counterfactual_diagnostics.py', 'prepare_state_diagnostics.py', 'drill_g1.py',
           'configs/g1-monitor.template.json')


def execution_plan(prepared):
    return {'version': 'g1-execution-v1', 'preparation': verify_prepared(prepared),
            'source_sha256': {s: sha256(ROOT / s) for s in SOURCES}, 'budget': BUDGET,
            'phases': [f'{phase}-{arm}' for arm in ARMS for phase in ('train', 'evaluate')] + ['audit'],
            'test_episodes': 0}


def verify_plan(prepared):
    actual = execution_plan(prepared)
    if actual != read(EXECUTION):
        raise ValueError('G1 execution source or inputs differ from reviewed plan')
    return actual


def deadlines(booted_at, now, *, launching=True):
    boot = aware(booted_at)
    if now.utcoffset() is None or boot > now:
        raise ValueError('aware original boot time cannot be in the future')
    if launching and (now - boot).total_seconds() > 60 * BUDGET['setup_minutes']:
        raise TimeoutError('original ten-minute launch allowance expired')
    return boot + timedelta(minutes=BUDGET['work_minutes']), boot + timedelta(minutes=BUDGET['hard_minutes'])


def binding(plan, commit, booted_at):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('exact execution commit required')
    work, hard = deadlines(booted_at, aware(booted_at))
    return {'version': 'g1-window-binding-v1', 'execution_plan_sha256': digest(plan),
            'code_commit': commit, 'seed': 42, 'booted_at_proxy': booted_at,
            'work_cutoff': work.isoformat(), 'hard_cutoff': hard.isoformat(), 'test_episodes': 0}


def validate_opening(opening, plan, *, scripted=False):
    expected = binding(plan, opening['binding']['code_commit'], opening['booted_at_proxy'])
    if (opening['binding'] != expected or opening['budget'] != BUDGET
            or opening['evidence_kind'] != ('scripted_contract' if scripted else 'model')):
        raise ValueError('G1 opening/budget/evidence kind differs')
    deadlines(opening['booted_at_proxy'], aware(opening['started_at_utc']))
    return expected


def verify_worker(run, prepared, commit, arm):
    plan = verify_plan(prepared)
    bind = validate_opening(read(run / 'opening.json'), plan)
    if (command(['git', 'rev-parse', 'HEAD'], ROOT) != commit or bind['code_commit'] != commit
            or command(['git', 'status', '--porcelain'], ROOT)):
        raise ValueError('exact clean committed worker and original opening required')
    if Clock().now() >= aware(bind['work_cutoff']):
        raise TimeoutError('original G1 work cutoff expired')
    return plan['preparation'], arm_binding(plan['preparation'], commit, arm)
