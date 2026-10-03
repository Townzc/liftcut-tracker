"""G4 runs inside the authorized continuous lease; instance boot is never reset."""
from datetime import timedelta
from pathlib import Path
import re
from d2_execution import ROOT, Clock, aware, read, utcnow
from liftcut_agent.interactive import digest
from prepare_g4 import ARMS, BUDGET, arm_binding, verify_prepared
from server_workspace import command, sha256

EXECUTION=ROOT/'reports/g4-execution-v1.json'
LEASE_DIR=Path('/root/autodl-tmp/liftcut/ops/overnight-20261003')
POWER_RECORD=ROOT/'reports/g3-seed42-2026-10-03/overnight-lease-install.json'
NEW_SOURCES=('prepare_g4.py','memory_order_coverage.py','g4_execution.py','gpu_train_g4.py',
             'gpu_g4.py','audit_g4.py','run_g4_window.py','g4_receipt_transfer.py','restore_g4.py',
             'launch_g4_overnight.py','drill_g4.py','overnight_lease.py','g4_gates.py')
SOURCES=tuple(sorted(set(NEW_SOURCES)|set(read(ROOT/'reports/g3-execution-v1.json')['source_sha256'])))


def execution_plan(prepared):
    return {'version':'g4-execution-v1','preparation':verify_prepared(prepared),
            'source_sha256':{s:sha256(ROOT/s) for s in SOURCES},'budget':BUDGET,
            'lease_configuration_digest':digest(read(POWER_RECORD)['lease']),
            'phases':[f'{p}-{a}' for a in ARMS for p in ('train','evaluate')]+['audit'],
            'test_episodes':0}


def verify_plan(prepared):
    actual=execution_plan(prepared)
    if actual!=read(EXECUTION):raise ValueError('G4 execution source/data differs from reviewed plan')
    return actual


def deadlines(trial_started, now, *, launching=True):
    start=aware(trial_started)
    if now.utcoffset() is None or not aware(BUDGET['instance_boot']) <= start <= now:
        raise ValueError('real instance boot and separate aware trial start required')
    work=min(start+timedelta(minutes=BUDGET['work_minutes']),aware(BUDGET['work_latest']))
    collect=min(work+timedelta(minutes=BUDGET['collection_minutes']),aware(BUDGET['collection_latest']))
    if launching and ((now-start).total_seconds()>60 or
                      (work-now).total_seconds()<BUDGET['minimum_work_minutes_at_launch']*60):
        raise TimeoutError('new dispatch too late or insufficient original lease remains')
    if not work < collect < aware(BUDGET['power_deadline']):raise ValueError('invalid G4 lease bounds')
    return work,collect


def binding(plan,commit,trial_started):
    if not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('exact commit required')
    work,collect=deadlines(trial_started,aware(trial_started))
    return {'version':'g4-window-binding-v1','execution_plan_sha256':digest(plan),'code_commit':commit,
            'seed':42,'booted_at_proxy':BUDGET['instance_boot'],'trial_started_at_utc':trial_started,
            'work_cutoff':work.isoformat(),'collection_cutoff':collect.isoformat(),
            'hard_cutoff':BUDGET['power_deadline'],'test_episodes':0}


def validate_opening(opening,plan,*,scripted=False):
    expected=binding(plan,opening['binding']['code_commit'],opening['trial_started_at_utc'])
    if (opening['binding']!=expected or opening['budget']!=BUDGET
            or opening['booted_at_proxy']!=BUDGET['instance_boot']
            or opening['evidence_kind']!=('scripted_contract' if scripted else 'model')
            or opening['lease_configuration_digest']!=plan['lease_configuration_digest']):
        raise ValueError('G4 opening or original lease differs')
    deadlines(opening['trial_started_at_utc'],aware(opening['started_at_utc']))
    return expected


def verify_live_lease(plan):
    from overnight_lease import validate_lease, guard_alive
    cfg=read(LEASE_DIR/'lease.json')
    if digest(cfg)!=plan['lease_configuration_digest']:
        raise ValueError('different live overnight authorization')
    validate_lease(cfg,utcnow());guard_alive(LEASE_DIR,cfg)
    handoff=read(LEASE_DIR/'handoff-complete.json')
    if handoff['index']['status']!='complete' or handoff['training_conditions_changed']:
        raise ValueError('G3 must have completed without changing scientific conditions')
    receipt=read(LEASE_DIR/'g3-receipt-consumption.json')
    if (not receipt['receipt']['complete_study_replayed'] or receipt['receipt']['episodes_replayed']!=222
            or receipt['new_receipts_created']!=0):raise ValueError('actual G3 receipt consumption required')
    return cfg


def verify_worker(run,prepared,commit,arm):
    plan=verify_plan(prepared);bind=validate_opening(read(run/'opening.json'),plan)
    if (command(['git','rev-parse','HEAD'],ROOT)!=commit or bind['code_commit']!=commit
            or command(['git','status','--porcelain'],ROOT)):
        raise ValueError('clean exact G4 worker required')
    if utcnow()>=aware(bind['work_cutoff']):raise TimeoutError('G4 original trial cutoff expired')
    verify_live_lease(plan)
    return plan['preparation'],arm_binding(plan['preparation'],commit,arm)


if __name__=='__main__':
    import argparse
    from server_workspace import dump_new
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--prepared-dir',required=True,type=Path)
    p.add_argument('--write-initial-plan',action='store_true')
    a=p.parse_args()
    if a.write_initial_plan:dump_new(EXECUTION,execution_plan(a.prepared_dir))
    result=verify_plan(a.prepared_dir)
    print({'sources':len(result['source_sha256']),'gpu_calls':0})
