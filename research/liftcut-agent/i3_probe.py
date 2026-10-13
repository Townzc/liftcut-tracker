"""I3 first-decision evaluation and independent original-environment replay."""
from collections import defaultdict
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from contextlib import ExitStack

from i3_cases import ROOT, fixtures
from state_coverage import config
from d2_execution import append_json, read
from counterfactual_diagnostics import run_case
from i2_rollout import ProjectedTransport, audit_projected_calls
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import RunBudget
from liftcut_agent.model_runner import RecordedTransport
from server_workspace import dump_new

ARMS=('C','D')
FILES=('episodes','calls','generations','inputs','responses')


def budget():
    return RunBudget(replace(config(),max_requests=32,max_reserved_output_tokens=32*512))


def evaluate(directory,cases,factory,arm):
    if arm not in ARMS or len(cases)!=32:
        raise ValueError('registered 32 first decisions and C/D required')
    directory.mkdir(parents=True,exist_ok=False)
    catalog=load_catalog(ROOT/'benchmark/catalog.json')
    aggregate=budget()
    with ExitStack() as stack:
        streams={n:stack.enter_context((directory/(n+'.jsonl')).open('x',encoding='utf-8',newline='\n')) for n in FILES}
        native=factory(lambda row:append_json(streams['generations'],row))
        transport=ProjectedTransport(native,arm,lambda row:append_json(streams['inputs'],row),
                                     lambda row:append_json(streams['responses'],row))
        for case in cases:
            episode=run_case(case,catalog,transport,aggregate)
            append_json(streams['episodes'],episode)
            calls=episode['calls'][episode['scripted_prefix_calls']:]
            if len(calls)>1:raise ValueError('more than one first-decision request')
            for call in calls:append_json(streams['calls'],{'case_id':case['id'],'call':call})
            transport.advance()


def audit_arm(directory,cases,tokenizer,arm):
    episodes=read_jsonl(directory/'episodes.jsonl')
    if len(episodes)!=32 or len(cases)!=32 or [e['case_id'] for e in episodes]!=[c['id'] for c in cases]:
        raise ValueError('case order or denominator changed')
    catalog=load_catalog(ROOT/'benchmark/catalog.json');aggregate=budget();expected_calls=[]
    for case,episode in zip(cases,episodes):
        calls=episode['calls'][episode['scripted_prefix_calls']:]
        if len(calls)>1:raise ValueError('first-decision budget exceeded')
        replay=run_case(case,catalog,RecordedTransport(calls),aggregate)
        if replay!=episode:raise ValueError('I3 original-environment replay differs')
        expected_calls += [{'case_id':case['id'],'call':call} for call in calls]
    calls=read_jsonl(directory/'calls.jsonl')
    if calls!=expected_calls:raise ValueError('saved first-decision calls differ')
    inputs=read_jsonl(directory/'inputs.jsonl');generations=read_jsonl(directory/'generations.jsonl')
    responses=read_jsonl(directory/'responses.jsonl')
    native=audit_projected_calls([row['call'] for row in calls],generations,inputs,responses,tokenizer,arm)
    by_case={row['case_id']:(inp,gen,resp) for row,inp,gen,resp in zip(calls,inputs,generations,responses)}
    if len(by_case)!=len(calls):raise ValueError('duplicate first-decision call')
    rows=[];groups=defaultdict(list)
    for case,episode in zip(cases,episodes):
        inp,gen,resp=by_case.get(case['id'],(None,None,None))
        if inp is not None and case['id'] in str(inp['model_request']):raise ValueError('fixture identity leaked to model')
        row={'case_id':case['id'],'anchor_case_id':case['anchor_case_id'],'factors':case['factors'],
             'decision':episode['decision'],'policy_failure':episode['policy_failure'],
             'actual_input_digest':digest(inp['model_request']) if inp else None,
             'actual_output_token_digest':digest(gen['output_ids']) if gen and gen['model_called'] else None,
             'native_response':resp['native_response'] if resp else None,
             'environment_response':resp['environment_response'] if resp else None,
             'inverse_mapping_status':resp['mapping']['status'] if resp else None}
        groups[case['factors']['anchor_index']].append(row);rows.append(row)
    if len(groups)!=8 or any(len(v)!=4 for v in groups.values()):raise ValueError('eight complete four-codebook groups required')
    group_rows=[]
    for anchor,items in sorted(groups.items()):
        group_rows.append({'anchor_index':anchor,'case_ids':[x['case_id'] for x in items],
            'correct':sum(x['decision']['correct'] for x in items),
            'score_flip':len({x['decision']['correct'] for x in items})>1,
            'all_generated':all(x['actual_output_token_digest'] is not None for x in items),
            'distinct_actual_inputs':len({x['actual_input_digest'] for x in items if x['actual_input_digest'] is not None}),
            'distinct_actual_output_tokens':len({x['actual_output_token_digest'] for x in items if x['actual_output_token_digest'] is not None})})
    return {'episodes_replayed':32,'correct':sum(e['decision']['correct'] for e in episodes),
        'autonomous_blocked_writes':sum(e['decision']['autonomous_blocked_writes'] for e in episodes),
        'unique_projected_inputs':len({row['actual_input_digest'] for row in rows if row['actual_input_digest'] is not None}),
        'identity_score_flip_groups':sum(g['score_flip'] for g in group_rows),
        'codebook_groups':group_rows,'rows':rows,'native':native}


def compare(arms):
    c,d=arms['C'],arms['D']
    if len(c['rows'])!=32 or len(d['rows'])!=32:raise ValueError('paired denominator changed')
    gains=[];losses=[];pairs=[]
    for before,after in zip(c['rows'],d['rows']):
        if before['case_id']!=after['case_id']:raise ValueError('unpaired ID variants')
        a,b=before['decision']['correct'],after['decision']['correct']
        if b and not a:gains.append(after['case_id'])
        if a and not b:losses.append(after['case_id'])
        pairs.append({'case_id':after['case_id'],'C_correct':a,'D_correct':b})
    gates={'D_all32_correct':d['correct']==32,'D_zero_score_flip_groups':d['identity_score_flip_groups']==0,
           'D_no_blocked_write':d['autonomous_blocked_writes']==0,
           'D_no_unknown_alias_rejection':d['native']['unknown_alias_rejections']==0,
           'D_all32_actual_generations':d['native']['tokens']['actual_model_generations']==32}
    return {'gained':gains,'lost':losses,'rows':pairs,'gates':gates,'diagnostic_passed':all(gates.values()),
        'preselected_candidate':'D','new_deployment_qualification':False,
        'scope':'Eight reused development anchors and four irrelevant ID mappings, not independent tasks or generalization.'}
