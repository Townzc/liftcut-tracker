"""Stage B: memory-record arrangement coverage in actual training vs D2 choices.

CPU-only, post-hoc. Reads the frozen G2 training schedule and the published
G2/D2 episodes; no inference, training, scoring change or reserved-test read.
Each record list is reduced to its arrangement: V latest valid, O older valid,
U unconfirmed distractor, X expired distractor, in the order the tool returns.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))
from d2_execution import read
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from prepare_g2 import ARMS, schedules
from server_workspace import dump_new, sha256

PUBLIC = ROOT / 'reports/g2-seed42-2026-10-03'
D2_S0 = ROOT / 'reports/d2-fixed-seed42-2026-10-02'
REVIEWED = ROOT / 'reports/memory-coverage-2026-10-03/audit.json'


def arrangement(memories, as_of):
    """Role string for one equipment record list, or None for non-memory states."""
    records = [m for m in memories if m['field'] == 'equipment']
    if not records:
        return None
    valid = [m for m in records if m['confirmed'] and not (m['expires_on'] and m['expires_on'] <= as_of)]
    latest = max(valid, key=lambda m: m['revision'])
    roles = []
    for m in records:
        if not m['confirmed']:
            roles.append('U')
        elif m['expires_on'] and m['expires_on'] <= as_of:
            roles.append('X')
        else:
            roles.append('V' if m is latest else 'O')
    if sorted(roles) not in (['O', 'U', 'V'], ['O', 'V', 'X']):
        raise ValueError('unexpected memory arrangement: ' + ''.join(roles))
    revisions = [m['revision'] for m in records]
    return {'order': ''.join(roles), 'latest_valid_position': ('first', 'middle', 'last')[roles.index('V')],
            'older_valid_before_latest': roles.index('O') < roles.index('V'),
            'revisions_ascending_in_list': revisions == sorted(revisions)}


def memories_in_context(row):
    """The get_memories result visible before this target, if any."""
    calls = {}
    found = None
    for message in row['messages'][:-1]:
        for call in message.get('tool_calls', []):
            calls[call['id']] = call['function']['name']
        if message['role'] == 'tool' and calls.get(message['tool_call_id']) == 'get_memories':
            found = json.loads(message['content'])['result']['memories']
    return found


def training_coverage(prepared):
    schedule, _, pools = schedules(prepared)
    result = {}
    for arm in ARMS:
        exposures = Counter()
        targets = Counter()
        for item in schedule[arm]:
            row = pools[item['variant']][item['index']]
            memories = memories_in_context(row)
            if not memories:
                continue
            as_of = json.loads(row['messages'][1]['content'])['as_of']
            shape = arrangement(memories, as_of)
            if shape is None:
                continue
            target = row['messages'][-1]['tool_calls'][0]['function']
            exposures[shape['order']] += 1
            if target['name'] == 'search_exercises':
                targets[shape['order']] += 1
        result[arm] = {'decisions_seeing_memories': dict(sorted(exposures.items())),
                       'equipment_selection_targets': dict(sorted(targets.items()))}
    return result


def d2_choices(folder):
    by_order = defaultdict(Counter)
    for episode in read_jsonl(folder / 'episodes.jsonl'):
        if not episode['case_id'].startswith(('d2-memory-', 'd2-identity-')):
            continue
        events = [e for e in episode['trace']['events'] if e['actor'] == 'agent']
        memories = next(e['observation']['result']['memories'] for e in reversed(events)
                        if e['action']['tool'] == 'get_memories')
        as_of = episode['trace']['initial_observation']['as_of']
        shape = arrangement(memories, as_of)
        panel = episode['case_id'].split('-')[1]
        chosen = None
        last = events[-1]['action']
        if last['tool'] == 'search_exercises':
            values = {m['id']: m for m in memories}
            picked = [m for m in memories if m['value'] == last['arguments']['equipment']]
            chosen = ''.join(sorted({shape['order'][memories.index(m)] for m in picked})) or 'raw/other'
        else:
            chosen = 'tool:' + last['tool']
        key = panel + '|' + shape['order']
        by_order[key]['total'] += 1
        by_order[key]['correct'] += bool(episode['decision']['correct'])
        by_order[key]['chose:' + chosen] += 1
    return {k: dict(sorted(v.items())) for k, v in sorted(by_order.items())}


def analyze(prepared):
    training = training_coverage(prepared)
    d2 = {'d2_' + arm: d2_choices(D2_S0 / 'run/evaluation' / arm) for arm in ('s0', 't')}
    for arm in ARMS:
        d2[arm] = d2_choices(PUBLIC / 'run/evaluation' / arm / 'd2')
    return {'version': 'memory-coverage-audit-v1', 'training': training, 'd2_by_arrangement': d2,
            'source_sha256': {'g2_preparation': sha256(ROOT / 'reports/g2-preparation-v1.json'),
                              'g2_publication': sha256(PUBLIC / 'publication.json')},
            'new_model_calls': 0, 'test_episodes': 0,
            'scope': 'Post-hoc coverage description; D2 states are reused development cases, not independent tests.'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    p.add_argument('--prepared-dir', required=True, type=Path)
    p.add_argument('--check', action='store_true')
    a = p.parse_args()
    result = analyze(a.prepared_dir)
    if a.check:
        if result != read(REVIEWED):
            raise ValueError('memory coverage audit differs from the saved evidence')
    else:
        dump_new(REVIEWED, result)
    print(json.dumps(result, indent=1))
