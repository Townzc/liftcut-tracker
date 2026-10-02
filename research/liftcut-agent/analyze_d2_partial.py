"""Audit the historical completed S0 arm without upgrading its partial receipt.

The v1 opening stays bound to its historical contract and original source commit.
Current v2 changes may only amend deployment/controller bookkeeping, never the
scientific parameters or evaluator. This tool does not create or upload ACKs.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

from d2_execution import ROOT, ordered_cases, read, verify_adapters, verify_plan
from audit_counterfactual_diagnostics import audit_arm, validate_opening
from counterfactual_diagnostics import VALUES, load_prepared
from prepare_counterfactual_diagnostics import load_tokenizer
from liftcut_agent.benchmark import load_catalog, read_jsonl
from d2_receipt_transfer import validate_receipt
from server_workspace import dump_new, sha256

OLD_COMMIT = '06654db287a5d51c4aad6bf57fcee40d21555afc'
AMENDED = {'d2_execution.py', 'run_counterfactual_window.py', 'drill_d2_execution.py',
           'stage_d2_execution.py', 'd2_bundle.py'}


def verify_amendment(prepared):
    old, current = read(ROOT / 'reports/d2-execution-readiness-v1.json'), verify_plan(prepared)
    if {k:v for k,v in old.items() if k != 'source_sha256'} != {k:v for k,v in current.items() if k != 'source_sha256'}:
        raise ValueError('scientific conditions differ from the historical partial run')
    changed = {name for name in old['source_sha256'].keys() | current['source_sha256'].keys()
               if old['source_sha256'].get(name) != current['source_sha256'].get(name)}
    if changed != AMENDED:
        raise ValueError('unexpected execution amendment, or unreviewed evaluator change')
    return old


def actions(case, episode):
    return [e['action'] for e in episode['trace']['events'][len(case['prefix']['trace']['events']):]
            if e['actor'] == 'agent']


def substitute(value, mapping):
    if isinstance(value, str):
        return mapping.get(value, value)
    if isinstance(value, list):
        return [substitute(v, mapping) for v in value]
    if isinstance(value, dict):
        return {k:substitute(v, mapping) for k,v in value.items()}
    return value


def describe(result, cases, episodes):
    rows = result['case_results']
    if len(rows) != 80 or [r['case_id'] for r in rows] != [c['id'] for c in cases]:
        raise ValueError('complete ordered S0 arm required')
    case_map = {c['id']:c for c in cases}
    episode_map = {e['case_id']:e for e in episodes}
    row_map = {r['case_id']:r for r in rows}
    memory = [r for r in rows if r['panel'] == 'memory']
    groups = {}
    for factor in ('position', 'invalid', 'clarification', 'rotation'):
        groups[factor] = {}
        for row in memory:
            key = str(row['factors'][factor]).lower()
            group = groups[factor].setdefault(key, {'total':0, 'correct':0, 'defer':0, 'failed_case_ids':[]})
            group['total'] += 1
            group['correct'] += row['correct']
            group['defer'] += row['defer']
            if not row['correct']:
                group['failed_case_ids'].append(row['case_id'])
    roles = Counter()
    for row in memory:
        rotation = row['factors']['rotation']
        values = VALUES[rotation:] + VALUES[:rotation]
        for member in row['member_scores']:
            selected = member.get('selected_equipment')
            matches = [role for role, value in zip(('raw_input','older_valid','latest_valid','invalid_distractor'), values)
                       if selected == [value]]
            roles[matches[0] if matches else 'other_or_no_selection'] += 1
    identities = []
    for case in cases:
        if case['panel'] != 'identity':
            continue
        old = case_map[case['paired_case_id']]
        x, y = row_map[old['id']], row_map[case['id']]
        original = actions(old, episode_map[old['id']])
        renamed = substitute(actions(case, episode_map[case['id']]), {v:k for k,v in case['identity_bijection'].items()})
        identities.append({'original':old['id'], 'renamed':case['id'], 'original_correct':x['correct'],
            'renamed_correct':y['correct'], 'score_flip':x['correct'] != y['correct'],
            'normalized_action_sequence_changed':original != renamed})
    continuations = []
    for case in cases:
        if case['panel'] in {'repair','infeasible'}:
            row, episode = row_map[case['id']], episode_map[case['id']]
            events = episode['trace']['events'][len(case['prefix']['trace']['events']):]
            continuations.append({'case_id':case['id'], 'panel':case['panel'], 'decision':row,
                'autonomous_actions':actions(case,episode), 'tool_errors':[e['observation'].get('error')
                    for e in events if e['actor'] == 'agent' and not e['observation']['ok']],
                'terminal_outcome':episode['trace']['score'].get('outcome')})
    consent = []
    for row in rows:
        if row['panel'] == 'consent':
            consent.append({'case_id':row['case_id'],'factors':row['factors'],'correct':row['correct'],
                'defer':row['defer'],'actions':actions(case_map[row['case_id']],episode_map[row['case_id']])})
    return {'memory_by_factor':groups, 'memory_member_selection_roles':dict(sorted(roles.items())),
        'identity_pairs':identities, 'consent_cases':consent, 'continuation_cases':continuations,
        'paired_treatment_effects':None,
        'g1':{'evaluated':False,'training_authorized':False,'reason':'Fixed T arm did not run; S0 cannot trigger G1'}}


def audit_partial(public, prepared, tokenizer_dir, adapters=None, *, metadata_only=False):
    plan = verify_amendment(prepared)
    run = public / 'run'
    index, receipt = read(public/'backup-index.json'), read(public/'partial-receipt.json')
    opening, status = read(run/'opening.json'), read(run/'window-status.json')
    bind = validate_opening(opening, plan)
    if bind['code_commit'] != OLD_COMMIT or status['status'] != 'partial' or index['status'] != 'partial':
        raise ValueError('this review covers only the original partial window')
    validate_receipt(json.dumps(receipt), index, bind)
    inventory = read(run/'backup-inventory.json')['files']
    expected_files = {row['path'] for row in inventory} | {'backup-inventory.json'}
    if {p.relative_to(run).as_posix() for p in run.rglob('*') if p.is_file()} != expected_files:
        raise ValueError('partial archive inventory changed')
    for row in inventory:
        p = run/row['path']
        if p.is_symlink() or p.stat().st_size != row['bytes'] or sha256(p) != row['sha256']:
            raise ValueError('partial archived bytes differ')
    if any((run/'evaluation'/arm).exists() for arm in ('t','m','tm')):
        raise ValueError('unexpected additional arm in historical S0-only run')
    if not metadata_only:
        if adapters is None:
            raise ValueError('actual adapter path required; CI must use explicit metadata mode')
        verify_adapters(adapters)
    cases = ordered_cases(load_prepared(prepared))
    tokenizer,_ = load_tokenizer(tokenizer_dir)
    result = audit_arm(run/'evaluation/s0','s0',cases,load_catalog(ROOT/'benchmark/catalog.json'),plan,bind,tokenizer)
    if read(run/'presence.json')['durable_episodes'] != 80:
        raise ValueError('archived presence denominator differs')
    episodes = read_jsonl(run/'evaluation/s0/episodes.jsonl')
    return {'version':'d2-partial-review-v1','binding':bind,'run_status':'partial',
        'episodes_replayed':80,'registered_study_cases':320,'unrun_cases':240,
        'actual_adapter_bytes_rechecked':not metadata_only,'token_ids_verified':True,
        'partial_receipt_upgraded':False,'panels':result['panels'],'tokens':result['tokens'],
        'case_results':result['case_results'],**describe(result,cases,episodes),
        'source_sha256':{'historical_plan':sha256(ROOT/'reports/d2-execution-readiness-v1.json'),
                         'archive_inventory':sha256(run/'backup-inventory.json')},
        'new_model_calls_in_review':0,'test_episodes':0,
        'scope':'Single completed S0 arm from a failed four-arm development window; no cross-arm effect or generalization estimate'}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('public-dir','prepared-dir','tokenizer-dir'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--adapters-root',type=Path)
    parser.add_argument('--metadata-only',action='store_true')
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    report=audit_partial(args.public_dir,args.prepared_dir,args.tokenizer_dir,args.adapters_root,metadata_only=args.metadata_only)
    if args.check:
        expected=read(args.public_dir/'review.json')
        if args.metadata_only:
            expected['actual_adapter_bytes_rechecked']=False
        if report != expected:
            raise ValueError('published partial review differs from native/token replay')
    else:
        dump_new(args.public_dir/'review.json',report)
    print(json.dumps({k:report[k] for k in ('episodes_replayed','unrun_cases','actual_adapter_bytes_rechecked','tokens','panels')}))
