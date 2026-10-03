"""Conditional I1 input projection and dual audit; not imported by G4 workers.

The simulator and saved policy calls retain raw observations. A separate record
contains the exact request passed to the native transport. This system intervention
does not change model weights or establish independent generalization.
"""
from contextlib import ExitStack
from copy import deepcopy

from audit_controlled import audit_generations
from audit_coverage_tokens import audit_calls
from coverage_rollout import normal_report
from d2_execution import append_json, ordered_cases, read
from g2_rollout import PANELS, run_panels
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.trajectories import normalize_messages
from memory_view import project
from prepare_g2 import ROOT
from state_coverage import original
import counterfactual_diagnostics as d2
import state_diagnostics as diagnostic

ARMS = ('raw', 'view')


def projected_record(payload, arm, number):
    if arm not in ARMS or type(number) is not int or number < 1:
        raise ValueError('registered arm and positive request number required')
    if arm == 'view':
        actual, proof = project(payload)
    else:
        actual = deepcopy(payload)
        proof = {'version': 'identity-memory-view-v1',
                 'original_request_digest': digest(payload),
                 'projected_request_digest': digest(actual), 'changes': [],
                 'hidden_state_read': False}
    return {'version': 'i1-input-record-v1', 'arm': arm, 'request_number': number,
            'original_request': deepcopy(payload), 'model_request': actual,
            'projection': proof}


class ProjectedTransport:
    def __init__(self, inner, arm, on_input):
        if arm not in ARMS:
            raise ValueError('unregistered projection arm')
        self.inner, self.arm, self.on_input, self.number = inner, arm, on_input, 0

    def complete(self, payload):
        self.number += 1
        row = projected_record(payload, self.arm, self.number)
        # Log before generation: an interrupted attempt remains explicitly partial.
        self.on_input(deepcopy(row))
        return self.inner.complete(row['model_request'])

    def advance(self):
        if hasattr(self.inner, 'advance'):
            self.inner.advance()


def run_projected_panels(output, diagnostic_dir, d2_dir, transport_factory, arm):
    """Factory receives only panel and generation callback, never evaluation truth."""
    if arm not in ARMS:
        raise ValueError('unregistered projection arm')
    with ExitStack() as stack:
        def factory(panel, on_generation):
            stream = stack.enter_context((output / panel / 'inputs.jsonl').open(
                'x', encoding='utf-8', newline='\n'))
            return ProjectedTransport(transport_factory(panel, on_generation), arm,
                                      lambda row: append_json(stream, row))
        return run_panels(output, diagnostic_dir, d2_dir, factory)


def audit_projected_calls(calls, generations, inputs, tokenizer, arm):
    if len(calls) != len(inputs):
        raise ValueError('every original policy call needs exactly one input record')
    actual_calls, raw_lengths, changed = [], [], 0
    for number, (call, saved) in enumerate(zip(calls, inputs), 1):
        expected = projected_record(call['request'], arm, number)
        if saved != expected:
            raise ValueError('saved model input differs from public deterministic projection')
        actual_calls.append({**call, 'request': saved['model_request']})
        raw_lengths.append(len(tokenizer.apply_chat_template(
            normalize_messages(call['request']['messages']), tools=call['request']['tools'],
            tokenize=True, add_generation_prompt=True)))
        changed += bool(saved['projection']['changes'])
    # Native responses/actions must agree with output IDs on the original trace.
    # Token accounting must agree with the *actual projected* model request.
    audit_generations(calls, generations)
    tokens = audit_calls(actual_calls, generations, tokenizer)
    return {'tokens': tokens, 'input_records': len(inputs), 'changed_requests': changed,
            'input_records_digest': digest(inputs),
            'raw_prompt_tokens_at_same_visited_states': sum(raw_lengths),
            'raw_lengths_digest': digest(raw_lengths),
            'raw_token_count_is_not_a_fresh_raw_arm_measurement': True}


def audit_projected_panels(directory, diagnostic_dir, d2_dir, tokenizer, arm):
    """Replay the original environment, then reconstruct and tokenize model views."""
    catalog = load_catalog(ROOT / 'benchmark/catalog.json')
    reports = {}
    for panel in PANELS:
        path = directory / panel
        episodes = read_jsonl(path / 'episodes.jsonl')
        if panel == 'normal':
            result = normal_report(original('dev'), catalog, episodes)
            calls = [{'case_id': e['scenario_id'], 'call': c} for e in episodes for c in e['calls']]
        else:
            module = diagnostic if panel == 'diagnostic' else d2
            cases = module.load_prepared(diagnostic_dir if panel == 'diagnostic' else d2_dir)
            if panel == 'd2':
                cases = ordered_cases(cases)
            result = {**module.summary(cases, episodes),
                      'replay': module.replay(cases, catalog, episodes)}
            calls = [{'case_id': e['case_id'], 'call': c} for e in episodes
                     for c in e['calls'][e['scripted_prefix_calls']:]]
        if result != read(path / 'report.json') or calls != read_jsonl(path / 'calls.jsonl'):
            raise ValueError('I1 original report/calls differ from native/environment replay')
        verification = audit_projected_calls([r['call'] for r in calls],
            read_jsonl(path / 'generations.jsonl'), read_jsonl(path / 'inputs.jsonl'), tokenizer, arm)
        if panel == 'd2':
            result['results'] = [{'case_id': e['case_id'], 'panel': c['panel'], **e['decision']}
                                 for c, e in zip(cases, episodes)]
        reports[panel] = {'report': result, **verification}
    return reports
