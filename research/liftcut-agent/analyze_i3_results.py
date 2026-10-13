"""All I3 nuisance pairs, failure strata and costs; no independent-task claims."""
import argparse
from collections import Counter
from pathlib import Path
from d2_execution import read,aware
from publish_i3_results import publication_integrity,verify_complete,verify_handoff
from server_workspace import dump_new


def describe(result):
    arms={}
    for name,arm in result['arms'].items():
        strata={}
        for factor in ('codebook','rotation','clarification','anchor_index'):
            values={}
            for row in arm['rows']:
                # Original D2 names are preserved; no result-driven regrouping.
                key=str(row['factors'].get(factor,'unavailable'))
                v=values.setdefault(key,{'n':0,'correct':0,'failed_cases':[]})
                v['n']+=1;v['correct']+=int(row['decision']['correct'])
                if not row['decision']['correct']:v['failed_cases'].append(row['case_id'])
            strata[factor]=values
        failures=[]
        for row in arm['rows']:
            if not row['decision']['correct']:
                failures.append({k:row[k] for k in ('case_id','anchor_case_id','factors','decision','policy_failure',
                    'actual_input_digest','actual_output_token_digest','native_response','environment_response','inverse_mapping_status')})
        arms[name]={'correct':arm['correct'],'n':32,'unique_projected_inputs':arm['unique_projected_inputs'],
            'identity_score_flip_groups':arm['identity_score_flip_groups'],'strata':strata,'failures':failures,
            'groups':arm['codebook_groups'],'actual_tokens':arm['native']['tokens'],
            'same_state_counterfactual_raw_prompt_tokens':arm['native']['raw_prompt_tokens_at_same_visited_states'],
            'counterfactual_is_not_fresh_raw_measurement':True,
            'unknown_alias_rejections':arm['native']['unknown_alias_rejections'],
            'blocked_writes':arm['autonomous_blocked_writes']}
    return {'arms':arms,'paired':result['comparison'],
            'D_deterministic_within_identical_input_groups':all(g['distinct_actual_inputs']==1 and g['distinct_actual_output_tokens']==1
                and g['all_generated'] for g in result['arms']['D']['codebook_groups']),
            'new_training':False,'independent_generalization':False,'business_anchors':8,'decisions':64,
            'scope':'Eight reused development anchors; D has eight unique inputs repeated four times. Not 64 independent tasks.'}


def review(public,d2,tokenizer):
    manifest=publication_integrity(public);handoff=verify_handoff(public)
    if manifest['handoff']!=handoff:raise ValueError('published I3 handoff summary differs')
    result=verify_complete(public/'run',public/'backup-index.json',public/'restore-receipt.json',d2,tokenizer,metadata_only=True)
    report=describe(result);b=result['binding'];lease=b['power_lease'];end=aware(handoff['collector_finished_at_utc'])
    trial=(end-aware(b['trial_started_at_utc'])).total_seconds();night=(end-aware(lease['booted_at_proxy'])).total_seconds()
    if min(trial,night)<0:raise ValueError('invalid measured I3 interval')
    report.update(version='i3-review-v1',model_result=True,handoff=handoff,binding=b,
        publication_actual_parent_weight_verified=manifest['actual_parent_weight_verified_at_publication'],
        this_review_reloads_private_parent_weight=False,archive_is_self_contained=False,
        cost={'hourly_cny':lease['hourly_cny'],'trial_seconds':trial,'trial_cny_proxy':trial/3600*lease['hourly_cny'],
              'night_seconds':night,'night_cny_proxy':night/3600*lease['hourly_cny'],
              'night_includes_trial_do_not_add':True,'not_provider_invoice':True,'original_shutdown_at_utc':lease['shutdown_at_utc']})
    for arm in ('C','D'):
        finish=read(public/'run/evaluation'/arm/'finished.json')
        report['arms'][arm]['inference_wall_seconds']=finish['inference_wall_seconds']
        report['arms'][arm]['total_wall_seconds_including_load']=finish['total_wall_seconds_including_load']
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('public-dir','d2-dir','tokenizer-dir'):p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--check',action='store_true');a=p.parse_args();r=review(a.public_dir,a.d2_dir,a.tokenizer_dir)
    path=a.public_dir/'review.json'
    if a.check:
        if read(path)!=r:raise ValueError('I3 review differs')
    else:dump_new(path,r)
    print({'C':r['arms']['C']['correct'],'D':r['arms']['D']['correct'],'diagnostic_passed':r['paired']['diagnostic_passed']})
