"""CPU-only same-driver rehearsal, with three deliberate checkpointed process restarts."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def run(output):
    if output.exists():
        raise ValueError('new output directory required')
    events = []
    for resume in range(4):
        argv = ['node', '--conditions=react-server', '--import', 'tsx',
                str(ROOT / 'research/p1-model/driver.ts'), str(output), 'scripted']
        if resume:
            argv += ['--resume']
        start = datetime.now(timezone.utc).isoformat()
        proc = subprocess.Popen(argv, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        out, err = proc.communicate(timeout=120)
        frames = [json.loads(line) for line in out.splitlines() if line.strip()]
        events.append({'pid': proc.pid, 'started_at_utc': start,
                       'ended_at_utc': datetime.now(timezone.utc).isoformat(), 'returncode': proc.returncode,
                       'frames': frames, 'stderr': err})
        if proc.returncode != 75:
            with (output / 'local-controller.json').open('x', encoding='utf-8') as stream:
                json.dump({'evidence_kind': 'scripted_application', 'model_calls': 0,
                           'planned_process_restarts': resume, 'events': events}, stream, indent=2)
            if proc.returncode:
                raise RuntimeError(err)
            assert resume == 3, 'all three planned resume workflows must actually restart the driver'
            print(json.dumps({'scripted_cases': 24, 'model_calls': 0, 'planned_process_restarts': resume}))
            return
        assert len(frames) == 1 and frames[0]['command'] == 'planned_resume', 'unexpected restart request'
    raise ValueError('too many planned restarts')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    run(parser.parse_args().output_dir.resolve())
