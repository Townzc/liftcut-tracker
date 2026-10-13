"""I3 original-state/token replay with explicit verified external parent weights."""
import argparse
from pathlib import Path
from d2_execution import read,aware,expected_runtime
from i3_protocol import verify_plan,validate_opening,prepared_cases,verify_parent_files,ARMS
from i3_probe import audit_arm,compare
from liftcut_agent.benchmark import read_jsonl
from prepare_counterfactual_diagnostics import load_tokenizer
from server_workspace import dump_new


def audit(run,d2,tokenizer_dir,parent=None,receipt_path=None,index_path=None,*,scripted=False,plan=None,metadata_only=False):
    if plan is None:plan=verify_plan()
    elif not scripted:raise ValueError('real I3 requires frozen plan')
    b=validate_opening(read(run/'opening.json'),plan,scripted=scripted)
    cases=prepared_cases(d2,plan)
    if cases!=read_jsonl(run/'cases.jsonl') or read(run/'reference.json')!=plan['reference']:
        raise ValueError('I3 cases or external-reference binding differs')
    if not metadata_only:
        if parent is None:raise ValueError('actual parent weight location required')
        weights=verify_parent_files(parent,plan['reference'],receipt_path,index_path)
    else:
        weights=None
    tokenizer,_=load_tokenizer(tokenizer_dir);reports={}
    for arm in ARMS:
        folder=run/'evaluation'/arm
        if read(folder/'manifest.json')!={'binding':b,'arm':arm,'config':plan['config']}:
            raise ValueError('registered I3 arm differs')
        load,finish=read(folder/'load.json'),read(folder/'finished.json')
        if (load['binding']!=b or finish['binding']!=b or load['arm']!=arm or finish['arm']!=arm
                or load['runtime']!=({'scripted_contract':True} if scripted else expected_runtime())
                or not aware(b['trial_started_at_utc'])<=aware(load['at_utc'])<=aware(finish['at_utc'])<=aware(b['work_cutoff'])
                or finish['new_training'] is not False
                or not 0<=finish['inference_wall_seconds']<=finish['total_wall_seconds_including_load']):
            raise ValueError('I3 actual timing/runtime differs')
        reports[arm]=audit_arm(folder/'decisions',cases,tokenizer,arm)
    return {'version':'i3-audit-v1','binding':b,'evidence_kind':'scripted_contract' if scripted else 'model',
        'model_result':not scripted,'episodes_replayed':64,'business_anchors':8,
        'actual_external_weight_verified':not metadata_only,'external_weights':weights,
        'archive_is_self_contained':False,'external_reference_digest':b['reference_digest'],
        'arms':reports,'comparison':compare(reports),'new_training':False,'test_episodes':0,
        'token_ids_verified':True,'projection_inputs_verified':True,'inverse_mapping_verified':True}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('run-dir','d2-dir','tokenizer-dir','output'):p.add_argument('--'+n,type=Path,required=True)
    for n in ('parent-run','parent-receipt','parent-index'):p.add_argument('--'+n,type=Path)
    p.add_argument('--metadata-only',action='store_true');a=p.parse_args()
    result=audit(a.run_dir,a.d2_dir,a.tokenizer_dir,a.parent_run,a.parent_receipt,a.parent_index,metadata_only=a.metadata_only)
    dump_new(a.output,result)
    print({k:result[k] for k in ('episodes_replayed','actual_external_weight_verified','archive_is_self_contained')})
