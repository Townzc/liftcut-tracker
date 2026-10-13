"""Reconstruct every I2 factorial gain/loss and separate trial/power costs."""
import argparse
from collections import Counter
import json
from pathlib import Path
from analyze_d2_results import timing
from analyze_g1_results import d2_case_details
from analyze_g4_results import compare
from analyze_memory_coverage import d2_choices
from counterfactual_diagnostics import load_prepared
from d2_execution import ordered_cases,read,aware
from i2_gates import ARMS
from liftcut_agent.benchmark import read_jsonl
from prepare_g3 import published_maps
from publish_i2_results import publication_integrity,verify_complete,verify_handoff
from server_workspace import dump_new,sha256

PANELS=('normal','diagnostic','d2')
EDGES={'N_without_R':('A','B'),'R_without_N':('A','C'),
       'N_with_R':('C','D'),'R_with_N':('B','D'),'candidate_D_vs_A':('A','D')}


def factorial(counts):
    if set(counts)!=set(ARMS) or any(type(v) is not int or not 0<=v<=111 for v in counts.values()):
        raise ValueError('four exact counts from the same111 states required')
    a,b,c,d=(counts[x] for x in ARMS)
    return {'counts':counts,'N_without_R':b-a,'R_without_N':c-a,'N_with_R':d-c,'R_with_N':d-b,
            'average_N_gain_cases':((b-a)+(d-c))/2,'average_R_gain_cases':((c-a)+(d-b))/2,
            'interaction_gain_cases':d-c-b+a,
            'scope':'Descriptive repeated-development effects, no population inference or independence claim'}


def decoded_actions(response):
    """Display actual native arguments separately from inverse-mapped arguments."""
    body=json.loads(response['body'])
    rows=[]
    for choice in body.get('choices',[]):
        message=choice.get('message',{})
        for call in message.get('tool_calls',[]):
            function=call['function'];arguments=function['arguments']
            try:arguments=json.loads(arguments)
            except (TypeError,json.JSONDecodeError):pass
            rows.append({'tool':function['name'],'arguments':arguments})
    return rows


def case_audits(directory,episodes):
    correct={r['case_id']:r['after_correct'] for r in compare(episodes,episodes)['rows']}
    rows=[]
    for panel in PANELS:
        calls=read_jsonl(directory/panel/'calls.jsonl')
        inputs=read_jsonl(directory/panel/'inputs.jsonl')
        responses=read_jsonl(directory/panel/'responses.jsonl')
        if not len(calls)==len(inputs)==len(responses):raise ValueError('incomplete native decision records')
        grouped={}
        for call,inp,response in zip(calls,inputs,responses):
            projection=inp['projection'];resolution=projection['source_resolution']
            grouped.setdefault(call['case_id'],[]).append({
                'request_number':inp['request_number'],'original_request_digest':projection['original_request_digest'],
                'projected_request_digest':projection['projected_request_digest'],
                'source_resolution':resolution,'evidence_mapping':projection['evidence_mapping'],
                'inverse_mapping_status':response['mapping']['status'],
                'native_actions':decoded_actions(response['native_response']),
                'environment_actions':decoded_actions(response['environment_response'])})
        for episode in episodes[panel]:
            case=episode.get('case_id',episode.get('scenario_id'))
            rows.append({'panel':panel,'case_id':case,'correct':correct[case],
                         'policy_failure':episode['policy_failure'],'decisions':grouped.get(case,[])})
    if len(rows)!=111:raise ValueError('every development state must be represented')
    return rows


def operations(public,bind):
    events=read_jsonl(public/'operations.jsonl');server=read_jsonl(public/'server-events.jsonl')
    verified=[e for e in events if e['event']=='off_instance_verified']
    receipts=[e for e in events if e['event'] in ('receipt_atomic_published','receipt_final_observed')]
    observed=[e for e in events if e['event']=='server_receipt_observed']
    consumed=[e for e in server if e['event']=='server_receipt_consumed']
    status=read(public/'backup-copy-status.json');checksum=sha256(public/'restore-receipt.json')
    if (len(verified)!=1 or verified[0]['receipt']!=read(public/'restore-receipt.json')
            or not receipts or any(e['receipt_sha256']!=checksum for e in receipts)
            or len(observed)!=1 or observed[0]['value']!=status
            or len(consumed)>1 or events[-1]['event']!='collector_finished'
            or events[-1]['result']['server_consumed'] is not status['off_instance_acknowledged']):
        raise ValueError('actual restore/publication/consumption chain incomplete')
    boot,start,end=(aware(x) for x in (bind['booted_at_proxy'],bind['trial_started_at_utc'],events[-1]['at_utc']))
    lease=bind['power_lease'];price=lease['hourly_cny']
    if not boot<=start<=end<=aware(bind['collection_cutoff']):raise ValueError('outside original trial deadline')
    close=read(public/'window-close.json')
    if close['power_action']!='retain_under_original_overnight_guard' or close['shutdown_at_utc']!=lease['shutdown_at_utc']:
        raise ValueError('power policy differs')
    return {'trial_start_to_collection_seconds':(end-start).total_seconds(),
        'trial_start_to_collection_cost_proxy_cny':(end-start).total_seconds()*price/3600,
        'boot_to_collection_seconds':(end-boot).total_seconds(),
        'night_cumulative_cost_proxy_cny':(end-boot).total_seconds()*price/3600,
        'do_not_add_trial_and_cumulative_costs':True,'reserve_cny':lease['reserve_cny'],
        'actual_restore':verified[0],'receipt_publication':receipts,
        'server_consumption':{'verified_server_status':status,'event':consumed[0] if consumed else None,
                              **verify_handoff(public)},
        'power_deadline':lease['shutdown_at_utc'],'server_intentionally_on':True,'provider_billing_stopped':False,
        'final_overnight_cost':False,'scope':'Elapsed compute proxy, not platform invoice; closure recorded separately.'}


