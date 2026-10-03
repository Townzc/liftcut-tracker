"""Train-only record-order coverage, keeping every memory value and target fixed.

Preparation is independent of any candidate selection or GPU authorization.
The only scenario intervention is permutation of the existing three memories.
Both clean and repair demonstrations execute the real environment again.
"""
from collections import Counter, defaultdict
from copy import deepcopy
from itertools import permutations
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from analyze_memory_coverage import arrangement
from controlled_recovery import CATEGORIES, config
from g1_pair_feasibility import RepairTransport
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest, resolved_inputs
from liftcut_agent.model_policy import RunBudget
from liftcut_agent.model_runner import replay_model_suite, run_model_episode
from liftcut_agent.trajectories import target_tokens
from prepare_counterfactual_diagnostics import load_tokenizer
from recovery_dataset import decisions, write_rows
from server_workspace import dump_new, sha256
from state_coverage import CoverageTransport, audit_read_states, load_frozen, public_episode_id


def verify_only_memory_order(before, after):
    if ({k:v for k,v in before.items() if k != 'messages'}
            != {k:v for k,v in after.items() if k != 'messages'}
            or len(before['messages']) != len(after['messages'])):
        raise ValueError('decision metadata or message count changed')
    calls = {}
    for a,b in zip(before['messages'],after['messages']):
        for call in a.get('tool_calls',[]):
            calls[call['id']] = call['function']['name']
        if a == b:
            continue
        if (a['role'] != 'tool' or b['role'] != 'tool'
                or {k:v for k,v in a.items() if k != 'content'} != {k:v for k,v in b.items() if k != 'content'}
                or calls.get(a['tool_call_id']) != 'get_memories'):
            raise ValueError('non-memory message changed')
        aa,bb = (json.loads(x['content']) for x in (a,b))
        for content in (aa,bb):
            content['result']['memories'].sort(key=lambda m:m['id'])
        if aa != bb:
            raise ValueError('memory contents changed beyond list order')


def permuted_fixtures():
    scenarios, factors = load_frozen()['t']
    original = {s['id']: s for s in scenarios}
    result = deepcopy(scenarios)
    strata = defaultdict(list)
    for row in result:
        if row['memories']:
            shape = arrangement(row['memories'], row['as_of'])['order']
            kind = 'U' if 'U' in shape else 'X'
            strata[(row['category'], kind)].append(row)
    if len(strata) != 4 or any(len(v) != 8 for v in strata.values()):
        raise ValueError('expected32 memory scenarios in four train-only strata')
    assignments = []
    for stratum_index, ((category, kind), rows) in enumerate(sorted(strata.items())):
        # All six positions per invalid-kind/category stratum, then two extras.
        # Extras rotate across strata; neither dev cases nor model outputs select them.
        orders = [''.join(p) for p in permutations('VO' + kind)]
        orders.sort(key=lambda p: (p.index('V'), p))
        extras = [orders[(stratum_index * 2 + i) % 6] for i in range(2)]
        assigned = orders + extras
        ordered = sorted(rows, key=lambda s: digest(['memory-order-coverage-v1', 42, s['id']]))
        for row, order in zip(ordered, assigned):
            before = original[row['id']]
            old_order = arrangement(row['memories'], row['as_of'])['order']
            by_role = dict(zip(old_order, row['memories']))
            row['memories'] = [by_role[role] for role in order]
            if (sorted(row['memories'], key=lambda m: m['id']) != sorted(before['memories'], key=lambda m: m['id'])
                    or public_episode_id(row) != public_episode_id(before)
                    or resolved_inputs(row['input'], row['memories'], row['as_of'])
                    != resolved_inputs(before['input'], before['memories'], before['as_of'])):
                raise ValueError('permutation changed task semantics or public identity')
            assignments.append({'scenario_id': row['id'], 'category': category,
                                'invalid_kind': kind, 'before': old_order, 'after': order})
    return result, factors, sorted(assignments, key=lambda r: r['scenario_id'])


