"""Rebuild G4 fresh paired results, preserving all gains/losses and operational scope."""
import argparse
from collections import Counter
from pathlib import Path

from analyze_d2_results import timing
from analyze_g1_results import training_description,d2_case_details
from analyze_g1_contexts import normal_pairs
from analyze_g3_results import PANELS,case_comparison
from analyze_memory_coverage import d2_choices
from counterfactual_diagnostics import load_prepared
from d2_execution import ordered_cases,read,aware
from liftcut_agent.benchmark import read_jsonl
from prepare_g3 import published_maps
from prepare_g4 import ARMS,BUDGET,G3
from publish_g4_results import publication_integrity,verify_complete
from server_workspace import dump_new,sha256


def compare(before,after):
    rows=[]
    for panel in PANELS:
        for row in case_comparison(before[panel],after[panel],panel):
            row['first_different_control_action']=row.pop('first_different_historical_control_action')
            rows.append(row)
    return {'rows':rows,'before_correct':sum(r['before_correct'] for r in rows),
            'after_correct':sum(r['after_correct'] for r in rows),
            'gained':[r['case_id'] for r in rows if r['gained']],
            'lost':[r['case_id'] for r in rows if r['lost']]}


def paired_normal(before,after):
    result=normal_pairs(before,after)
    for k in ('arms','counts'):result[k]['permuted']=result[k].pop('repair')
    for row in result['paired']:row['first_different_permuted_action']=row.pop('first_different_repair_action')
    return result


def operations(public,bind):
    events=read_jsonl(public/'operations.jsonl');server=read_jsonl(public/'server-events.jsonl',allow_empty=True)
    verified=[e for e in events if e['event']=='off_instance_verified']
    receipts=[e for e in events if e['event'] in ('receipt_atomic_published','receipt_final_observed')]
    observed=[e for e in events if e['event']=='server_receipt_observed']
    consumed=[e for e in server if e['event']=='server_receipt_consumed']
    checksum=sha256(public/'restore-receipt.json');status=read(public/'backup-copy-status.json')
    if (len(verified)!=1 or verified[0]['receipt']!=read(public/'restore-receipt.json')
            or not receipts or any(e['receipt_sha256']!=checksum for e in receipts)
            or len(observed)!=1 or observed[0]['value']!=status
            or not status['off_instance_acknowledged'] or len(consumed)>1
            or events[-1]['event']!='collector_finished'):
        raise ValueError('genuine restore/publication/server-consumption chain incomplete')
    end=aware(events[-1]['at_utc']);start=aware(bind['trial_started_at_utc']);boot=aware(bind['booted_at_proxy'])
    if not boot<=start<=end<=aware(bind['collection_cutoff']):raise ValueError('collection outside frozen trial')
    return {'trial_start_to_collection_seconds':(end-start).total_seconds(),
            'trial_start_to_collection_cost_proxy_cny':(end-start).total_seconds()*2.18/3600,
            'boot_to_collection_seconds':(end-boot).total_seconds(),
            'cumulative_cost_proxy_cny_including_prior_failed_opening':(end-boot).total_seconds()*2.18/3600+BUDGET['earlier_failed_opening_cny'],
            'do_not_add_trial_and_cumulative_costs':True,'reserve_cny':20,
            'actual_restore':verified[0],'receipt_publication':receipts,
            'server_consumption':{'verified_server_status':status,'event':consumed[0] if consumed else None},
            'power_deadline':BUDGET['power_deadline'],'server_intentionally_on':True,
            'provider_billing_stopped':False,'final_overnight_cost':False,
            'scope':'Recorded elapsed compute proxy, not provider invoice; power closure is a separate observation.'}


def review(public,prepared,diagnostic,d2,tokenizer,*,restored_run=None):
    publication_integrity(public)
    result=verify_complete(public/'run',public/'backup-index.json',public/'restore-receipt.json',
                           prepared,diagnostic,d2,tokenizer,metadata_only=True)
    if restored_run is not None:
        full=verify_complete(restored_run,public/'backup-index.json',public/'restore-receipt.json',prepared,diagnostic,d2,tokenizer)
        if full!=read(public/'run/comparison.json'):raise ValueError('full weight reconstruction differs')
    cases=ordered_cases(load_prepared(d2));episodes={};arms={}
    for arm in ARMS:
        path=public/'run/evaluation'/arm
        episodes[arm]={p:read_jsonl(path/p/'episodes.jsonl') for p in PANELS}
        maps,stops,blocked=published_maps(path)
        if stops!=result['gates']['protections'][arm]['false_stops']:raise ValueError('false stop audit differs')
        arms[arm]={'normal':result['arms'][arm]['normal']['report'],
                   'diagnostic':result['arms'][arm]['diagnostic']['report'],
                   'd2':result['arms'][arm]['d2']['report'],
                   'gate_counts':{k:{'correct':sum(v.values()),'total':len(v)} for k,v in maps.items()},
                   'false_stops':stops,'blocked_writes':blocked,
                   'memory_record_choices':d2_choices(path/'d2'),
                   **d2_case_details(cases,episodes[arm]['d2']),
                   'training':training_description(public/'run/training'/arm),
                   'resources':{p:{'tokens':result['arms'][arm][p]['tokens'],
                                    'timing':timing(read_jsonl(path/p/'generations.jsonl')),
                                    'policy_failures':dict(Counter(e['policy_failure'] for e in episodes[arm][p] if e['policy_failure']))}
                                for p in PANELS}}
    historical={p:read_jsonl(G3/'run/evaluation/stop_half'/p/'episodes.jsonl') for p in PANELS}
    return {'version':'g4-results-review-v1','binding':result['binding'],'model_result':True,
            'episodes_replayed':222,'actual_weights_rechecked_by_this_review':restored_run is not None,
            'token_ids_verified':True,'arms':arms,'gates':result['gates'],
            'paired_all111':compare(episodes['control'],episodes['permuted']),
            'paired_normal_behavior':paired_normal(episodes['control']['normal'],episodes['permuted']['normal']),
            'historical_g3_to_new_control_all111':compare(historical,episodes['control']),
            'historical_control_repeat':result['historical_control_repeat'],
            'matched_initialization':result['initial_adapter_sha256'],'operations':operations(public,result['binding']),
            'new_model_calls':0,'reserved_test_reads':0,
            'scope':'New paired seed42 control/candidate on111 reused dev states. Historical repeat reported separately; no independent generalization.'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('public-dir','prepared-dir','diagnostic-dir','d2-dir','tokenizer-dir'):p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--restored-run',type=Path);p.add_argument('--check',action='store_true');a=p.parse_args()
    result=review(a.public_dir,a.prepared_dir,a.diagnostic_dir,a.d2_dir,a.tokenizer_dir,restored_run=a.restored_run)
    if a.check:
        expected=read(a.public_dir/'review.json');expected['actual_weights_rechecked_by_this_review']=a.restored_run is not None
        if result!=expected:raise ValueError('G4 review differs')
    else:dump_new(a.public_dir/'review.json',result)
    print({'mechanism':result['gates']['mechanism_passed'],'candidate':result['gates']['candidate_passed'],
           'paired':{k:v for k,v in result['paired_all111'].items() if k!='rows'}})
