"""Bounded read-only GPU sampling. Missing samples/unsupported metrics stay unknown."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

FIELDS = ('index', 'uuid', 'name', 'utilization.gpu', 'utilization.memory', 'memory.used', 'memory.total', 'power.draw')


def parse_csv(text):
    result = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) != len(FIELDS):
            raise ValueError('GPU sample schema differs')
        item = dict(zip(FIELDS, (s.strip() for s in row)))
        for key in FIELDS[3:]:
            raw = item[key]
            value = None if raw in ('N/A', '[N/A]', '[Not Supported]') else float(raw)
            if value is not None and (not math.isfinite(value) or value < 0
                    or (key.startswith('utilization.') and value > 100)):
                raise ValueError('invalid observed GPU metric')
            item[key] = value
        result.append(item)
    if not result or len({r['uuid'] for r in result}) != len(result):
        raise ValueError('empty/duplicate GPU sample')
    return result


def sample():
    value = subprocess.run(['nvidia-smi', '--query-gpu=' + ','.join(FIELDS), '--format=csv,noheader,nounits'],
                           check=True, capture_output=True, text=True, timeout=4)
    return parse_csv(value.stdout)


def observe(lease_path, output, *, interval=5):
    from day_lease import read, validate
    lease = read(lease_path); start = datetime.now(timezone.utc); end = validate(lease, start)
    if interval != 5:
        raise ValueError('fixed five-second observation interval required')
    stop = time.monotonic() + (end - start).total_seconds()
    with Path(output).open('x', encoding='utf-8') as stream:
        while time.monotonic() < stop:
            begin = time.monotonic()
            record = {'at_utc': datetime.now(timezone.utc).isoformat(), 'monotonic_seconds': begin,
                      'kind': 'actual_nvidia_smi_observation', 'interval_seconds': interval}
            try:
                record['gpus'] = sample(); record['status'] = 'observed'
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                record.update(status='unknown', gpus=None, error_type=type(error).__name__)
            record['probe_wall_seconds'] = time.monotonic() - begin
            stream.write(json.dumps(record) + '\n'); stream.flush()
            time.sleep(min(max(0, interval - (time.monotonic() - begin)), max(0, stop - time.monotonic())))


def start(ops):
    from day_lease import lease_path, verify_live, write_new, identity
    ops = Path(ops); lease = lease_path(ops); verify_live(lease)
    source = Path(__file__).resolve(); output = ops / 'gpu-samples.jsonl'
    write_new(ops / 'gpu-observer-reservation.json', {'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'output': str(output), 'interval_seconds': 5, 'at_utc': datetime.now(timezone.utc).isoformat()})
    argv = [sys.executable, str(source), '--lease', str(lease), '--output', str(output)]
    with (ops / 'gpu-observer.log').open('x') as log:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
    for _ in range(100):
        if output.exists() and output.stat().st_size:
            break
        if child.poll() is not None:
            raise ValueError('GPU observer failed; inspect, do not restart automatically')
        time.sleep(.1)
    else:
        raise ValueError('GPU observer outcome unknown; inspect, do not duplicate')
    result = {'identity': identity(child.pid), 'argv': argv, 'output': str(output)}
    write_new(ops / 'gpu-observer.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--lease', type=Path, required=True); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); observe(args.lease, args.output)
