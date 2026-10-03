"""I1 fixed-weight inference contract. A real restored G4 failure is prerequisite."""
from datetime import timedelta
from pathlib import Path
import re

from audit_g2 import adapter_bytes
from d2_execution import ROOT, PARSER, PRECISION, aware, read, utcnow
from g4_execution import verify_live_lease
from i1_gates import ARMS, GATES
from liftcut_agent.interactive import digest
from server_workspace import command, sha256
from state_coverage import config

G4_COMMIT = '10a729eb0f8f55ba9d1b6888f5d6cdb9ac88fd28'
EXECUTION = ROOT / 'reports/i1-execution-v1.json'
REFERENCE = ROOT / 'reports/i1-reference-v1.json'
G4_EXECUTION = read(ROOT / 'reports/g4-execution-v1.json')
BUDGET = {**G4_EXECUTION['budget'], 'work_minutes': 50, 'collection_minutes': 30,
          'work_latest': '2026-10-03T13:00:00+00:00',
          'collection_latest': '2026-10-03T13:15:00+00:00',
          'minimum_work_minutes_at_launch': 35, 'minimum_collection_minutes_at_launch': 20}
NEW_SOURCES = ('i1_protocol.py', 'i1_gates.py', 'memory_view.py', 'i1_rollout.py',
               'gpu_i1.py', 'audit_i1.py', 'run_i1_window.py', 'i1_receipt_transfer.py',
               'restore_i1.py', 'launch_i1_overnight.py', 'drill_i1.py')
SOURCES = tuple(sorted(set(G4_EXECUTION['source_sha256']) | set(NEW_SOURCES)))


def reference_from_restored(restored, index_path, prepared, diagnostic, d2, tokenizer):
    """Never choose an adapter by its observed score, or accept a partial drill."""
    from audit_g4 import audit
    from g4_receipt_transfer import validate_receipt
    index = read(index_path)
    bind = index['binding']
    if index['status'] != 'complete' or bind['code_commit'] != G4_COMMIT:
        raise ValueError('actual fixed G4 complete experiment required')
    receipt_path = restored / 'off-instance-backup.json'
    receipt = validate_receipt(receipt_path.read_bytes(), index, bind)
    if not receipt['model_result'] or not receipt['adapter_files_verified']:
        raise ValueError('real complete G4 restoration receipt required')
    run = restored / 'run'
    result = audit(run, prepared, diagnostic, d2, tokenizer)
    if (result != read(run / 'comparison.json') or result != read(restored / 'independent-audit.json')
            or result['binding'] != bind or result['gates']['candidate_passed'] is not False):
        raise ValueError('actual audited G4 candidate failure must trigger I1')
    trained = read(run / 'training/control/report.json')
    return {'version': 'i1-fixed-reference-v1', 'model_result': True,
            'g4_code_commit': G4_COMMIT, 'g4_binding': bind,
            'g4_index_digest': digest(index), 'g4_restore_receipt_sha256': sha256(receipt_path),
            'g4_comparison_digest': digest(result), 'g4_candidate_passed': False,
            'g4_episodes_replayed': 222, 'selection': 'preselected_G4_new_control',
            'adapter_sha256': trained['adapter_sha256'],
            'adapter_bytes': adapter_bytes(run / 'training/control/final/adapter_model.safetensors'),
            'control_evaluation_sha256': {
                f'{panel}/{name}.jsonl': sha256(run / 'evaluation/control' / panel / f'{name}.jsonl')
                for panel in ('normal', 'diagnostic', 'd2') for name in ('episodes', 'calls', 'generations')},
            'model': G4_EXECUTION['preparation']['model'], 'test_episodes': 0}


def validate_reference(reference, *, scripted=False):
    if (reference['version'] != 'i1-fixed-reference-v1'
            or reference['model_result'] is not (not scripted)
            or reference['g4_code_commit'] != G4_COMMIT
            or reference['g4_binding']['code_commit'] != G4_COMMIT
            or reference['g4_binding']['seed'] != 42 or reference['g4_binding']['test_episodes'] != 0
            or reference['g4_candidate_passed'] is not False
            or reference['selection'] != 'preselected_G4_new_control'
            or reference['g4_episodes_replayed'] != 222 or reference['test_episodes'] != 0
            or reference['model'] != G4_EXECUTION['preparation']['model']
            or set(reference['adapter_sha256']) != {'adapter_config.json', 'adapter_model.safetensors'}):
        raise ValueError('I1 needs a fixed, actually restored G4 control and failure trigger')
    for name in ('g4_index_digest', 'g4_restore_receipt_sha256', 'g4_comparison_digest'):
        if not re.fullmatch(r'[0-9a-f]{64}', reference[name]):
            raise ValueError('missing G4 provenance digest')
    if reference['adapter_bytes']['sha256'] != reference['adapter_sha256']['adapter_model.safetensors']:
        raise ValueError('fixed adapter evidence mismatch')
    files = reference['control_evaluation_sha256']
    expected = {f'{panel}/{name}.jsonl' for panel in ('normal', 'diagnostic', 'd2')
                for name in ('episodes', 'calls', 'generations')}
    if set(files) != expected or any(not re.fullmatch(r'[0-9a-f]{64}', value) for value in files.values()):
        raise ValueError('complete original G4 control reference inventory required')
    return reference


def execution_plan(reference, *, scripted=False):
    return {'version': 'i1-execution-v1', 'reference': validate_reference(reference, scripted=scripted),
            'source_sha256': {name: sha256(ROOT / name) for name in SOURCES},
            'gates': GATES, 'budget': BUDGET, 'config': config().manifest()['config'],
            'parser': PARSER, 'precision': PRECISION,
            'lease_configuration_digest': G4_EXECUTION['lease_configuration_digest'],
            'phases': ['evaluate-raw', 'evaluate-view', 'audit'], 'test_episodes': 0,
            'new_training': False, 'evidence_kind': 'scripted_contract' if scripted else 'model'}


