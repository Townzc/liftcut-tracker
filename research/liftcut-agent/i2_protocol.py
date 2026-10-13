"""I2 preregistration and a NEW opening-relative lease; no stale overnight dates."""
import argparse
from datetime import timedelta
from pathlib import Path
import re

from d2_execution import ROOT, PARSER, PRECISION, aware, read, utcnow
from i1_protocol import verify_adapter
from i2_gates import ARMS, GATES
from i2_view import FLAGS
from liftcut_agent.interactive import digest
from server_workspace import command, dump_new, sha256
from state_coverage import config

I1_COMMIT = '2bf816a02e116a3d26961bba817c49c590ccb910'
REFERENCE = ROOT/'reports/i2-reference-v1.json'
EXECUTION = ROOT/'reports/i2-execution-v1.json'
BUDGET = {'hourly_cny': 2.18, 'reserve_cny': 4, 'setup_minutes': 10,
          'work_minutes': 60, 'collection_minutes': 20, 'hard_minutes': 90,
          'minimum_work_minutes_at_launch': 50, 'minimum_collection_minutes_at_launch': 15,
          'automatic_reboot': False, 'paid_api_calls': 0, 'disk_expansion': False}
NEW_SOURCES = ('i2_view.py', 'i2_rollout.py', 'i2_gates.py', 'i2_protocol.py', 'gpu_i2.py',
               'audit_i2.py', 'run_i2_window.py', 'i2_receipt_transfer.py', 'restore_i2.py',
               'launch_i2.py', 'i2_setup.py', 'i2_assets.py', 'drill_i2.py', 'i2_oracle.py',
               'drill_i2_projection.py', 'audit_i2_inputs.py', 'research_lease.py', 'launch_i2_overnight.py')
SOURCES = tuple(sorted(set(read(ROOT/'reports/i1-execution-v1.json')['source_sha256']) | set(NEW_SOURCES)))


def reference_from_restored(restored, index_path, diagnostic, d2, tokenizer):
    from audit_i1 import audit
    from i1_receipt_transfer import validate_receipt
    index = read(index_path)
    if index['status'] != 'complete' or index['binding']['code_commit'] != I1_COMMIT:
        raise ValueError('complete original I1 required')
    receipt_path = restored/'off-instance-backup.json'
    receipt = validate_receipt(receipt_path.read_bytes(), index, index['binding'])
    if not receipt['model_result'] or not receipt['adapter_files_verified']:
        raise ValueError('actual I1 restoration required')
    run = restored/'parts/evidence'
    result = audit(run, diagnostic, d2, tokenizer)
    if result != read(run/'comparison.json') or result != read(restored/'independent-audit.json'):
        raise ValueError('I1 actual native/input/token reconstruction differs')
    if result['gates']['candidate_passed'] is not False:
        raise ValueError('registered I1 failure trigger absent')
    checkpoint = read(run/'reference/manifest.json')
    verify_adapter(run/'reference/final', checkpoint)
    return {'version': 'i2-reference-v1', 'model_result': True, 'checkpoint': checkpoint,
            'selection': 'same_preselected_G4_new_control_as_I1', 'i1_execution_commit': I1_COMMIT,
            'i1_candidate_passed': False, 'i1_episodes_replayed': 222,
            'i1_index_digest': digest(index), 'i1_receipt_sha256': sha256(receipt_path),
            'i1_comparison_digest': digest(result),
            'i1_view_sha256': {f'{panel}/{name}.jsonl': sha256(run/'evaluation/view'/panel/(name+'.jsonl'))
                for panel in ('normal', 'diagnostic', 'd2') for name in ('episodes', 'calls', 'generations', 'inputs')},
            'test_episodes': 0}


