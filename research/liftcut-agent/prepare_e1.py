"""Offline E1 development rehearsal only; no model, cloud or held-out loader.

Runs 12 existing DEVELOPMENT tasks per arm using a scripted wire transport. The
result checks full-loop contracts and cannot certify model performance.
"""
import argparse
from dataclasses import asdict
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from candidate_d import SNAPSHOT, validate
from controlled_recovery import public_episode_id
from d2_execution import read
from e1_protocol import ARMS, run_config, verify_plan
from i2_rollout import ProjectedTransport, input_record
from i2_view import restore_reply
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import Reply, RunBudget
from liftcut_agent.model_runner import run_model_episode, replay_model_suite
from liftcut_agent.model_transport import MockWorkflowTransport
from server_workspace import dump_new, sha256
from state_coverage import original


def forbid_reserved_payload(event, arguments):
    # This guard also covers transitive imports/read helpers during the CLI run.
    if event == 'open' and arguments and isinstance(arguments[0], (str, bytes)):
        name = arguments[0].decode() if isinstance(arguments[0], bytes) else arguments[0]
        if name.replace('\\', '/').split('/')[-1].lower() == 'test.jsonl':
            raise PermissionError('E1 preparation cannot open reserved task payloads')


def run_development():
    cases = original('dev')
    if len(cases) != 12 or any(c['split'] != 'dev' for c in cases):
        raise ValueError('exact development-only rehearsal required')
    catalog, cfg = load_catalog(ROOT / 'benchmark/catalog.json'), run_config()
    results = {}
    for arm in ARMS:
        aggregate, episodes, records = RunBudget(cfg), [], []
        for case in cases:
            inputs, responses = [], []
            transport = ProjectedTransport(MockWorkflowTransport(), arm, inputs.append, responses.append)
            episode = run_model_episode(case, catalog, cfg, transport, aggregate,
                                        episode_id=public_episode_id(case))
            calls = episode['calls']
            if not len(calls) == len(inputs) == len(responses):
                raise ValueError('scripted native/original records missing')
            for number, (call, inp, response) in enumerate(zip(calls, inputs, responses), 1):
                expected = input_record(call['request'], arm, number)
                mapped, proof = restore_reply(Reply(**response['native_response']), expected['projection'])
                if (expected != inp or asdict(mapped) != call['response']
                        or proof != response['mapping'] or response['environment_response'] != asdict(mapped)):
                    raise ValueError('scripted projected input or inverse mapping mismatch')
            episodes.append(episode)
            records.append({'case_id': case['id'], 'inputs': inputs, 'responses': responses})
        replay = replay_model_suite(cases, catalog, cfg, episodes)
        if replay['replayed'] != 12:
            raise ValueError('all full development episodes must replay')
        results[arm] = {'episodes': episodes, 'records': records, 'replay': replay,
                       'requests': aggregate.requests,
                       'blocked_write_attempts': sum(e['trace']['score']['blocked_write_attempts'] for e in episodes)}
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    sys.addaudithook(forbid_reserved_payload)
    if args.output_dir.exists():
        raise ValueError('new rehearsal directory required')
    plan, snapshot = verify_plan(), validate(read(SNAPSHOT))
    results = run_development()
    source_files = ('candidate_d.py', 'e1_protocol.py', 'prepare_e1.py')
    args.output_dir.mkdir(parents=True)
    dump_new(args.output_dir / 'scripted-development.json', results)
    report = {
        'version': 'e1-offline-readiness-v1', 'evidence_kind': 'scripted_development_contract',
        'model_result': False, 'model_calls': 0, 'heldout_tasks_read': 0,
        'reserved_payload_open_guard_enabled': True,
        'candidate_digest': snapshot['contract_digest'], 'protocol_digest': digest(plan),
        'source_sha256': {n: sha256(ROOT / n) for n in source_files},
        'scripted_evidence_sha256': sha256(args.output_dir / 'scripted-development.json'),
        'arms': {arm: {k: result[k] for k in ('replay', 'requests', 'blocked_write_attempts')}
                 for arm, result in results.items()},
        'full_development_episodes': 24, 'new_model_token_audit': False,
        'scripted_usage_is_not_model_usage': True,
        'can_launch': False, 'pending': plan['execution_readiness'],
        'scope': 'Wire projection, inverse mapping, external events, full original-environment replay only.'}
    dump_new(args.output_dir / 'report.json', report)
    print({'full_scripted_development_episodes': 24, 'arms': report['arms'], 'can_launch': False})


if __name__ == '__main__':
    main()
