"""Shared real/CPU G2 evaluation path over frozen normal, diagnostic and D2 states."""
from contextlib import ExitStack

import counterfactual_diagnostics as d2
import state_diagnostics as diagnostic
from coverage_rollout import normal_report, run_normal
from d2_execution import append_json, ordered_cases, read
from audit_controlled import audit_generations
from audit_coverage_tokens import audit_calls
from liftcut_agent.benchmark import load_catalog, read_jsonl
from prepare_g2 import ROOT
from state_coverage import original
from server_workspace import dump_new

PANELS = ('normal', 'diagnostic', 'd2')


def run_d2(cases, catalog, transport, on_episode, on_call):
    budget, episodes = d2.arm_budget(), []
    for case in cases:
        row = d2.run_case(case, catalog, transport, budget,
                         on_call=lambda c: on_call(case['id'], c))
        episodes.append(row)
        on_episode(row)
    return {**d2.summary(cases, episodes), 'replay': d2.replay(cases, catalog, episodes)}, episodes


def run_panels(output, diagnostic_dir, d2_dir, transport_factory):
    """Factory(panel, generation_callback); optional advance() for scripted drill."""
    catalog = load_catalog(ROOT / 'benchmark/catalog.json')
    reports = {}
    for panel in PANELS:
        path = output / panel
        path.mkdir(parents=True, exist_ok=False)
        with ExitStack() as stack:
            streams = {n: stack.enter_context((path / f'{n}.jsonl').open('x', encoding='utf-8', newline='\n'))
                       for n in ('episodes', 'calls', 'generations')}
            transport = transport_factory(panel, lambda row: append_json(streams['generations'], row))
            def episode(row):
                append_json(streams['episodes'], row)
                if hasattr(transport, 'advance'):
                    transport.advance()
            callbacks = {'on_episode': episode,
                         'on_call': lambda case_id, call: append_json(streams['calls'], {'case_id': case_id, 'call': call})}
            if panel == 'normal':
                result, _ = run_normal(catalog, lambda: transport, **callbacks)
            elif panel == 'diagnostic':
                result, _ = diagnostic.run_suite(diagnostic.load_prepared(diagnostic_dir), catalog, transport, **callbacks)
            else:
                result, _ = run_d2(ordered_cases(d2.load_prepared(d2_dir)), catalog, transport, **callbacks)
        dump_new(path / 'report.json', result)
        reports[panel] = result
    return reports


def audit_panels(directory, diagnostic_dir, d2_dir, tokenizer):
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
            replay = module.replay(cases, catalog, episodes)
            result = {**module.summary(cases, episodes), 'replay': replay}
            calls = [{'case_id': e['case_id'], 'call': c} for e in episodes for c in e['calls'][e['scripted_prefix_calls']:]]
        if result != read(path / 'report.json') or calls != read_jsonl(path / 'calls.jsonl'):
            raise ValueError('G2 saved panel report/calls differ from native/environment replay')
        generations = read_jsonl(path / 'generations.jsonl')
        audit_generations([r['call'] for r in calls], generations)
        tokens = audit_calls([r['call'] for r in calls], generations, tokenizer)
        if panel == 'd2':
            result['results'] = [{'case_id': e['case_id'], 'panel': c['panel'], **e['decision']}
                                 for c, e in zip(cases, episodes)]
        reports[panel] = {'report': result, 'tokens': tokens}
    return reports
