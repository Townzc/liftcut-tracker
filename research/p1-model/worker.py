"""One local-to-SSH model process; no database credentials or human-event powers."""
import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import queue
import subprocess
import sys
import threading
import time

from protocol import ROOT, MANIFEST, aware, read, sha, validate_binding, validate_ack, verify_sources
from relay import exclusive, now
from native import Native


def frame(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def request_shutdown(command, event, emit=frame, run=subprocess.run):
    event('shutdown_requested')
    try: emit({'command': 'shutdown_requested', 'at_utc': now()})
    except (BrokenPipeError, OSError): pass
    try:
        result = run(command, capture_output=True, timeout=30)
        event('shutdown_returned', returncode=result.returncode)
        try: emit({'command': 'shutdown_returned', 'returncode': result.returncode, 'at_utc': now()})
        except (BrokenPipeError, OSError): pass
    except Exception as exc: event('shutdown_return_unknown', error_type=type(exc).__name__)


def asset_proof(model, adapter, binding):
    plan = verify_sources(); contract = read(ROOT / 'research/liftcut-agent/reports/candidate-d-v1.json')['contract']
    base = {name: sha(model / name) for name in contract['base_model']['files']}
    if base != {name: info['sha256'] for name, info in contract['base_model']['files'].items()}: raise ValueError('base assets differ')
    weights = {name: sha(adapter / name) for name in contract['adapter_sha256']}
    if weights != contract['adapter_sha256']: raise ValueError('fixed parent assets differ')
    import torch
    runtime = {'packages': {name: importlib.metadata.version(name) for name in contract['observed_runtime']['packages']},
               'python': platform.python_version(), 'cuda_build': torch.version.cuda, 'gpu_name': torch.cuda.get_device_name(0)}
    if runtime != contract['observed_runtime']: raise ValueError('frozen model runtime differs')
    return {'binding': binding, 'source_sha256': plan['sources'], 'base_sha256': base, 'adapter_sha256': weights, 'runtime': runtime}


def load(model, adapter):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from peft import PeftModel, prepare_model_for_kbit_training
    set_seed(42); torch.set_num_threads(8)
    tokenizer = AutoTokenizer.from_pretrained(str(model), local_files_only=True, trust_remote_code=False)
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True,
                              bnb_4bit_compute_dtype=torch.bfloat16)
    base = AutoModelForCausalLM.from_pretrained(str(model), local_files_only=True, trust_remote_code=False,
        torch_dtype=torch.bfloat16, quantization_config=quant, device_map={'': 0}, attn_implementation='sdpa')
    base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=False)
    policy = PeftModel.from_pretrained(base, str(adapter), is_trainable=False, local_files_only=True)
    policy.eval(); policy.config.use_cache = True
    return Native(tokenizer, policy)


