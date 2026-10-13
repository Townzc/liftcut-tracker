"""I3 fixed ID-nuisance preregistration, explicit parent-weight dependency."""
from datetime import timedelta
from pathlib import Path
import re

from i3_cases import ROOT, CODEBOOKS, fixtures
from i3_probe import ARMS
from i2_protocol import verify_plan as verify_i2, verify_adapter
from d2_execution import aware, read, utcnow, PARSER, PRECISION
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.interactive import digest
from server_workspace import sha256, command
from state_coverage import config

PARENT_COMMIT='acbba44cb16dce519823f2277206a8cdf3fcfca6'
REFERENCE=ROOT/'reports/i3-reference-v1.json'
EXECUTION=ROOT/'reports/i3-execution-v1.json'
NEW_SOURCES=('i3_cases.py','i3_probe.py','i3_protocol.py','prepare_i3.py','gpu_i3.py',
             'audit_i3.py','run_i3_window.py','restore_i3.py','i3_receipt.py','launch_i3.py',
             'publish_i2_results.py','inspect_i2_receipt.py')
BUDGET={'setup_minutes':10,'work_minutes':20,'collection_minutes':20,'hard_minutes':45,
        'new_training':False,'paid_api_calls':0,'heldout_tasks':0,'automatic_reboot':False,'disk_expansion':False}


def prepare_reference(public,restored,diagnostic,d2,tokenizer):
    from publish_i2_results import publication_integrity, verify_complete, verify_handoff
    publication_integrity(public)
    result=verify_complete(restored/'parts/evidence',public/'backup-index.json',public/'restore-receipt.json',
                           diagnostic,d2,tokenizer)
    if result!=read(restored/'independent-audit.json') or not result['gates']['candidate_passed']:
        raise ValueError('actual complete I2 candidate trigger required')
    handoff=verify_handoff(public)
    return {'version':'i3-reference-v1','parent':'I2','parent_execution':PARENT_COMMIT,
        'parent_receipt_sha256':sha256(public/'restore-receipt.json'),
        'parent_index_digest':digest(read(public/'backup-index.json')),
        'parent_comparison_digest':digest(result),'parent_candidate_passed':True,
        'parent_handoff_digest':digest(handoff),
        'cases_digest':digest(fixtures(d2,load_catalog(ROOT/'benchmark/catalog.json'))),
        'checkpoint':verify_i2()['reference']['checkpoint'],
        'selection':'unchanged_preselected_G4_control_and_I2_candidate_D',
        'weight_dependency':'actual_off_instance_I2_reference/final_required',
        'archive_is_self_contained':False,'reserved_test_reads':0}


def validate_reference(reference):
    if (reference['version']!='i3-reference-v1' or reference['parent']!='I2'
            or reference['parent_execution']!=PARENT_COMMIT or reference['parent_candidate_passed'] is not True
            or reference['checkpoint']!=verify_i2()['reference']['checkpoint']
            or reference['selection']!='unchanged_preselected_G4_control_and_I2_candidate_D'
            or reference['weight_dependency']!='actual_off_instance_I2_reference/final_required'
            or reference['archive_is_self_contained'] is not False or reference['reserved_test_reads']!=0):
        raise ValueError('I3 parent selection differs')
    for key in ('parent_receipt_sha256','parent_index_digest','parent_comparison_digest','parent_handoff_digest','cases_digest'):
        if not re.fullmatch('[0-9a-f]{64}',reference[key]):raise ValueError('parent provenance digest required')
    return reference