def build(output, reference_pool, tokenizer_dir):
    if output.exists():
        raise ValueError('new permutation output required')
    scenarios, factors, assignments = permuted_fixtures()
    catalog, cfg = load_catalog(ROOT / 'benchmark/catalog.json'), config()
    tokenizer, pinned = load_tokenizer(tokenizer_dir)
    summaries = {}
    for variant in ('control', 'repair'):
        rows, episodes, checks = [], [], []
        budget = RunBudget(cfg)
        references = read_jsonl(reference_pool / variant / 'decisions.jsonl')
        reference_tokens = read_jsonl(reference_pool / variant / 'tokens.jsonl')
        for scenario, factor in zip(scenarios, factors):
            group = int(scenario['family_id'].rsplit('-', 1)[1])
            error = ('unknown_evidence', 'session_count_mismatch')[(group + CATEGORIES.index(scenario['category'])) % 2]
            transport = (CoverageTransport(factor['read_sequence']) if variant == 'control'
                         else RepairTransport(factor['read_sequence'], error, scenario))
            episode = run_model_episode(scenario, catalog, cfg, transport, budget, episode_id=public_episode_id(scenario))
            exported, rejected = decisions([scenario], [episode], variant)
            reads = transport.injected_call_indices
            audit_read_states(scenario, episode, reads, catalog)
            invalid = transport.error_call_index if variant == 'repair' else None
            if [r['call_index'] for r in rejected] != ([] if invalid is None else [invalid]):
                raise ValueError('unexpected rejected demonstration decision')
            kept = [r for r in exported if r['source_call_index'] not in reads]
            for i, row in enumerate(kept):
                row.update(pair_id=f"{scenario['id']}:{i}", format_version='g1-paired-feasibility-v1')
            rows.extend(kept)
            episodes.append(episode)
            checks.append({'scenario_id':scenario['id'],'error_context_call_index':invalid,
                           'context_only_read_indices':reads,'positive_targets':len(kept)})
        replay = replay_model_suite(scenarios, catalog, cfg, episodes)
        encoded = [{**target_tokens(r, tokenizer, max_length=4096),
                    'source_episode_id':r['source_episode_id'], 'source_call_index':r['source_call_index']} for r in rows]
        if len(rows) != 504 or [r['pair_id'] for r in rows] != [r['pair_id'] for r in references]:
            raise ValueError('all504 target identities must remain paired')
        if any(a['input_ids'][a['prompt_tokens']:] != b['input_ids'][b['prompt_tokens']:]
               for a,b in zip(encoded,reference_tokens)):
            raise ValueError('permutation changed supervised target token sequence')
        changed = [i for i,(a,b) in enumerate(zip(rows,references)) if a != b]
        assignments_by_id = {r['scenario_id']:r for r in assignments}
        for i in changed:
            if rows[i]['scenario_id'] not in assignments_by_id:
                raise ValueError('non-memory context changed')
            verify_only_memory_order(references[i], rows[i])
        for name,data in [('scenarios',scenarios),('episodes',episodes),('decisions',rows),
                          ('tokens',encoded),('context-audit',checks)]:
            write_rows(output / variant / (name+'.jsonl'), data)
        summaries[variant] = {'replay':replay,'changed_decision_indices':changed,
                              'supervised_tokens':sum(t['target_tokens'] for t in encoded),
                              'input_tokens':sum(len(t['input_ids']) for t in encoded),
                              'max_sequence_tokens':max(len(t['input_ids']) for t in encoded)}
    write_rows(output / 'assignments.jsonl',assignments)
    report={'version':'memory-order-coverage-v1','tokenizer':pinned,'variants':summaries,
            'arrangements':dict(sorted(Counter(r['after'] for r in assignments).items())),
            'memory_scenarios':len(assignments),'new_model_calls':0,'reserved_test_reads':0,
            'all_target_tokens_unchanged':True,
            'files':{p.relative_to(output).as_posix():sha256(p) for p in sorted(output.rglob('*')) if p.is_file()}}
    dump_new(output/'report.json',report)
    return report


if __name__ == '__main__':
    import argparse
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for name in ('output-dir','reference-pool','tokenizer-dir'):
        p.add_argument('--'+name,required=True,type=Path)
    args=p.parse_args()
    result=build(args.output_dir,args.reference_pool,args.tokenizer_dir)
    print({k:result[k] for k in ('memory_scenarios','arrangements','all_target_tokens_unchanged')})
