"""Rebuild I1 system effects, all paired cases, safeguards and actual input costs."""
import argparse
from pathlib import Path
from analyze_d2_results import timing
from analyze_g1_results import d2_case_details
from analyze_g4_results import compare, operations
from analyze_memory_coverage import d2_choices
from counterfactual_diagnostics import load_prepared
from d2_execution import ordered_cases, read
from i1_gates import ARMS
from liftcut_agent.benchmark import read_jsonl
from prepare_g3 import published_maps
from publish_i1_results import publication_integrity, verify_complete
from server_workspace import dump_new

PANELS=('normal','diagnostic','d2')


def review(public,diagnostic,d2,tokenizer,*,restored_run=None):
    publication_integrity(public)
    result=verify_complete(public/'run',public/'backup-index.json',public/'restore-receipt.json',diagnostic,d2,tokenizer,metadata_only=True)
    if restored_run is not None:
        full=verify_complete(restored_run,public/'backup-index.json',public/'restore-receipt.json',diagnostic,d2,tokenizer)
        if full!=read(public/'run/comparison.json'):raise ValueError('full I1 restoration differs')
    cases=ordered_cases(load_prepared(d2));arms={};episodes={}
    for arm in ARMS:
        directory=public/'run/evaluation'/arm
        episodes[arm]={p:read_jsonl(directory/p/'episodes.jsonl') for p in PANELS}
        maps,stops,blocked=published_maps(directory)
        audited=result['arms'][arm]
        arms[arm]={'gate_counts':{k:{'correct':sum(v.values()),'total':len(v)} for k,v in maps.items()},
                   'false_stops':stops,'blocked_writes':blocked,
                   'memory_record_choices':d2_choices(directory/'d2'),
                   **d2_case_details(cases,episodes[arm]['d2']),
                   'panels':audited,
                   'runtime_timing':{'load':read(directory/'load.json'),'finished':read(directory/'finished.json')},
                   'resources':{p:{'tokens':audited[p]['tokens'],
                                   'input_records':audited[p]['input_records'],
                                   'changed_requests':audited[p]['changed_requests'],
                                   'raw_prompt_tokens_at_same_visited_states':audited[p]['raw_prompt_tokens_at_same_visited_states'],
                                   'timing':timing(read_jsonl(directory/p/'generations.jsonl'))} for p in PANELS}}
    def total(arm,field):return sum(arms[arm]['resources'][p]['tokens'][field] for p in PANELS)
    inputs={arm:total(arm,'generated_prompt_tokens') for arm in ARMS}
    outputs={arm:total(arm,'completion_tokens') for arm in ARMS}
    generations={arm:total(arm,'actual_model_generations') for arm in ARMS}
    historical={p:read_jsonl(public/'run/reference/g4-control'/p/'episodes.jsonl') for p in PANELS}
    return {'version':'i1-results-review-v1','binding':result['binding'],'model_result':True,
            'system_intervention':True,'new_training':False,'episodes_replayed':222,
            'actual_weights_rechecked_by_this_review':restored_run is not None,
            'token_ids_verified':True,'projection_inputs_verified':True,'arms':arms,'gates':result['gates'],
            'paired_all111':compare(episodes['raw'],episodes['view']),
            'historical_G4_to_new_raw_all111':compare(historical,episodes['raw']),
            'historical_G4_repeat':result['historical_G4_repeat'],
            'input_costs':{'actual_generated_prompt_tokens':inputs,'completion_tokens':outputs,
                          'actual_model_generations':generations,'raw_minus_view_prompt_tokens':inputs['raw']-inputs['view'],
                          'prompt_reduction_fraction':(inputs['raw']-inputs['view'])/inputs['raw'],
                          'scope':'Fresh arm totals; changed trajectories can change total calls. Same-state raw counterfactual counts are reported separately, not substituted for new raw.'},
            'operations':operations(public,result['binding']),
            'new_model_calls':0,'reserved_test_reads':0,
            'scope':'Same fixed checkpoint, fresh raw/view SYSTEM comparison on111 reused dev states; not learned memory selection or independent generalization.'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('public-dir','diagnostic-dir','d2-dir','tokenizer-dir'):p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--restored-run',type=Path);p.add_argument('--check',action='store_true');a=p.parse_args()
    result=review(a.public_dir,a.diagnostic_dir,a.d2_dir,a.tokenizer_dir,restored_run=a.restored_run)
    if a.check:
        expected=read(a.public_dir/'review.json');expected['actual_weights_rechecked_by_this_review']=a.restored_run is not None
        if result!=expected:raise ValueError('I1 review differs')
    else:dump_new(a.public_dir/'review.json',result)
    print({'mechanism':result['gates']['mechanism_passed'],'candidate':result['gates']['candidate_passed'],
           'paired':{k:v for k,v in result['paired_all111'].items() if k!='rows'}})
