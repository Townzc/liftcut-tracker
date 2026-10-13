"""E1's unchanged two-hour experiment, optionally inside an explicit day lease."""
from datetime import timedelta
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from candidate_d import SNAPSHOT, validate
from d2_execution import aware, read, utcnow
from e1_protocol import verify_plan as scientific_plan
from i3_protocol import verify_plan as parent_plan, verify_parent_files
from liftcut_agent.interactive import digest, validate_scenarios
from liftcut_agent.benchmark import read_jsonl
from server_workspace import sha256, command

EXECUTION = ROOT / 'reports/e1-execution-v2.json'
NOT_BEFORE = '2026-10-13T15:00:00+00:00'
NEW_SOURCES = ('candidate_d.py', 'e1_protocol.py', 'prepare_e1.py', 'e1_data_use.py',
               'e1_rollout.py', 'e1_execution.py', 'gpu_e1.py', 'audit_e1.py',
               'run_e1_window.py', 'e1_setup.py', 'e1_receipt.py', 'restore_e1.py',
               'prepare_e1_execution.py', 'launch_e1.py', 'e1_power.py',
               'day_lease.py', 'gpu_telemetry.py', 'analyze_resource_usage.py')


def execution_plan():
    science = scientific_plan()
    checked = validate(read(SNAPSHOT))
    parent = parent_plan()
    sources = set(parent['source_sha256']) | set(NEW_SOURCES)
    previous = read(ROOT / 'reports/e1-execution-v1.json')
    if science != previous['protocol'] or checked['contract_digest'] != previous['candidate_digest']:
        raise ValueError('day execution cannot change E1 science or candidate')
    changed_operations = {'e1_execution.py', 'e1_power.py', 'e1_setup.py',
                          'run_e1_window.py', 'launch_e1.py', 'prepare_e1_execution.py'}
    for name, expected in previous['source_sha256'].items():
        if name not in changed_operations and sha256(ROOT / name) != expected:
            raise ValueError('day preparation changed a frozen scientific source: ' + name)
    return {'version': 'e1-execution-v2', 'protocol': science,
            'candidate_digest': checked['contract_digest'],
            'source_sha256': {n: sha256(ROOT / n) for n in sorted(sources)},
            'parent_reference': parent['reference'],
            'parent_execution_commit': '2576cd3c0913fbdac122c0b216830c16ec80c5c1',
            'no_execution_before_utc': NOT_BEFORE,
            'archive_is_self_contained': False, 'parent_weight_required': True,
            'historical_data_access': 'Legacy structural tests parse all split files. E1 is first candidate model evaluation, not a never-read secret blind dataset.',
            'historical_data_access_audit_sha256': sha256(ROOT / 'reports/e1-data-exposure-audit-v1.json'),
            'previous_execution_sha256': sha256(ROOT / 'reports/e1-execution-v1.json'),
            'scope': 'Single E1 batch; unchanged trial limits; standalone or explicitly authorized day power lease.'}


def verify_plan():
    actual = execution_plan()
    if actual != read(EXECUTION):
        raise ValueError('frozen E1 implementation differs')
    return actual


