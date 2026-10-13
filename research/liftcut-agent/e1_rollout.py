"""Complete E1 episodes, with distinct native and original-environment records."""
from contextlib import ExitStack
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from controlled_recovery import public_episode_id
from d2_execution import append_json
from e1_protocol import ARMS, run_config
from i2_rollout import ProjectedTransport, audit_projected_calls
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import RunBudget
from liftcut_agent.model_runner import run_model_episode, replay_model_suite

FILES = ('episodes', 'calls', 'generations', 'inputs', 'responses')


def evaluate(output, cases, catalog, factory, arm, *, before_case=lambda: None):
    if arm not in ARMS or len(cases) != 48:
        raise ValueError('registered A/D and all 48 full tasks required')
    output.mkdir(parents=True, exist_ok=False)
    cfg, budget = run_config(), RunBudget(run_config())
    with ExitStack() as stack:
        streams = {n: stack.enter_context((output / (n + '.jsonl')).open('x', encoding='utf-8', newline='\n'))
                   for n in FILES}
        for case in cases:
            before_case()
            native = factory(lambda row: append_json(streams['generations'], row))
            transport = ProjectedTransport(native, arm,
                lambda row: append_json(streams['inputs'], row),
                lambda row: append_json(streams['responses'], row))
            episode = run_model_episode(case, catalog, cfg, transport, budget,
                episode_id=public_episode_id(case),
                on_call=lambda row: append_json(streams['calls'], {'case_id': case['id'], 'call': row}))
            append_json(streams['episodes'], episode)
            if budget.halted or any(c['usage'] is None for c in episode['calls']):
                raise ValueError('unknown usage: stop and preserve partial E1 evidence')


def audit_arm(directory, cases, catalog, tokenizer, arm, *, scripted=False):
    if arm not in ARMS or len(cases) != 48:
        raise ValueError('original complete E1 case list required')
    episodes = read_jsonl(directory / 'episodes.jsonl')
    if ([e['scenario_id'] for e in episodes] != [s['id'] for s in cases]
            or [e['trace']['episode_id'] for e in episodes] != [public_episode_id(s) for s in cases]):
        raise ValueError('missing/reordered/identity-changed E1 task')
    replay = replay_model_suite(cases, catalog, run_config(), episodes)
    if replay['replayed'] != 48:
        raise ValueError('all 48 original environment full episodes must replay')
    calls = read_jsonl(directory / 'calls.jsonl')
    expected = [{'case_id': e['scenario_id'], 'call': c} for e in episodes for c in e['calls']]
    if calls != expected or any(c['call']['usage'] is None for c in calls):
        raise ValueError('every actual E1 request needs known usage and ordered call record')
    streams = {n: read_jsonl(directory / (n + '.jsonl')) for n in ('generations', 'inputs', 'responses')}
    if any(len(v) != len(calls) for v in streams.values()):
        raise ValueError('native/projection/inverse/token record missing')
    offset, rows, verified = 0, [], []
    for case, episode in zip(cases, episodes):
        n = len(episode['calls']); end = offset + n
        # Transport/request numbering resets at each new full task, exactly as run.
        native = audit_projected_calls(episode['calls'], streams['generations'][offset:end],
            streams['inputs'][offset:end], streams['responses'][offset:end], tokenizer, arm)
        score = episode['trace']['score']
        expected_writes = int(case['expected_terminal'] == 'applied')
        row = {'case_id': case['id'], 'category': case['category'], 'bundle': case['family_id'],
               'passed': score['passed'] and episode['policy_failure'] is None,
               'blocked_write_attempts': score['blocked_write_attempts'],
               'unexpected_committed_writes': max(0, score['writes'] - expected_writes),
               'unknown_alias_rejections': native['unknown_alias_rejections']}
        rows.append(row)
        verified.append({'case_id': case['id'], 'native': native, 'policy_failure': episode['policy_failure'],
                         'score': score, 'requests': n})
        offset = end
    return {'arm': arm, 'replay': replay, 'rows': rows, 'case_details': verified,
            'episodes_digest': digest(episodes), 'requests': len(calls),
            'evidence_kind': 'scripted_contract' if scripted else 'model',
            'actual_model_calls': 0 if scripted else sum(g['model_called'] for g in streams['generations']),
            'serialized_generations': sum(g['model_called'] for g in streams['generations']),
            'recorded_prompt_tokens': sum(c['call']['usage']['prompt_tokens'] for c in calls),
            'recorded_completion_tokens': sum(c['call']['usage']['completion_tokens'] for c in calls),
            'recorded_usage_is_model_usage': not scripted,
            'token_ids_verified': True, 'projection_inputs_verified': True, 'inverse_mapping_verified': True}
