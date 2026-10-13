"""Read published timing evidence only; do not infer GPU utilization from rent time."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def analyze():
    files = {}
    def load(relative):
        data = (ROOT / relative).read_bytes()
        files[relative] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
        return json.loads(data)
    close = load('reports/overnight-close-2026-10-13/summary.json')
    proxy = close['compute_proxy']
    phases = []
    for study, arms in (('i2', 'ABCD'), ('i3', 'CD')):
        for arm in arms:
            row = load(f'reports/{study}-seed42-2026-10-13/run/evaluation/{arm}/finished.json')
            phases.append({'study': study, 'arm': arm,
                'inference_wall_seconds': row['inference_wall_seconds'],
                'evaluation_wall_seconds_including_load': row['total_wall_seconds_including_load']})
    relative = 'reports/i3-seed42-2026-10-13/operations.jsonl'
    data = (ROOT / relative).read_bytes()
    files[relative] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    rows = [json.loads(x) for x in data.splitlines()]
    done = [r for r in rows if r['event'] == 'collector_finished']
    if len(done) != 1:
        raise ValueError('one actual final collector event required')
    finish = done[0]['at_utc']
    after = (datetime.fromisoformat(proxy['end_proxy_utc']) - datetime.fromisoformat(finish)).total_seconds()
    total = sum(row['evaluation_wall_seconds_including_load'] for row in phases)
    return {'version': 'liftcut-prior-lease-efficiency-v1', 'evidence_kind': 'retrospective_published_timing',
        'phases': phases, 'evaluation_wall_seconds_including_load_sum': total,
        'evaluation_wall_fraction_of_lease_proxy': total / proxy['elapsed_seconds'],
        'same_opening_cost_proxy_cny': proxy['current_opening_cny'],
        'lease_elapsed_seconds_proxy': proxy['elapsed_seconds'],
        'last_collector_finished_at_utc': finish, 'end_proxy_utc': proxy['end_proxy_utc'],
        'post_collection_reserved_wall_seconds': after,
        'post_collection_reserved_cost_proxy_cny': after / 3600 * proxy['hourly_cny'],
        'gpu_sm_utilization': None, 'ttft_seconds': None, 'inter_token_latency_seconds': None,
        'model_calls_in_this_analysis': 0, 'sources': files,
        'limits': ['Evaluation process wall time is not exact GPU-active time or GPU utilization.',
            'The post-collection interval included local development, CI and user-authorized retention; it is not measured GPU idle time.',
            'UTC and process timers have different scopes; no exhaustive phase partition is inferred.',
            'Costs are overlapping subinterval proxies of one opening, not additive fees or an invoice.',
            'No E1 task payload, private weight, live server or model is read by this analysis.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(analyze(), stream, indent=2); stream.write('\n')
