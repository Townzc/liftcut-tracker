"""I2 dual records: actual native request/reply and original-environment execution."""
from contextlib import ExitStack
from copy import deepcopy
from dataclasses import asdict

from audit_controlled import audit_generations
from audit_coverage_tokens import audit_calls
from coverage_rollout import normal_report
from d2_execution import append_json, ordered_cases, read
from g2_rollout import PANELS, run_panels
from i2_view import ARMS, project, restore_reply
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import Reply
from liftcut_agent.trajectories import normalize_messages
from prepare_g2 import ROOT
from state_coverage import original
import counterfactual_diagnostics as d2
import state_diagnostics as diagnostic


def input_record(payload, arm, number):
    if type(number) is not int or number < 1:
        raise ValueError('positive request number required')
    actual, proof = project(payload, arm)
    return {'version': 'i2-input-v1', 'arm': arm, 'request_number': number,
            'original_request': deepcopy(payload), 'model_request': actual, 'projection': proof}


class ProjectedTransport:
    def __init__(self, inner, arm, on_input, on_response):
        if arm not in ARMS:
            raise ValueError('unregistered arm')
        self.inner, self.arm = inner, arm
        self.on_input, self.on_response, self.number = on_input, on_response, 0

    def complete(self, payload):
        self.number += 1
        record = input_record(payload, self.arm, self.number)
        self.on_input(deepcopy(record))
        reply = self.inner.complete(record['model_request'])
        actual, proof = restore_reply(reply, record['projection'])
        self.on_response({'version': 'i2-response-v1', 'request_number': self.number,
                          'native_response': asdict(reply), 'environment_response': asdict(actual),
                          'mapping': proof})
        return actual

    def advance(self):
        if hasattr(self.inner, 'advance'):
            self.inner.advance()


def run_projected_panels(output, diagnostic_dir, d2_dir, factory, arm):
    with ExitStack() as stack:
        def transport(panel, on_generation):
            streams = {name: stack.enter_context((output/panel/(name+'.jsonl')).open(
                'x', encoding='utf-8', newline='\n')) for name in ('inputs', 'responses')}
            return ProjectedTransport(factory(panel, on_generation), arm,
                lambda row: append_json(streams['inputs'], row),
                lambda row: append_json(streams['responses'], row))
        return run_panels(output, diagnostic_dir, d2_dir, transport)


def audit_projected_calls(calls, generations, inputs, responses, tokenizer, arm):
    if not len(calls) == len(generations) == len(inputs) == len(responses):
        raise ValueError('every completed native request needs input and reverse-mapping records')
    native_calls, raw_lengths, rejects = [], [], 0
    for number, (call, saved, response) in enumerate(zip(calls, inputs, responses), 1):
        expected = input_record(call['request'], arm, number)
        if expected != saved or response['request_number'] != number or response['version'] != 'i2-response-v1':
            raise ValueError('public projection or response ordering differs')
        reply = Reply(**response['native_response'])
        decoded, mapping = restore_reply(reply, expected['projection'])
        if (asdict(decoded) != response['environment_response'] or mapping != response['mapping']
                or asdict(decoded) != call['response']):
            raise ValueError('ID inverse mapping or original environment response differs')
        native_calls.append({**call, 'request': saved['model_request'], 'response': asdict(reply)})
        raw_lengths.append(len(tokenizer.apply_chat_template(normalize_messages(call['request']['messages']),
                         tools=call['request']['tools'], tokenize=True, add_generation_prompt=True)))
        rejects += mapping['status'] == 'rejected_unknown_evidence_alias'
    # Native token text is checked BEFORE reverse mapping, original environment
    # actions AFTER reverse mapping. Neither record substitutes for the other.
    audit_generations(native_calls, generations)
    tokens = audit_calls(native_calls, generations, tokenizer)
    return {'tokens': tokens, 'input_records': len(inputs), 'response_records': len(responses),
            'changed_requests': sum(r['projection']['changed'] for r in inputs),
            'unknown_alias_rejections': rejects, 'input_records_digest': digest(inputs),
            'response_records_digest': digest(responses),
            'raw_prompt_tokens_at_same_visited_states': sum(raw_lengths),
            'raw_lengths_digest': digest(raw_lengths),
            'raw_token_count_is_not_a_fresh_A_arm_measurement': True}


def audit_projected_panels(directory, diagnostic_dir, d2_dir, tokenizer, arm):
    catalog = load_catalog(ROOT/'benchmark/catalog.json')
    reports = {}
    for panel in PANELS:
        path = directory/panel
        episodes = read_jsonl(path/'episodes.jsonl')
        if panel == 'normal':
            result = normal_report(original('dev'), catalog, episodes)
            calls = [{'case_id': e['scenario_id'], 'call': c} for e in episodes for c in e['calls']]
        else:
            module = diagnostic if panel == 'diagnostic' else d2
            cases = module.load_prepared(diagnostic_dir if panel == 'diagnostic' else d2_dir)
            if panel == 'd2':
                cases = ordered_cases(cases)
            result = {**module.summary(cases, episodes), 'replay': module.replay(cases, catalog, episodes)}
            calls = [{'case_id': e['case_id'], 'call': c} for e in episodes
                     for c in e['calls'][e['scripted_prefix_calls']:]]
        if result != read(path/'report.json') or calls != read_jsonl(path/'calls.jsonl'):
            raise ValueError('original environment/native replay differs')
        verification = audit_projected_calls([r['call'] for r in calls], read_jsonl(path/'generations.jsonl'),
                         read_jsonl(path/'inputs.jsonl'), read_jsonl(path/'responses.jsonl'), tokenizer, arm)
        if panel == 'd2':
            result['results'] = [{'case_id': e['case_id'], 'panel': c['panel'], **e['decision']}
                                 for c, e in zip(cases, episodes)]
        reports[panel] = {'report': result, **verification}
    return reports
