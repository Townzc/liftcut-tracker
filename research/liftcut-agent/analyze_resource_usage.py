"""Report sampled GPU use and non-overlapping lease activity without filling gaps."""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path

from day_lease import aware, validate


ACTIVITIES = {'preparation', 'evaluation_including_load', 'audit', 'transfer', 'restoration',
              'local_engineering', 'ci_wait', 'reserved_idle'}


def activity_accounting(lease, intervals, observed_end):
    boot = aware(lease['booted_at_proxy']); end = min(aware(lease['shutdown_at_utc']), observed_end)
    if end < boot:
        raise ValueError('accounting end precedes original opening')
    seconds = defaultdict(float); previous = boot
    for row in sorted(intervals, key=lambda v: aware(v['start_utc'])):
        start, stop = aware(row['start_utc']), aware(row['end_utc'])
        if row['activity'] not in ACTIVITIES or not previous <= start < stop <= end:
            raise ValueError('activity intervals must be bounded, labeled and non-overlapping')
        seconds[row['activity']] += (stop - start).total_seconds(); previous = stop
    total = (end - boot).total_seconds()
    seconds['unclassified'] = total - sum(seconds.values())
    return {'accounted_until_utc': end.isoformat(), 'lease_wall_seconds': total,
            'duration_cost_proxy_cny': total / 3600 * lease['hourly_cny'],
            'not_provider_invoice': True, 'activity_wall_seconds': dict(seconds),
            'subinterval_costs_must_not_be_added_to_total': True}


def analyze(lease, samples, *, intervals=(), observed_end=None):
    validate(lease); boot = aware(lease['booted_at_proxy']); cutoff = aware(lease['shutdown_at_utc'])
    if not samples:
        raise ValueError('at least one recorded observation required; no invented GPU usage')
    times = [aware(row['at_utc']) for row in samples]
    if any(not boot <= t <= cutoff for t in times) or any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError('original-window strictly ordered sample times required')
    end = observed_end or times[-1]
    if not times[-1] <= end <= cutoff:
        raise ValueError('observation accounting endpoint is inconsistent')
    aggregates = defaultdict(lambda: defaultdict(float)); maxima = defaultdict(float)
    query_seconds = 0.0; unknown = 0
    for number, row in enumerate(samples):
        if row.get('interval_seconds') != 5 or row.get('kind') != 'actual_nvidia_smi_observation':
            raise ValueError('fixed observation contract required')
        probe = row['probe_wall_seconds']
        if type(probe) not in (float, int) or not math.isfinite(probe) or probe < 0:
            raise ValueError('invalid observed probe duration')
        query_seconds += probe
        # Do not interpolate long disconnects or assume an unknown sample was idle.
        next_time = times[number + 1] if number + 1 < len(times) else end
        width = min(5.0, max(0.0, (min(next_time, end) - times[number]).total_seconds()))
        if row['status'] not in ('observed', 'unknown'):
            raise ValueError('observation status must be explicit')
        if row['status'] == 'unknown':
            if row['gpus'] is not None:
                raise ValueError('unknown samples cannot contain invented GPU metrics')
            unknown += 1
            continue
        if not isinstance(row['gpus'], list) or not row['gpus']:
            raise ValueError('observed GPU rows absent')
        seen = set()
        for gpu in row['gpus']:
            device = gpu['uuid']
            if device in seen:
                raise ValueError('duplicate GPU in one sample')
            seen.add(device)
            stats = aggregates[device]; stats['covered_sample_seconds'] += width
            for field in ('utilization.gpu', 'utilization.memory', 'memory.used', 'memory.total', 'power.draw'):
                value = gpu[field]
                if value is None:
                    continue
                if (type(value) not in (float, int) or not math.isfinite(value) or value < 0
                        or (field.startswith('utilization.') and value > 100)):
                    raise ValueError('invalid recorded metric')
                stats[field + '_weighted_sum'] += value * width
                stats[field + '_observed_seconds'] += width
            if gpu['memory.used'] is not None:
                maxima[device] = max(maxima[device], gpu['memory.used'])
            if gpu['utilization.gpu'] is not None and gpu['utilization.gpu'] > 5:
                stats['busy_above_5pct_sample_seconds'] += width
    wall = (end - boot).total_seconds(); devices = {}
    for device, stats in aggregates.items():
        devices[device] = {'covered_sample_seconds': stats['covered_sample_seconds'],
            'coverage_fraction_of_lease_observed': stats['covered_sample_seconds'] / wall if wall else None,
            'maximum_observed_memory_mib': maxima.get(device), 'weighted_mean_over_observed_samples': {}}
        for field in ('utilization.gpu', 'utilization.memory', 'memory.used', 'memory.total', 'power.draw'):
            duration = stats[field + '_observed_seconds']
            devices[device]['weighted_mean_over_observed_samples'][field] = (
                stats[field + '_weighted_sum'] / duration if duration else None)
        duration = stats['utilization.gpu_observed_seconds']
        devices[device]['busy_above_5pct_fraction_of_observed_samples'] = (
            stats['busy_above_5pct_sample_seconds'] / duration if duration else None)
    return {'version': 'liftcut-resource-observation-v1', 'samples': len(samples),
            'unknown_samples': unknown, 'query_wall_seconds_sum': query_seconds, 'gpus': devices,
            'accounting': activity_accounting(lease, intervals, end),
            'limitations': ['Sampled GPU-wide metrics, not exact model-active seconds or exclusive process attribution.',
                           'Missing time is unclassified, never zero utilization.',
                           'Five-second samples cannot resolve brief per-request latency.',
                           'TTFT and inter-token latency require streaming instrumentation and are not measured here.'],
            'ttft_seconds': None, 'inter_token_latency_seconds': None}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('lease', 'samples', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--intervals', type=Path); parser.add_argument('--observed-end')
    args = parser.parse_args()
    lease = json.loads(args.lease.read_text(encoding='utf-8'))
    rows = [json.loads(line) for line in args.samples.read_text(encoding='utf-8').splitlines()]
    intervals = json.loads(args.intervals.read_text(encoding='utf-8')) if args.intervals else []
    result = analyze(lease, rows, intervals=intervals,
                     observed_end=aware(args.observed_end) if args.observed_end else None)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2); stream.write('\n')
