"""Freeze fresh control versus memory-order coverage under the selected G3 half recipe."""
import argparse
from pathlib import Path
import shutil
import sys

ROOT=Path(__file__).resolve().parent
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from d2_execution import read
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from memory_order_coverage import build as build_permuted, verify_only_memory_order
from prepare_g3 import schedules as g3_schedules, verify_prepared as verify_g3
from server_workspace import dump_new, sha256

ARMS=('control','permuted')
REVIEWED=ROOT/'reports/g4-preparation-v1.json'
G3=ROOT/'reports/g3-seed42-2026-10-03'
GATES={'memory_min':32,'memory_net_min':8,'position_min':8,'identity_min':7,
       'normal_correct':12,'main_memory_min':6,'old_consent_correct':10,
       'd2_consent_correct':12,'repair_correct':4,'infeasible_correct':4,
       'false_infeasible_max':0,'unapproved_attempts_max':0}
BUDGET={'continuous_lease':True,'instance_boot':'2026-10-03T05:35:00.409447+00:00',
        'power_deadline':'2026-10-03T14:00:00+00:00','work_latest':'2026-10-03T11:45:00+00:00',
        'collection_latest':'2026-10-03T12:30:00+00:00','work_minutes':120,'collection_minutes':45,
        'minimum_work_minutes_at_launch':95,'hourly_cny':2.18,'cumulative_reserve_cny':20,
        'earlier_failed_opening_cny':0.3630052281944445,'reboot':False,'storage_expansion':False}


def schedules(prepared):
    base,tokens,pools=g3_schedules(prepared/'reference')
    report=read(prepared/'permuted/report.json')
    actual={p.relative_to(prepared/'permuted').as_posix() for p in (prepared/'permuted').rglob('*') if p.is_file()}
    if actual != set(report['files'])|{'report.json'}:
        raise ValueError('permuted pool inventory differs')
    for name,value in report['files'].items():
        if sha256(prepared/'permuted'/name)!=value:raise ValueError('permuted pool bytes differ')
    for variant in ('control','repair'):
        rows=read_jsonl(prepared/'permuted'/variant/'decisions.jsonl')
        encoded=read_jsonl(prepared/'permuted'/variant/'tokens.jsonl')
        if len(rows)!=504 or len(encoded)!=504:raise ValueError('all504 decisions required')
        for old,new,a,b in zip(pools[variant],rows,tokens[variant],encoded):
            verify_only_memory_order(old,new)
            if a['input_ids'][a['prompt_tokens']:]!=b['input_ids'][b['prompt_tokens']:]:
                raise ValueError('target token sequence changed')
        pools['permuted_'+variant]=rows;tokens['permuted_'+variant]=encoded
    control=base['stop_half']
    changed=[{'variant':('permuted_'+x['variant'] if x['variant'] in ('control','repair') else x['variant']),
              'index':x['index']} for x in control]
    return {'control':control,'permuted':changed},tokens,pools


def build_report(prepared):
    review=read(G3/'review.json')
    if (review['episodes_replayed']!=222 or not review['actual_weights_rechecked_by_this_review']
            or review['carried_forward']!='stop_half' or not review['gates']['stop_half']['mechanism_passed']
            or review['gates']['stop_half']['candidate_passed']):
        raise ValueError('complete G3 half-mechanism-only result required')
    reference=verify_g3(prepared/'reference')
    schedule,tokens,pools=schedules(prepared)
    arms={}
    for arm,items in schedule.items():
        rows=[tokens[x['variant']][x['index']] for x in items]
        arms[arm]={'decisions':len(rows),'optimizer_steps':len(rows)//8,
                   'supervised_tokens':sum(x['target_tokens'] for x in rows),
                   'input_tokens':sum(len(x['input_ids']) for x in rows),
                   'max_sequence_tokens':max(len(x['input_ids']) for x in rows),
                   'target_schedule_sha256':digest([x['input_ids'][x['prompt_tokens']:] for x in rows]),
                   'sample_order_sha256':digest([pools[x['variant']][x['index']]['pair_id'] for x in items])}
    for key in ('decisions','optimizer_steps','supervised_tokens','target_schedule_sha256','sample_order_sha256'):
        if arms['control'][key]!=arms['permuted'][key] or arms['control'][key]!=reference['arms']['stop_half'][key]:
            raise ValueError('G4 changed G3 half target budget or order')
    changed=[]
    for offset,(a,b) in enumerate(zip(schedule['control'],schedule['permuted'])):
        if tokens[a['variant']][a['index']]['input_ids']!=tokens[b['variant']][b['index']]['input_ids']:
            changed.append(offset)
    if not changed or any(schedule['control'][i]['variant']=='stop' for i in changed):
        raise ValueError('memory intervention absent or modified stopping pool')
    return {'version':'g4-preparation-v1','seed':42,'arms':arms,'gates':GATES,'budget':BUDGET,
            'changed_exposure_offsets':changed,'memory_coverage':read(prepared/'permuted/report.json'),
            'g3_review_sha256':sha256(G3/'review.json'),
            'g3_control_log_sha256':sha256(G3/'run/training/stop_half/training.jsonl'),
            'fresh_complete_control_required':True,'model':reference['model'],'training':reference['training'],
            'evaluation':{'normal_per_arm':12,'diagnostic_per_arm':19,'d2_per_arm':80,'total_episodes':222},
            'files':{p.relative_to(prepared).as_posix():sha256(p) for p in sorted(prepared.rglob('*')) if p.is_file()},
            'source_sha256':{n:sha256(ROOT/n) for n in ('prepare_g4.py','memory_order_coverage.py')},
            'new_model_calls':0,'test_episodes':0,'scope':'Fresh seed42 paired training, reused development states only.'}


def verify_prepared(prepared):
    actual=build_report(prepared)
    if actual!=read(REVIEWED):raise ValueError('G4 preparation differs from frozen design')
    return actual


def arm_binding(plan,commit,arm):
    if arm not in ARMS:raise ValueError('unknown G4 arm')
    return {'version':'g4-arm-binding-v1','plan_digest':digest(plan),'code_commit':commit,
            'arm':arm,'seed':42,'test_episodes':0}


def prepare(output,reference,tokenizer):
    verify_g3(reference)
    if output.exists():raise ValueError('new G4 prepared destination required')
    output.mkdir(parents=True)
    shutil.copytree(reference,output/'reference')
    build_permuted(output/'permuted',output/'reference/pool',tokenizer)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--output-dir',required=True,type=Path)
    p.add_argument('--reference-dir',type=Path)
    p.add_argument('--tokenizer-dir',type=Path)
    p.add_argument('--verify-only',action='store_true')
    p.add_argument('--write-initial-report',action='store_true')
    a=p.parse_args()
    if not a.verify_only:
        if not a.reference_dir or not a.tokenizer_dir:p.error('reference and tokenizer required')
        prepare(a.output_dir,a.reference_dir,a.tokenizer_dir)
    if a.write_initial_report:
        result=build_report(a.output_dir);dump_new(REVIEWED,result)
    else:result=verify_prepared(a.output_dir)
    print({'arms':result['arms'],'changed_exposures':len(result['changed_exposure_offsets'])})