def execution_plan(reference):
    parent=verify_i2();sources=set(parent['source_sha256'])|set(NEW_SOURCES)
    return {'version':'i3-execution-v1','reference':validate_reference(reference),
        'source_sha256':{n:sha256(ROOT/n) for n in sorted(sources)},
        'parent_i2_source_sha256':parent['source_sha256'],
        'catalog_sha256':sha256(ROOT/'benchmark/catalog.json'),
        'arms':list(ARMS),'preselected_candidate':'D','episodes_per_arm':32,'total_episodes':64,'business_anchors':8,
        'selection':{'panel':'memory','position':'first','invalid':'unconfirmed','all_rotations_and_clarifications':True},
        'codebooks':list(CODEBOOKS),'record_order':'original','budget':BUDGET,
        'config':config().manifest()['config'],'parser':PARSER,'precision':PRECISION,
        'gates':{'D_correct':32,'D_score_flip_groups':0,'D_autonomous_blocked_writes':0,
                 'D_unknown_alias_rejections':0,'D_actual_generations':32},
        'new_training':False,'test_episodes':0,'archive_is_self_contained':False,
        'scope':'Development ID nuisance diagnostic; repeated D inputs, no new deployment qualification.'}


def verify_plan():
    plan=execution_plan(read(REFERENCE))
    if plan!=read(EXECUTION):raise ValueError('I3 frozen source/protocol differs')
    return plan


def prepared_cases(d2,plan):
    from prepare_counterfactual_diagnostics import verify_prepared
    verify_prepared(d2)
    if sha256(ROOT/'benchmark/catalog.json')!=plan['catalog_sha256']:raise ValueError('catalog changed')
    cases=fixtures(d2,load_catalog(ROOT/'benchmark/catalog.json'))
    if digest(cases)!=plan['reference']['cases_digest']:raise ValueError('frozen ID variants differ')
    return cases


def binding(plan,commit,lease,started):
    from research_lease import validate
    start=aware(started);end=validate(lease,start)
    if not re.fullmatch('[0-9a-f]{40}',commit):raise ValueError('exact commit required')
    work=start+timedelta(minutes=20);collect=work+timedelta(minutes=20);hard=start+timedelta(minutes=45)
    if hard>end-timedelta(minutes=lease['final_collection_buffer_minutes']):
        raise TimeoutError('I3 cannot fit original overnight computation boundary')
    return {'version':'i3-window-binding-v1','execution_plan_digest':digest(plan),
        'code_commit':commit,'reference_digest':digest(plan['reference']),'power_lease':lease,
        'booted_at_proxy':lease['booted_at_proxy'],'trial_started_at_utc':started,
        'work_cutoff':work.isoformat(),'collection_cutoff':collect.isoformat(),'hard_cutoff':hard.isoformat(),
        'archive_is_self_contained':False,'new_training':False,'test_episodes':0}


def validate_opening(opening,plan,*,scripted=False):
    b=opening['binding'];kind='scripted_contract' if scripted else 'model'
    if (b!=binding(plan,b['code_commit'],b['power_lease'],b['trial_started_at_utc'])
            or opening['evidence_kind']!=kind or opening['budget']!=BUDGET
            or not aware(b['trial_started_at_utc'])<=aware(opening['at_utc'])<aware(b['work_cutoff'])):
        raise ValueError('I3 original actual opening differs')
    return b


def verify_worker(run,commit):
    plan=verify_plan();b=validate_opening(read(run/'opening.json'),plan)
    if (command(['git','rev-parse','HEAD'],ROOT)!=commit or b['code_commit']!=commit
            or command(['git','status','--porcelain'],ROOT) or utcnow()>=aware(b['work_cutoff'])):
        raise ValueError('I3 worker requires exact clean commit and original work cutoff')
    return plan,b


def verify_parent_files(parent,reference,receipt_path=None,index_path=None):
    """Read actual existing I2 adapter bytes; metadata-only is never sufficient."""
    if (receipt_path is None)!=(index_path is None):raise ValueError('paired local parent metadata paths required')
    receipt_path=receipt_path or parent/'off-instance-backup.json';index_path=index_path or parent/'backup-index.json'
    if (sha256(receipt_path)!=reference['parent_receipt_sha256']
            or digest(read(index_path))!=reference['parent_index_digest']
            or digest(read(parent/'comparison.json'))!=reference['parent_comparison_digest']):
        raise ValueError('I2 parent evidence differs')
    return verify_adapter(parent/'reference/final',reference['checkpoint'])
