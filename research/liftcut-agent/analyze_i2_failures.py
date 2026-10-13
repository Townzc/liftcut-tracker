"""Post-hoc source/ID observations from complete actual I2 inputs and outputs."""
import argparse
from collections import Counter
from pathlib import Path

from analyze_i1_failures import tool_results
from d2_execution import read
from i2_gates import ARMS
from i2_view import aliases,alias_payload
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from publish_i2_results import publication_integrity
from server_workspace import dump_new,sha256


def classify(selected,raw,latest,effective,member_count):
    if member_count!=1:return 'no_single_valid_plan_member'
    if effective is not None and selected==effective:return 'effective_value_selected_but_other_requirement_failed'
    if latest is not None and selected==latest:return 'latest_memory_value_selected_but_other_requirement_failed'
    if selected==raw:return 'raw_context_value_selected'
    return 'other_value_or_action'


def canonical_public_ids(payload):
    # Reuse only public-content ID normalization, never a hidden desired action.
    return alias_payload(payload,aliases(payload))


def generation_pair(left,right):
    called=left['model_called'] and right['model_called']
    return {'both_model_called':called,
        'prompt_token_counts':[left['prompt_tokens'],right['prompt_tokens']],
        'generated_token_counts':[len(left['output_ids']),len(right['output_ids'])],
        'actual_output_ids_identical':left['output_ids']==right['output_ids'] if called else None,
        'native_raw_text_identical':left['raw_text']==right['raw_text'] if called else None}


def build(public):
    publication_integrity(public)
    review=read(public/'review.json')
    if (not review['model_result'] or review['episodes_replayed']!=444
            or not review['projection_inputs_verified'] or not review['inverse_evidence_mapping_verified']
            or review['new_training']):raise ValueError('complete actual I2 review required')
    arms={}
    for arm in ARMS:
        directory=public/'run/evaluation'/arm/'d2'
        episodes=read_jsonl(directory/'episodes.jsonl');calls=read_jsonl(directory/'calls.jsonl')
        inputs=read_jsonl(directory/'inputs.jsonl');responses=read_jsonl(directory/'responses.jsonl')
        generations=read_jsonl(directory/'generations.jsonl')
        if not len(calls)==len(inputs)==len(responses)==len(generations):raise ValueError('native call/input/response/generation alignment required')
        by_case={}
        by_generation={}
        for call,row,response,generation in zip(calls,inputs,responses,generations):
            if call['call']['request']!=row['original_request']:raise ValueError('input differs from actual call')
            by_case.setdefault(call['case_id'],[]).append((row,response))
            by_generation.setdefault(call['case_id'],[]).append(generation)
        failures=[]
        for episode in episodes:
            case=episode['case_id']
            if not case.startswith(('d2-memory-','d2-identity-')):continue
            if len(by_case[case])!=1:raise ValueError('one real first-decision request required')
            if episode['decision']['correct']:continue
            row,response=by_case[case][0];visible=tool_results(row['model_request'])
            context=visible['get_context'];memories=visible['get_memories']['memories']
            values=[m['value'] for m in memories if m['field']=='equipment']
            if len(values)!=1:raise ValueError('one latest valid equipment memory expected')
            members=episode['decision']['member_scores']
            selected=members[0].get('selected_equipment') if len(members)==1 else None
            raw=context['input']['constraints']['equipment']
            effective=context.get('effective_constraints',{}).get('equipment')
            failures.append({'case_id':case,'selected_equipment':selected,'raw_context_equipment':raw,
                'latest_visible_memory_equipment':values[0],'effective_equipment':effective,
                'source_resolution':row['projection']['source_resolution'],
                'visible_memory_ids':[m['id'] for m in memories],
                'inverse_mapping_status':response['mapping']['status'],
                'policy_failure':episode['policy_failure'],'member_scores':members,
                'classification':classify(selected,raw,values[0],effective,len(members)),
                'actual_projected_input_digest':digest(row['model_request'])})
        pairs=[]
        for pair in review['arms'][arm]['identity_pairs']:
            left,right=(by_case[pair[key]][0][0]['model_request'] for key in ('original','renamed'))
            same_semantics=canonical_public_ids(left)==canonical_public_ids(right)
            pairs.append({**pair,'actual_projected_inputs_identical':left==right,
                'public_content_equal_after_ID_normalization':same_semantics,
                'original_input_digest':digest(left),'renamed_input_digest':digest(right),
                'generation_comparison':generation_pair(by_generation[pair['original']][0],by_generation[pair['renamed']][0])})
        arms[arm]={'failures':failures,'failure_classes':dict(Counter(x['classification'] for x in failures)),
            'identity_pairs':pairs,'identity_score_flips':sum(p['score_flip'] for p in pairs),
            'identical_actual_ID_pair_inputs':sum(p['actual_projected_inputs_identical'] for p in pairs),
            'semantic_ID_pair_matches':sum(p['public_content_equal_after_ID_normalization'] for p in pairs)}
    return {'version':'i2-failure-localization-v1','post_hoc':True,'new_model_calls':0,'reserved_test_reads':0,
        'review_sha256':sha256(public/'review.json'),'arms':arms,
        'caution':'Value matches are observations, not proof of internal reasoning. R changes both the structured source view and an instruction. These reused development states do not establish independent generalization.'}


if __name__=='__main__':
    p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('--public-dir',type=Path,required=True)
    p.add_argument('--check',action='store_true');a=p.parse_args();value=build(a.public_dir)
    path=a.public_dir/'failure-localization.json'
    if a.check:
        if value!=read(path):raise ValueError('I2 localization differs')
    else:dump_new(path,value)
    print({arm:{k:v for k,v in row.items() if k not in ('failures','identity_pairs')} for arm,row in value['arms'].items()})
