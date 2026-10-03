"""G3 seed42 work/backup boundaries; G2 and earlier contracts stay frozen."""
from datetime import timedelta
import re

from d2_execution import ROOT, Clock, aware, read, utcnow
from liftcut_agent.interactive import digest
from prepare_g3 import ARMS, BUDGET, arm_binding, verify_prepared
from server_workspace import command, sha256

EXECUTION = ROOT / 'reports/g3-execution-v1.json'
SOURCES = ('g3_execution.py', 'gpu_train_g3.py', 'gpu_g3.py', 'g2_rollout.py', 'audit_g3.py',
           'run_g3_window.py', 'restore_g3.py', 'g3_receipt_transfer.py', 'prepare_g3.py',
           'g1_pair_feasibility.py', 'shutdown_guard.py', 'run_recovery_window.py',
           'restore_recovery.py', 'run_controlled_window.py', 'audit_recovery.py',
           'audit_coverage_tokens.py', 'audit_controlled.py', 'src/liftcut_agent/qwen_transport.py',
           'g3_setup.py', 'g3_prelaunch_guard.py', 'launch_g3_remote.py', 'monitor_g3.py',
           'stage_g3.py', 'd2_bundle.py', 'run_counterfactual_window.py', 'monitor_counterfactual_diagnostics.py',
           'replication_receipt_transfer.py', 'monitor_coverage_replication.py', 'server_workspace.py',
           'counterfactual_diagnostics.py', 'state_diagnostics.py', 'coverage_rollout.py',
           'prepare_counterfactual_diagnostics.py', 'prepare_state_diagnostics.py', 'drill_g3.py',
           'configs/g3-monitor.template.json', 'prepare_g2.py', 'g2_execution.py',
           'reports/g2-seed42-2026-10-03/run/training/coverage_mix/training.jsonl',
           'reports/g2-seed42-2026-10-03/run/training/coverage_mix/initialization.json')

# G3 reuses byte-identical G1/G2 pools, the shared G2 rollout and the actual G2
# coverage_mix log as the reproduction reference. Freeze the inherited set too.
SOURCES = tuple(sorted(set(SOURCES) | set(read(ROOT / 'reports/g2-execution-v1.json')['source_sha256'])
                       | {'analyze_g1_contexts.py', 'analyze_g1_results.py', 'publish_g1_results.py',
                          'analyze_d2_results.py', 'analyze_d2_partial.py', 'prepare_g1.py'}))


def execution_plan(prepared):
    return {'version': 'g3-execution-v1', 'preparation': verify_prepared(prepared),
            'source_sha256': {s: sha256(ROOT / s) for s in SOURCES}, 'budget': BUDGET,
            'phases': [f'{phase}-{arm}' for arm in ARMS for phase in ('train', 'evaluate')] + ['audit'],
            'test_episodes': 0}


def verify_plan(prepared):
    actual = execution_plan(prepared)
    if actual != read(EXECUTION):
        raise ValueError('G3 execution source or inputs differ from reviewed plan')
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
    return {'version': 'g3-window-binding-v1', 'execution_plan_sha256': digest(plan),
            'code_commit': commit, 'seed': 42, 'booted_at_proxy': booted_at,
            'work_cutoff': work.isoformat(), 'hard_cutoff': hard.isoformat(), 'test_episodes': 0}


def validate_opening(opening, plan, *, scripted=False):
    expected = binding(plan, opening['binding']['code_commit'], opening['booted_at_proxy'])
    if (opening['binding'] != expected or opening['budget'] != BUDGET
            or opening['evidence_kind'] != ('scripted_contract' if scripted else 'model')):
        raise ValueError('G3 opening/budget/evidence kind differs')
    deadlines(opening['booted_at_proxy'], aware(opening['started_at_utc']))
    return expected


def verify_worker(run, prepared, commit, arm):
    plan = verify_plan(prepared)
    bind = validate_opening(read(run / 'opening.json'), plan)
    if (command(['git', 'rev-parse', 'HEAD'], ROOT) != commit or bind['code_commit'] != commit
            or command(['git', 'status', '--porcelain'], ROOT)):
        raise ValueError('exact clean committed worker and original opening required')
    if Clock().now() >= aware(bind['work_cutoff']):
        raise TimeoutError('original G3 work cutoff expired')
    return plan['preparation'], arm_binding(plan['preparation'], commit, arm)


if __name__ == '__main__':
    import argparse
    from server_workspace import dump_new
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--prepared-dir', required=True, type=__import__('pathlib').Path)
    p.add_argument('--write-initial-plan', action='store_true')
    a = p.parse_args()
    if a.write_initial_plan:
        dump_new(EXECUTION, execution_plan(a.prepared_dir))
    plan = verify_plan(a.prepared_dir)
    print({'version': plan['version'], 'sources': len(plan['source_sha256']), 'phases': plan['phases']})
