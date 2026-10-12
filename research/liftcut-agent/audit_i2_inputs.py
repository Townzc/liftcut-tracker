"""Offline counterfactual I2 input checks on SAVED I1 states, never new model results."""
import argparse
from pathlib import Path

from d2_execution import read
from i2_protocol import ROOT
from i2_view import ARMS, project
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.trajectories import normalize_messages
from prepare_counterfactual_diagnostics import load_tokenizer
from server_workspace import dump_new, sha256


def build(tokenizer_dir):
    public=ROOT/'reports/i1-seed42-2026-10-03'
    tokenizer,_=load_tokenizer(tokenizer_dir)
    counts={a:[] for a in ARMS}; by_case={}; source_hashes={}; projections={a:[] for a in ARMS}
    for panel in ('normal','diagnostic','d2'):
        path=public/'run/evaluation/view'/panel/'calls.jsonl'
        source_hashes[panel]=sha256(path)
        for row in read_jsonl(path):
            payload=row['call']['request']
            by_case.setdefault(row['case_id'],[]).append(payload)
            for arm in ARMS:
                actual,proof=project(payload,arm)
                ids=tokenizer.apply_chat_template(normalize_messages(actual['messages']),tools=actual['tools'],
                                                  tokenize=True,add_generation_prompt=True)
                if len(ids)+512>4096:raise ValueError('I2 saved-state input exceeds fixed context')
                counts[arm].append(len(ids));projections[arm].append(digest(actual))
    pairs=[]
    for pair in read(public/'review.json')['arms']['view']['identity_pairs']:
        left,right=(by_case[pair[k]] for k in ('original','renamed'))
        if len(left)!=1 or len(right)!=1:raise ValueError('single-decision ID pairs required')
        equal={a:project(left[0],a)[0]==project(right[0],a)[0] for a in ARMS}
        if equal!={'A':False,'B':True,'C':False,'D':True}:raise ValueError('I2 ID-pair invariance failed')
        pairs.append({'original':pair['original'],'renamed':pair['renamed'],'projected_inputs_equal':equal})
    if len(pairs)!=12 or len(by_case)!=111:raise ValueError('saved-state coverage differs')
    failures=[]
    for row in read(public/'failure-localization.json')['failures']:
        payload=by_case[row['case_id']][0]
        proof=project(payload,'C')[1]['source_resolution']
        if proof['effective_constraints']['equipment']!=row['visible_memory_equipment']:
            raise ValueError('source resolution differs from public latest-valid observation')
        failures.append({'case_id':row['case_id'],'historical_classification':row['classification'],
            'public_effective_equipment':proof['effective_constraints']['equipment'],
            'source_kind':proof['fields']['equipment']['kind'],'new_model_success':'unmeasured'})
    return {'version':'i2-saved-state-input-audit-v1','model_result':False,'new_model_calls':0,
        'test_episodes':0,'saved_I1_states':len(by_case),'saved_I1_requests':len(counts['A']),
        'source_calls_sha256':source_hashes,
        'arms':{a:{'same_visited_states_prompt_tokens':sum(v),'max_prompt_tokens':max(v),
                  'completion_allowance':512,'projection_digest':digest(projections[a])} for a,v in counts.items()},
        'identity_pairs':pairs,'prior_failures_public_resolution':failures,
        'scope':'Counterfactual token/semantic audit of saved I1 paths, NOT fresh I2 paths, cost, accuracy or latency'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--tokenizer-dir',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--check',action='store_true');a=p.parse_args();result=build(a.tokenizer_dir)
    if a.check:
        if read(a.output)!=result:raise ValueError('saved I2 input audit differs')
    else:dump_new(a.output,result)
    print({'states':result['saved_I1_states'],'ID_pairs':len(result['identity_pairs']),'arms':result['arms'],'model_calls':0})