def binding(plan, commit, authorization, run_id, started):
    required = {'experiment', 'source', 'booted_at_proxy', 'maximum_minutes', 'reserve_cny',
                'hourly_cny', 'heldout_scope', 'automatic_shutdown'}
    day = authorization.get('power_lease')
    if day is not None:
        from day_lease import validate
        validate(day, aware(started))
        required = required | {'power_lease'}
        if day['booted_at_proxy'] != authorization['booted_at_proxy']:
            raise ValueError('E1 must retain the actual original day opening')
    source = 'explicit_human_new_server_day' if day is not None else 'explicit_human_new_server_window'
    if (set(authorization) != required or authorization['experiment'] != 'E1'
            or authorization['source'] != source
            or authorization['maximum_minutes'] != 120 or authorization['reserve_cny'] != 5
            or authorization['hourly_cny'] != 2.18 or authorization['automatic_shutdown'] is not True
            or authorization['heldout_scope'] != 'one_48_task_batch_with_fresh_A_and_D'):
        raise ValueError('a separately recorded explicit E1 opening is required')
    boot, start = aware(authorization['booted_at_proxy']), aware(started)
    if (boot < aware(NOT_BEFORE) or not boot <= start <= boot + timedelta(minutes=10)
            or not re.fullmatch('[0-9a-f]{40}', commit)
            or not re.fullmatch(r'\d{8}-\d{6}', run_id)):
        raise ValueError('cannot use the old night or reset a late E1 opening')
    work = min(start + timedelta(minutes=90), boot + timedelta(minutes=100))
    collect = min(work + timedelta(minutes=20), boot + timedelta(minutes=118))
    result = {'version': 'e1-window-binding-v1', 'code_commit': commit, 'run_id': run_id,
            'execution_plan_digest': digest(plan), 'protocol_digest': digest(plan['protocol']),
            'candidate_digest': plan['candidate_digest'], 'authorization': authorization,
            'booted_at_proxy': authorization['booted_at_proxy'], 'trial_started_at_utc': started,
            'work_cutoff': work.isoformat(), 'collection_cutoff': collect.isoformat(),
            'hard_cutoff': (boot + timedelta(minutes=120)).isoformat(),
            'planned_unique_tasks': 48, 'planned_episodes': 96, 'archive_is_self_contained': False}
    if day is not None:
        result.update(version='e1-day-window-binding-v1', power_lease=day,
                      power_shutdown_at_utc=day['shutdown_at_utc'])
    return result


def validate_opening(opening, plan, *, scripted=False):
    b = opening['binding']
    if (b != binding(plan, b['code_commit'], b['authorization'], b['run_id'], b['trial_started_at_utc'])
            or opening['evidence_kind'] != ('scripted_contract' if scripted else 'model')
            or not aware(b['trial_started_at_utc']) <= aware(opening['at_utc']) < aware(b['work_cutoff'])):
        raise ValueError('E1 original opening/evidence kind differs')
    return b


def verify_parent(parent, plan, receipt=None, index=None):
    return verify_parent_files(parent, plan['parent_reference'], receipt, index)


def cases_for_run(run, plan, catalog):
    meta = plan['protocol']['dataset']
    if sha256(run / 'dataset/cases.jsonl') != meta['test_file_sha256_from_existing_manifest']:
        raise ValueError('original one-shot dataset changed')
    cases = read_jsonl(run / 'dataset/cases.jsonl')
    from e1_data_use import validate_cases
    validate_cases(cases, plan['protocol'], catalog)
    b = read(run / 'opening.json')['binding']
    opened = read(run / 'dataset/data-opened.json')
    reservation = read(run / 'dataset/reservation.json')
    attempt = read(run / 'dataset/open-attempt.json')
    if (len(cases) != 48 or opened['case_count'] != 48 or opened['binding'] != b
            or reservation['version'] != 'e1-data-reservation-v1'
            or reservation['side'] != 'server' or reservation['binding'] != b
            or reservation['state'] != 'reserved_before_payload_open'
            or reservation['automatic_reset_allowed'] is not False
            or attempt['version'] != 'e1-data-open-attempt-v1'
            or attempt['binding'] != b or attempt['attempt_precedes_read'] is not True
            or attempt['automatic_reset_allowed'] is not False
            or any(x['dataset_sha256'] != opened['dataset_sha256'] for x in (reservation, attempt))
            or not aware(b['trial_started_at_utc']) <= aware(reservation['at_utc'])
                <= aware(attempt['at_utc']) == aware(opened['opened_at_utc'])
                <= aware(opened['preserved_at_utc']) < aware(b['work_cutoff'])
            or opened['payload_bytes'] != (run / 'dataset/cases.jsonl').stat().st_size
            or opened['bundles'] != sorted({c['family_id'] for c in cases})
            or opened['shared_templates_known'] is not True or opened['external_validation'] is not False
            or opened['case_order'] != [c['id'] for c in cases]
            or opened['dataset_sha256'] != meta['test_file_sha256_from_existing_manifest']
            or opened['reserved_qualification_consumed'] is not True):
        raise ValueError('original complete data-use record required')
    return cases


def verify_worker(run, commit):
    plan = verify_plan(); b = validate_opening(read(run / 'opening.json'), plan)
    if (command(['git', 'rev-parse', 'HEAD'], ROOT) != commit or b['code_commit'] != commit
            or command(['git', 'status', '--porcelain'], ROOT) or utcnow() >= aware(b['work_cutoff'])):
        raise ValueError('clean reviewed E1 worker and original work deadline required')
    return plan, b