def verify_plan():
    plan = execution_plan(read(REFERENCE))
    if plan != read(EXECUTION):
        raise ValueError('I1 frozen source/reference/configuration differs')
    return plan


def deadlines(started, now, *, launching=True):
    start = aware(started)
    if now.utcoffset() is None or not aware(BUDGET['instance_boot']) <= start <= now:
        raise ValueError('original boot and aware actual trial start required')
    work = min(start + timedelta(minutes=BUDGET['work_minutes']), aware(BUDGET['work_latest']))
    collect = min(work + timedelta(minutes=BUDGET['collection_minutes']), aware(BUDGET['collection_latest']))
    if launching and ((now-start).total_seconds() > 60 or
                      (work-now).total_seconds() < 60 * BUDGET['minimum_work_minutes_at_launch']
                      or (collect-work).total_seconds() < 60 * BUDGET['minimum_collection_minutes_at_launch']):
        raise TimeoutError('insufficient original lease for a fresh I1 trial')
    if not work < collect < aware(BUDGET['power_deadline']):
        raise ValueError('I1 work/collection must end before original power guard')
    return work, collect


def binding(plan, commit, started):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('exact execution commit required')
    work, collect = deadlines(started, aware(started))
    return {'version': 'i1-window-binding-v1', 'code_commit': commit,
            'execution_plan_digest': digest(plan), 'reference_digest': digest(plan['reference']),
            'booted_at_proxy': BUDGET['instance_boot'], 'trial_started_at_utc': started,
            'work_cutoff': work.isoformat(), 'collection_cutoff': collect.isoformat(),
            'hard_cutoff': BUDGET['power_deadline'], 'test_episodes': 0, 'new_training': False}


def validate_opening(opening, plan, *, scripted=False):
    expected = binding(plan, opening['binding']['code_commit'], opening['trial_started_at_utc'])
    if (opening['binding'] != expected or opening['budget'] != BUDGET
            or opening['evidence_kind'] != ('scripted_contract' if scripted else 'model')
            or opening['booted_at_proxy'] != BUDGET['instance_boot']
            or opening['lease_configuration_digest'] != plan['lease_configuration_digest']):
        raise ValueError('I1 opening differs from frozen continuous lease')
    deadlines(opening['trial_started_at_utc'], aware(opening['started_at_utc']))
    return expected


def verify_adapter(directory, reference):
    for name, value in reference['adapter_sha256'].items():
        if sha256(directory / name) != value:
            raise ValueError('I1 must use the preselected G4 control bytes unchanged')
    actual = adapter_bytes(directory / 'adapter_model.safetensors')
    if actual != reference['adapter_bytes']:
        raise ValueError('I1 actual safetensor container differs')
    return actual


def manifest_for(bind, plan, arm, *, scripted=False):
    if arm not in ARMS:
        raise ValueError('unknown I1 arm')
    return {'version': 'i1-evaluation-v1', 'binding': bind, 'arm': arm,
            'evidence_kind': 'scripted_contract' if scripted else 'model',
            'reference_digest': digest(plan['reference']),
            'adapter_sha256': plan['reference']['adapter_sha256'], 'config': plan['config'],
            'parser': plan['parser'], 'precision': plan['precision'],
            'system_projection': arm == 'view', 'test_episodes': 0, 'new_training': False}


def verify_worker(run, commit):
    plan = verify_plan()
    bind = validate_opening(read(run / 'opening.json'), plan)
    if (command(['git', 'rev-parse', 'HEAD'], ROOT) != commit or bind['code_commit'] != commit
            or command(['git', 'status', '--porcelain'], ROOT)):
        raise ValueError('clean exact I1 execution checkout required')
    if utcnow() >= aware(bind['work_cutoff']):
        raise TimeoutError('original I1 compute cutoff reached')
    verify_live_lease(plan)
    verify_adapter(run / 'reference/final', plan['reference'])
    return plan, bind


if __name__ == '__main__':
    import argparse
    from server_workspace import dump_new
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('create-reference', 'freeze', 'verify'):
        p.add_argument('--' + name, action='store_true')
    for name in ('g4-restored', 'g4-index', 'g4-prepared', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        p.add_argument('--' + name, type=Path)
    args = p.parse_args()
    if sum((args.create_reference, args.freeze, args.verify)) != 1:
        p.error('select exactly one reference/freeze/verification action')
    if args.create_reference:
        reference = reference_from_restored(args.g4_restored, args.g4_index, args.g4_prepared,
                                           args.diagnostic_dir, args.d2_dir, args.tokenizer_dir)
        dump_new(REFERENCE, reference)
        print({'real_G4_failure_verified': True, 'checkpoint_selection': reference['selection'], 'gpu_calls': 0})
    elif args.freeze:
        plan = execution_plan(read(REFERENCE))
        dump_new(EXECUTION, plan)
        print({'frozen_sources': len(plan['source_sha256']), 'gpu_calls': 0})
    else:
        from prepare_state_diagnostics import verify_prepared as verify_diagnostic
        from prepare_counterfactual_diagnostics import verify_prepared as verify_d2, load_tokenizer
        plan = verify_plan()
        verify_diagnostic(args.diagnostic_dir)
        verify_d2(args.d2_dir)
        load_tokenizer(args.tokenizer_dir)
        print({'frozen_sources': len(plan['source_sha256']), 'gpu_calls': 0})