def validate_reference(reference, *, scripted=False):
    from i1_protocol import validate_reference as validate_checkpoint
    validate_checkpoint(reference['checkpoint'], scripted=False)
    if (reference['version'] != 'i2-reference-v1' or reference['model_result'] is not (not scripted)
            or reference['selection'] != 'same_preselected_G4_new_control_as_I1'
            or reference['i1_execution_commit'] != I1_COMMIT or reference['i1_candidate_passed'] is not False
            or reference['i1_episodes_replayed'] != 222 or reference['test_episodes'] != 0):
        raise ValueError('I2 reference selection or genuine I1 trigger differs')
    for key in ('i1_index_digest', 'i1_receipt_sha256', 'i1_comparison_digest'):
        if not re.fullmatch(r'[0-9a-f]{64}', reference[key]):
            raise ValueError('missing I1 evidence digest')
    if set(reference['i1_view_sha256']) != {f'{p}/{n}.jsonl' for p in ('normal','diagnostic','d2')
                                           for n in ('episodes','calls','generations','inputs')}:
        raise ValueError('complete I1 view reference inventory required')
    if any(not re.fullmatch(r'[0-9a-f]{64}', s) for s in reference['i1_view_sha256'].values()):
        raise ValueError('invalid I1 history hash')
    return reference


def execution_plan(reference, *, scripted=False):
    return {'version': 'i2-execution-v1', 'reference': validate_reference(reference, scripted=scripted),
            'source_sha256': {name: sha256(ROOT/name) for name in SOURCES}, 'gates': GATES,
            'arms': {a: list(FLAGS[a]) for a in ARMS}, 'candidate': 'D', 'budget': BUDGET,
            'config': config().manifest()['config'], 'parser': PARSER, 'precision': PRECISION,
            'phases': ['evaluate-'+a for a in ARMS]+['audit'], 'test_episodes': 0,
            'new_training': False, 'episodes_per_arm': 111, 'total_episodes': 444,
            'evidence_kind': 'scripted_contract' if scripted else 'model'}


def verify_plan():
    plan = execution_plan(read(REFERENCE))
    if plan != read(EXECUTION):
        raise ValueError('I2 frozen source/reference/configuration differs')
    return plan


def deadlines(booted, started, now, *, launching=True, power_lease=None):
    boot, start = aware(booted), aware(started)
    if now.utcoffset() is None or not boot <= start <= now:
        raise ValueError('actual new opening and trial start required')
    if power_lease is not None:
        from research_lease import validate
        end = validate(power_lease, now)
        if booted != power_lease['booted_at_proxy']:
            raise ValueError('original overnight opening cannot be reset')
        work = start + timedelta(minutes=BUDGET['work_minutes'])
        collect = work + timedelta(minutes=BUDGET['collection_minutes'])
        hard = start + timedelta(minutes=BUDGET['hard_minutes'])
        if (hard > end-timedelta(minutes=power_lease['final_collection_buffer_minutes'])
                or (launching and (now-start).total_seconds()>60)):
            raise TimeoutError('insufficient original overnight time for a bounded I2 trial')
        return work,collect,hard
    setup = boot + timedelta(minutes=BUDGET['setup_minutes'])
    hard = boot + timedelta(minutes=BUDGET['hard_minutes'])
    work = min(start+timedelta(minutes=BUDGET['work_minutes']), hard-timedelta(minutes=BUDGET['collection_minutes']))
    collect = min(work+timedelta(minutes=BUDGET['collection_minutes']), hard)
    if (start > setup or (launching and (now > setup or (now-start).total_seconds() > 60
            or (work-now).total_seconds() < 60*BUDGET['minimum_work_minutes_at_launch']
            or (collect-work).total_seconds() < 60*BUDGET['minimum_collection_minutes_at_launch']))):
        raise TimeoutError('I2 original opening too old; no deadline reset or extension')
    return work, collect, hard


