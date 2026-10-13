"""Run the local database driver against one long-lived native transport.

Only an explicit, checkpointed exit 75 may restart the application process. A
broken transport is partial evidence, never an automatic inference retry.
"""
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]


def now():
    return datetime.now(timezone.utc).isoformat()


def exclusive(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n'); stream.flush(); os.fsync(stream.fileno())


def drive(output, complete, *, mode='native-scripted', work_end=None, binding_file=None):
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('new driver evidence directory required')
    processes, number = [], 0
    # One process for each of the three declared resume events plus the initial process.
    try:
        for restart in range(4):
            argv = ['node', '--conditions=react-server', '--import', 'tsx',
                    'research/p1-model/driver.ts', str(output), mode]
            if restart: argv.append('--resume')
            env = dict(os.environ)
            if binding_file: env['P1M_BINDING_FILE'] = str(binding_file)
            started = now()
            proc = subprocess.Popen(argv, cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1)
            lines, errors, frames = queue.Queue(), [], []
            def drain_stdout():
                try:
                    for line in proc.stdout: lines.put(line)
                finally: lines.put(None)
            def drain_stderr():
                for line in proc.stderr: errors.append(line)
            reader = threading.Thread(target=drain_stdout, daemon=True); reader.start()
            err_reader = threading.Thread(target=drain_stderr, daemon=True); err_reader.start()
            try:
                while True:
                    if work_end is not None and time.time() >= work_end:
                        raise TimeoutError('original work cutoff reached')
                    try: line = lines.get(timeout=1)
                    except queue.Empty: continue
                    if line is None: break
                    frame = json.loads(line)
                    if frame['command'] == 'generate':
                        number += 1
                        if frame['number'] != number or number > 288:
                            raise ValueError('request identity or budget differs')
                        response = complete(frame['payload'])
                        if response['number'] != number: raise ValueError('transport sequence differs')
                        proc.stdin.write(json.dumps(response, ensure_ascii=False, allow_nan=False) + '\n')
                        proc.stdin.flush()
                    else: frames.append(frame)
                code = proc.wait(timeout=20); err_reader.join(timeout=5)
            finally:
                if proc.poll() is None:
                    proc.terminate()
                    try: proc.wait(timeout=10)
                    except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=5)
                reader.join(timeout=2); err_reader.join(timeout=2)
                processes.append({'pid': proc.pid, 'started_at_utc': started, 'ended_at_utc': now(),
                                  'returncode': proc.returncode, 'frames': frames, 'stderr': ''.join(errors)})
                for pipe in (proc.stdin, proc.stdout, proc.stderr): pipe.close()
            if code == 75:
                if len(frames) != 1 or frames[0]['command'] != 'planned_resume':
                    raise ValueError('unplanned application restart refused')
                continue
            if code or len(frames) != 1 or frames[0]['command'] != 'complete':
                raise RuntimeError(f'application driver failed: {code}; inspect preserved stderr')
            # Failed model cases may never reach their planned resume point; count what occurred.
            return {'status': 'complete', 'requests': number, 'planned_process_restarts': restart,
                    'summary': frames[0]['summary']}
        raise ValueError('application restart budget exceeded')
    finally:
        if output.exists():
            exclusive(output / 'local-controller.json', {'mode': mode, 'requests': number,
                'processes': processes, 'recorded_at_utc': now(), 'automatic_transport_retries': 0})


def cpu(output, tokenizer_dir):
    from transformers import AutoTokenizer
    from native import Native, audit
    tokenizer = AutoTokenizer.from_pretrained(str(tokenizer_dir), local_files_only=True, trust_remote_code=False)
    native, records = Native(tokenizer), []
    def complete(payload):
        reply = native.complete(payload)
        audit(tokenizer, payload, reply, native.number, 'scripted')
        records.append({'request': payload, 'reply': reply})
        return reply
    try:
        report = drive(output, complete, work_end=time.time() + 180)
        if report['planned_process_restarts'] != 3: raise ValueError('CPU resume workflows missing')
        print(json.dumps(report))
    finally:
        if Path(output).exists():
            exclusive(Path(output) / 'native-records.json', {'kind': 'scripted', 'model_calls': 0, 'records': records})


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--tokenizer-dir', type=Path, required=True)
    args = parser.parse_args()
    cpu(args.output_dir, args.tokenizer_dir)
