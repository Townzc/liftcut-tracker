"""CPU-only feasibility of paired G1 targets; no training or GPU readiness claim."""
import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path

from controlled_recovery import CATEGORIES, config
from d2_execution import ROOT, read
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import Reply, RunBudget, encode
from liftcut_agent.model_runner import replay_model_suite, run_model_episode
from liftcut_agent.trajectories import target_tokens
from prepare_counterfactual_diagnostics import load_tokenizer
from recovery_dataset import decisions, write_rows
from server_workspace import dump_new, sha256
from state_coverage import CoverageTransport, audit_read_states, canonical_target, load_frozen, public_episode_id


class RepairTransport(CoverageTransport):
    """Execute one invalid validation before the same pending correct action."""
    def __init__(self, reads, error, scenario):
        super().__init__(reads)
        self.error, self.scenario = error, scenario
        self.repair_pending = None
        self.error_call_index = None

    def complete(self, payload):
        if self.repair_pending is not None:
            last = payload['messages'][-1]
            observation = json.loads(last['content'])
            if (last['role'] != 'tool' or not observation['ok']
                    or observation['result'] != {'valid': False, 'issues': [self.error]}):
                raise ValueError('injected validation did not produce exactly its real target error')
            self.number += 1
            data, self.repair_pending = self.repair_pending, None
        else:
            data = json.loads(super().complete(payload).body)
            action = data['choices'][0]['message']['tool_calls'][0]['function']
            if self.error_call_index is None and action['name'] == 'validate_plan':
                self.repair_pending = deepcopy(data)
                plan = json.loads(action['arguments'])['plan']
                if self.error == 'unknown_evidence':
                    invalid = 'record-' + digest(['g1-training-invalid', self.scenario['id']])[:12]
                    if invalid in {r['id'] for r in self.scenario['input']['records'] + self.scenario['memories']}:
                        raise ValueError('invalid ID collides with an actual record')
                    plan['evidence_ids'] = [*plan['evidence_ids'], invalid]
                elif self.error == 'session_count_mismatch':
                    if len(plan['sessions']) < 2:
                        raise ValueError('cannot remove exactly one training session')
                    plan['sessions'] = plan['sessions'][:-1]
                else:
                    raise ValueError('unregistered G1 error family')
                action['arguments'] = encode({'plan': plan})
                self.error_call_index = self.number - 1
        data['id'] = f'mock-{self.number}'
        data['choices'][0]['message']['tool_calls'][0]['id'] = f'mock-call-{self.number}'
        return Reply(encode(data))


def check_pairs(output, tokenizer_dir, gate_report):
    gate = read(gate_report)
    if (gate.get('version') != 'd2-results-review-v1' or not gate['model_result']
            or gate['episodes_replayed'] != 320 or not gate['g1']['any_behavior_trigger']):
        raise ValueError('complete audited D2 behavior gate required before G1 preparation')
    if output.exists():
        raise ValueError('new CPU preparation directory required')
    scenarios, factors = load_frozen()['t']
    catalog, cfg = load_catalog(ROOT / 'benchmark/catalog.json'), config()
    tokenizer, pinned = load_tokenizer(tokenizer_dir)
    pools, encoded, counts, inventories = {}, {}, Counter(), {}
    for variant in ('control', 'repair'):
        rows, episodes, checks = [], [], []
        budget = RunBudget(cfg)
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
                raise ValueError('unplanned rejected demonstration decision')
            kept = [r for r in exported if r['source_call_index'] not in reads]
            for i, row in enumerate(kept):
                row.update(pair_id=f"{scenario['id']}:{i}", format_version='g1-paired-feasibility-v1')
            rows.extend(kept)
            episodes.append(episode)
            checks.append({'scenario_id': scenario['id'], 'error_family': error if invalid is not None else None,
                           'error_context_call_index': invalid, 'context_only_read_indices': reads,
                           'positive_targets': len(kept), 'outcome': episode['trace']['score']['outcome']})
            if invalid is not None:
                counts[error] += 1
        replay = replay_model_suite(scenarios, catalog, cfg, episodes)
        tokens = [{**target_tokens(row, tokenizer, max_length=4096),
                   'source_episode_id': row['source_episode_id'], 'source_call_index': row['source_call_index']}
                  for row in rows]
        pools[variant], encoded[variant] = rows, tokens
        write_rows(output / variant / 'episodes.jsonl', episodes)
        write_rows(output / variant / 'decisions.jsonl', rows)
        write_rows(output / variant / 'tokens.jsonl', tokens)
        write_rows(output / variant / 'context-audit.jsonl', checks)
        inventories[variant] = {'replay': replay, 'scenarios': len(scenarios), 'decisions': len(rows),
            'target_tokens_one_pass': sum(t['target_tokens'] for t in tokens),
            'input_tokens_one_pass': sum(len(t['input_ids']) for t in tokens),
            'max_sequence_tokens': max(len(t['input_ids']) for t in tokens)}
    a, b = pools['control'], pools['repair']
    if len(a) != len(b) or [r['pair_id'] for r in a] != [r['pair_id'] for r in b]:
        raise ValueError('correct decision pairing changed')
    if any(canonical_target(x) != canonical_target(y) for x, y in zip(a, b)):
        raise ValueError('correct actions differ after real error history')
    targets = {arm: [t['input_ids'][t['prompt_tokens']:] for t in rows] for arm, rows in encoded.items()}
    if targets['control'] != targets['repair']:
        raise ValueError('actual correct target tokens differ')
    report = {'version': 'g1-pair-feasibility-v1', 'd2_gate_report_sha256': sha256(gate_report),
              'source_training_manifest_sha256': sha256(ROOT / 'benchmark/state-coverage-v1/manifest.json'),
              'source_sha256': {name: sha256(ROOT / name) for name in ('g1_pair_feasibility.py', 'state_coverage.py')},
              'tokenizer': pinned, 'arms': inventories, 'injected_errors': dict(sorted(counts.items())),
              'all_correct_actions_and_target_tokens_identical': True,
              'target_tokens_sha256': digest(targets['control']),
              'files': {p.relative_to(output).as_posix(): sha256(p) for p in sorted(output.rglob('*')) if p.is_file()},
              'gpu_ready': False, 'training_authorized': False, 'new_model_calls': 0, 'test_episodes': 0,
              'scope': 'CPU paired-data feasibility using existing T train-only fixtures. Needs frozen schedule, training/evaluation controller, recovery drill and budget before GPU.'}
    dump_new(output / 'report.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('output-dir', 'tokenizer-dir', 'gate-report'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    result = check_pairs(args.output_dir, args.tokenizer_dir, args.gate_report)
    print({k: result[k] for k in ('arms', 'injected_errors', 'all_correct_actions_and_target_tokens_identical', 'gpu_ready')})