def binding(plan, commit, booted, started, *, power_lease=None):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('exact execution commit required')
    work, collect, hard = deadlines(booted, started, aware(started),power_lease=power_lease)
    result = {'version': 'i2-window-binding-v1', 'code_commit': commit, 'execution_plan_digest': digest(plan),
            'reference_digest': digest(plan['reference']), 'booted_at_proxy': booted,
            'trial_started_at_utc': started, 'work_cutoff': work.isoformat(),
            'collection_cutoff': collect.isoformat(), 'hard_cutoff': hard.isoformat(),
            'test_episodes': 0, 'new_training': False}
    if power_lease is not None:result['power_lease']=power_lease
    return result


def validate_opening(opening, plan, *, scripted=False):
    b = opening['binding']
    expected = binding(plan, b['code_commit'], opening['booted_at_proxy'], opening['trial_started_at_utc'],power_lease=b.get('power_lease'))
    if (b != expected or opening['budget'] != BUDGET
            or opening['evidence_kind'] != ('scripted_contract' if scripted else 'model')):
        raise ValueError('I2 opening/lease binding differs')
    deadlines(b['booted_at_proxy'], b['trial_started_at_utc'], aware(opening['started_at_utc']),power_lease=b.get('power_lease'))
    return b


def manifest_for(bind, plan, arm, *, scripted=False):
    if arm not in ARMS:
        raise ValueError('unknown I2 arm')
    return {'version': 'i2-evaluation-v1', 'binding': bind, 'arm': arm, 'flags': list(FLAGS[arm]),
            'evidence_kind': 'scripted_contract' if scripted else 'model', 'reference_digest': digest(plan['reference']),
            'adapter_sha256': plan['reference']['checkpoint']['adapter_sha256'], 'config': plan['config'],
            'parser': plan['parser'], 'precision': plan['precision'], 'test_episodes': 0, 'new_training': False}


def verify_worker(run, commit):
    plan = verify_plan()
    bind = validate_opening(read(run/'opening.json'), plan)
    if command(['git','rev-parse','HEAD'], ROOT) != commit or bind['code_commit'] != commit or command(['git','status','--porcelain'], ROOT):
        raise ValueError('clean exact I2 execution checkout required')
    if utcnow() >= aware(bind['work_cutoff']):
        raise TimeoutError('original I2 work cutoff reached')
    from i2_setup import verify_guard
    guard=verify_guard(Path(read(run/'opening.json')['guard_path']), bind['hard_cutoff'])
    if 'power_lease' in bind:
        if guard.get('power_lease')!=bind['power_lease']:raise ValueError('worker and original power lease differ')
        from research_lease import identity
        watchdog=read(run/'trial-watchdog.json')
        if watchdog['deadline']!=bind['hard_cutoff'] or identity(watchdog['identity']['pid'])!=watchdog['identity']:
            raise ValueError('original bounded trial watchdog missing')
    verify_adapter(run/'reference/final', plan['reference']['checkpoint'])
    return plan, bind


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('create-reference','freeze','verify'): p.add_argument('--'+name, action='store_true')
    for name in ('i1-restored','i1-index','diagnostic-dir','d2-dir','tokenizer-dir'): p.add_argument('--'+name,type=Path)
    a = p.parse_args()
    if sum((a.create_reference,a.freeze,a.verify)) != 1: p.error('choose one action')
    if a.create_reference:
        dump_new(REFERENCE, reference_from_restored(a.i1_restored,a.i1_index,a.diagnostic_dir,a.d2_dir,a.tokenizer_dir))
    elif a.freeze:
        dump_new(EXECUTION, execution_plan(read(REFERENCE)))
    else:
        from prepare_state_diagnostics import verify_prepared as diag
        from prepare_counterfactual_diagnostics import verify_prepared as d2, load_tokenizer
        plan = verify_plan(); diag(a.diagnostic_dir); d2(a.d2_dir); load_tokenizer(a.tokenizer_dir)
        print({'frozen_sources':len(plan['source_sha256']),'gpu_calls':0,'test_episodes':0})