def review(public,diagnostic,d2,tokenizer,*,restored_run=None):
    publication_integrity(public)
    result=verify_complete(public/'run',public/'backup-index.json',public/'restore-receipt.json',diagnostic,d2,tokenizer,metadata_only=True)
    if restored_run is not None:
        full=verify_complete(restored_run,public/'backup-index.json',public/'restore-receipt.json',diagnostic,d2,tokenizer)
        if full!=read(public/'run/comparison.json'):raise ValueError('private actual-weight replay differs')
    cases=ordered_cases(load_prepared(d2));arms={};episodes={}
    for arm in ARMS:
        directory=public/'run/evaluation'/arm
        episodes[arm]={p:read_jsonl(directory/p/'episodes.jsonl') for p in PANELS}
        maps,stops,blocked=published_maps(directory);audited=result['arms'][arm]
        arms[arm]={'gate_counts':{k:{'correct':sum(v.values()),'total':len(v)} for k,v in maps.items()},
            'false_stops':stops,'blocked_writes':blocked,'memory_record_choices':d2_choices(directory/'d2'),
            **d2_case_details(cases,episodes[arm]['d2']),
            'resources':{p:{'tokens':audited[p]['tokens'],'input_records':audited[p]['input_records'],
                'changed_requests':audited[p]['changed_requests'],
                'unknown_alias_rejections':audited[p]['unknown_alias_rejections'],
                'policy_failures':dict(Counter(e['policy_failure'] for e in episodes[arm][p] if e['policy_failure'])),
                'raw_prompt_tokens_at_same_visited_states':audited[p]['raw_prompt_tokens_at_same_visited_states'],
                'timing':timing(read_jsonl(directory/p/'generations.jsonl'))} for p in PANELS},
            'runtime_timing':{'load':read(directory/'load.json'),'finished':read(directory/'finished.json')},
            'all111_case_audits':case_audits(directory,episodes[arm])}
    edges={name:compare(episodes[a],episodes[b]) for name,(a,b) in EDGES.items()}
    counts={a:compare(episodes['A'],episodes[a])['after_correct'] for a in ARMS}
    for edge in edges.values():
        if len(edge['rows'])!=111:raise ValueError('all111 paired rows required')
    totals=lambda field:{a:sum(arms[a]['resources'][p]['tokens'][field] for p in PANELS) for a in ARMS}
    historical={p:read_jsonl(public/'run/reference/i1-view'/p/'episodes.jsonl') for p in PANELS}
    return {'version':'i2-results-review-v1','binding':result['binding'],'model_result':True,
        'system_intervention':True,'new_training':False,'episodes_replayed':444,
        'actual_weights_rechecked_by_this_review':restored_run is not None,'token_ids_verified':True,
        'projection_inputs_verified':True,'inverse_evidence_mapping_verified':True,'arms':arms,'gates':result['gates'],
        'paired_all111':edges,'factorial_all111':factorial(counts),
        'historical_I1_to_new_A_all111':compare(historical,episodes['A']),
        'historical_I1_view_repeat':result['historical_I1_view_repeat'],
        'input_costs':{'actual_generated_prompt_tokens':totals('generated_prompt_tokens'),
            'completion_tokens':totals('completion_tokens'),'actual_model_generations':totals('actual_model_generations'),
            'scope':'Fresh arm totals. Same-visited-state raw token counts are counterfactuals, not fresh baseline costs.'},
        'operations':operations(public,result['binding']),'new_model_calls':0,'reserved_test_reads':0,
        'scope':'Four fresh fixed-weight system arms on111 repeated dev states, including first decisions. No independent generalization.'}


if __name__=='__main__':
    p=argparse.ArgumentParser(allow_abbrev=False)
    for name in ('public-dir','diagnostic-dir','d2-dir','tokenizer-dir'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--restored-run',type=Path);p.add_argument('--check',action='store_true');a=p.parse_args()
    value=review(a.public_dir,a.diagnostic_dir,a.d2_dir,a.tokenizer_dir,restored_run=a.restored_run)
    if a.check:
        expected=read(a.public_dir/'review.json');expected['actual_weights_rechecked_by_this_review']=a.restored_run is not None
        if value!=expected:raise ValueError('saved I2 review differs')
    else:dump_new(a.public_dir/'review.json',value)
    print({'gates':value['gates']['candidate_passed'],'factorial':value['factorial_all111']})
