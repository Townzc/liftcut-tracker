"""Verified v7 HF control and paired inference payloads. No new data or model calls."""
import json
import shutil
from run_v2 import digest, read, write_json
from run_v3 import assemble
from run_v4 import load


def assemble_inputs(data, manifests, out, systems):
    rows = assemble(data, {v: manifests[v] for v in ('v2', 'v3')}, out)
    for name in ('enum', 'contract'):
        changed = []
        for row in rows:
            if row['messages'][0]['content'] != manifests['v4']['trainingSystem']:
                raise ValueError('original input prompt drift')
            changed.append({**row, 'messages': [{'role': 'system', 'content': systems[name + 'System']}, row['messages'][1]]})
        (out / ('all-eval-' + name + '.jsonl')).write_bytes(b''.join((json.dumps(r, ensure_ascii=False) + '\n').encode() for r in changed))
    return rows


def prepare(data, manifests, out, baseline, protocol):
    rows = assemble_inputs(data, manifests, out, protocol['promptContract'])
    if len(rows) != protocol['evaluationItems']:
        raise ValueError('evaluation count drift')
    for name in ('enum', 'contract'):
        if digest(out / ('all-eval-' + name + '.jsonl')) != protocol['inputs'][name]['sha256']:
            raise ValueError('input drift')
    for name, expected in protocol['baselineFiles'].items():
        if digest(baseline / name) != expected:
            raise ValueError('cached control hash mismatch: ' + name)
    origin = load(baseline / 'run.json')
    if origin['commit'] != protocol['baselineCommit'] or not all(any(
            s['name'] == step and s['exit'] == 0 for s in origin['steps']) for step in ('train-S', 'S-HF')):
        raise ValueError('incomplete/wrong cached v7 control')
    pred, audit = read(baseline / 'S-HF.jsonl'), load(baseline / 'S-HF.jsonl.audit.json')
    if ([r['id'] for r in pred] != [r['id'] for r in rows] or
            audit['inputSha256'] != protocol['inputs']['enum']['sha256'] or
            audit['tokenIdsSha256'] != protocol['inputs']['enum']['tokenIdsSha256'] or audit['engine'] != 'hf'):
        raise ValueError('cached HF input tokens/IDs differ')
    metrics = load(baseline / 'S/model/train_metrics.json')
    if any(metrics.get(k) != v for k, v in protocol['trainingMetrics'].items()):
        raise ValueError('cached training parameters differ')
    for suffix in ('.jsonl', '.jsonl.audit.json'):
        shutil.copyfile(baseline / ('S-HF' + suffix), out / ('A' + suffix))
    write_json(out / 'historical-origin.json', origin)
    write_json(out / 'cached-control-verification.json', {'verified': True, 'commit': origin['commit'],
        'files': protocol['baselineFiles'], 'newPredictions': 0, 'note': 'A is cached HF; no controlled speed comparison.'})
    return rows