def run(args):
    b = validate_binding(read(args.binding), launch=True)
    if b['manifestSha256'] != sha(MANIFEST): raise ValueError('binding freeze differs')
    if platform.system() != 'Linux' or not Path('/root/autodl-tmp').is_dir(): raise ValueError('intended AutoDL host required')
    # A global data-use reservation prevents retries under another run identity.
    exclusive(args.reservation, {'study': b['study'], 'binding': b, 'pid': os.getpid(), 'at_utc': now()})
    args.output.mkdir(parents=True, exist_ok=False)
    records, stop, inbox = [], threading.Event(), queue.Queue(maxsize=2)
    power = args.output / 'power-events.jsonl'
    def event(kind, **data):
        with power.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'event': kind, 'at_utc': now(), **data}) + '\n'); stream.flush(); os.fsync(stream.fileno())
    def inputs():
        try:
            while True:
                line = sys.stdin.readline(2000001)
                if not line: break
                if len(line) > 2000000: raise ValueError('oversized native input')
                inbox.put(json.loads(line))
        finally: inbox.put(None)
    def telemetry():
        sys.path.insert(0, str(ROOT / 'research/liftcut-agent'))
        from gpu_telemetry import sample
        with (args.output / 'gpu-samples.jsonl').open('x', encoding='utf-8') as stream:
            while not stop.is_set():
                start = time.monotonic(); row = {'at_utc': now(), 'interval_seconds': 5}
                try: row.update(status='observed', gpus=sample())
                except Exception as exc: row.update(status='unknown', gpus=None, error_type=type(exc).__name__)
                row['probe_wall_seconds'] = time.monotonic() - start
                stream.write(json.dumps(row) + '\n'); stream.flush()
                stop.wait(max(0, 5 - (time.monotonic() - start)))
    observer = threading.Thread(target=telemetry, daemon=True); observer.start()
    try:
        event('worker_started', pid=os.getpid(), binding=b)
        with redirect_stdout(sys.stderr):
            proof = asset_proof(args.model, args.adapter, b)
            exclusive(args.output / 'server-proof.json', proof)
            event('model_loading')
            native = load(args.model, args.adapter)
        event('model_loaded'); frame({'command': 'ready', 'pid': os.getpid(), 'binding': b})
        threading.Thread(target=inputs, daemon=True).start()
        while True:
            if datetime.now(timezone.utc) >= aware(b['workCutoff']): raise TimeoutError('original work cutoff')
            try: request = inbox.get(timeout=1)
            except queue.Empty: continue
            if request is None: raise ConnectionError('SSH input ended; preserve partial, never restart')
            if request.get('command') == 'finish': break
            if set(request) != {'command', 'number', 'payload'} or request['command'] != 'generate' or request['number'] != native.number + 1 or native.number >= 288:
                raise ValueError('native request identity/budget differs')
            with (args.output / 'requests.jsonl').open('a', encoding='utf-8') as stream:
                stream.write(json.dumps({'at_utc': now(), **request}, ensure_ascii=False) + '\n'); stream.flush(); os.fsync(stream.fileno())
            start = time.monotonic()
            with redirect_stdout(sys.stderr): response = native.complete(request['payload'])
            record = {'request': request['payload'], 'reply': response}; records.append(record)
            # Persist every generation before returning it across SSH.
            with (args.output / 'generations.jsonl').open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(record, ensure_ascii=False) + '\n'); stream.flush(); os.fsync(stream.fileno())
            frame({'command': 'reply', 'value': response, 'wall_seconds': time.monotonic() - start})
        stop.set(); observer.join(timeout=6)
        if observer.is_alive(): raise RuntimeError('telemetry did not finish')
        count = sum(int(r['reply']['native']['model_called']) for r in records)
        exclusive(args.output / 'server-native-records.json', {'kind': 'model', 'model_calls': count, 'records': records})
        complete = {'binding': b, 'requests': len(records), 'model_calls': count, 'at_utc': now(),
                    'native_sha256': sha(args.output / 'server-native-records.json'),
                    'files': {name: sha(args.output / name) for name in ('server-proof.json', 'server-native-records.json', 'gpu-samples.jsonl', 'generations.jsonl', 'requests.jsonl')}}
        if aware(complete['at_utc']) > aware(b['workCutoff']): raise TimeoutError('completion after work cutoff')
        exclusive(args.output / 'server-complete.json', complete); frame({'command': 'complete', 'value': complete})
        while datetime.now(timezone.utc) < aware(b['collectionCutoff']):
            ack = args.output / 'ack.json'
            if ack.exists():
                validate_ack(read(ack), b, complete)
                event('ack_consumed', sha256=sha(ack)); frame({'command': 'ack_consumed', 'sha256': sha(ack)})
                return
            time.sleep(.5)
    except Exception as exc:
        event('worker_failed', error_type=type(exc).__name__)
        raise
    finally:
        stop.set(); observer.join(timeout=6)
        sys.path.insert(0, str(ROOT / 'research/liftcut-agent'))
        from shutdown_guard import shutdown_command
        request_shutdown(shutdown_command(Path('/usr/bin/shutdown')), event)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('binding', 'output', 'model', 'adapter', 'reservation'): parser.add_argument('--' + key, type=Path, required=True)
    run(parser.parse_args())
