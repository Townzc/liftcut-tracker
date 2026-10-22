"""Audit v4 answer-token loss coefficients without loading or training a model.

The frozen SFT averages cross entropy over unmasked tokens in each batch.
These are scalar coefficients, not measured losses, gradients or causal effects.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import random

M4 = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def frozen_training_settings(protocol, sft_source):
    sft_hash = hashlib.sha256(sft_source.replace(b'\r\n', b'\n')).hexdigest()
    if sft_hash != protocol['sourceLfSha256']['research/m4-parser/train/sft.py']:
        raise ValueError('frozen SFT source mismatch')
    train_args = protocol['trainingArgs']
    if '--max-steps' in train_args or '--limit' in train_args:
        raise ValueError('audit requires complete fixed epochs')
    settings = {name: int(train_args[train_args.index('--' + name) + 1])
                for name in ('seed', 'batch', 'epochs')}
    return settings, sft_hash


def answer_examples(rows, gold, tokenizer):
    if not rows or len({r['id'] for r in rows}) != len(rows):
        raise ValueError('nonempty unique training IDs required')
    by_id = {r['id']: r for r in gold}
    if len(by_id) != len(gold) or set(by_id) != {r['id'] for r in rows}:
        raise ValueError('training/gold IDs differ')
    result = []
    for row in rows:
        messages, item = row['messages'], by_id[row['id']]
        if [m['role'] for m in messages] != ['system', 'user', 'assistant']:
            raise ValueError('unexpected SFT messages')
        answer = messages[-1]['content']
        label = json.loads(answer)
        if label != item['label']:
            raise ValueError('training/gold label mismatch')
        # Exactly the unmasked answer used by sft.encode; no prompt or padding.
        count = len(tokenizer.encode(answer + '<|im_end|>', add_special_tokens=False).ids)
        result.append({'id': row['id'], 'intent': label['intent'], 'family': item['family'],
                       'changed': row['id'].startswith('v4-'), 'tokens': count})
    return result


def coefficient_audit(examples, *, seed=20261019, batch=16, epochs=2):
    if not examples or len({e['id'] for e in examples}) != len(examples):
        raise ValueError('nonempty unique examples required')
    if any(type(e['tokens']) is not int or e['tokens'] <= 0 for e in examples):
        raise ValueError('positive unmasked token counts required')
    if type(batch) is not int or batch < 1 or type(epochs) is not int or epochs < 1:
        raise ValueError('positive batch and epochs required')
    def keys(e):
        return ['intent:' + e['intent'], 'family:' + e['family']] + (
            ['changed:' + e['family']] if e['changed'] else [])
    lengths, mass = defaultdict(list), defaultdict(float)
    for e in examples:
        for key in keys(e): lengths[key].append(e['tokens'])
    rng, order_hash, steps = random.Random(seed), hashlib.sha256(), 0
    for _ in range(epochs):
        order = list(range(len(examples))); rng.shuffle(order)
        order_hash.update(json.dumps([examples[i]['id'] for i in order]).encode())
        for start in range(0, len(order), batch):
            items = [examples[i] for i in order[start:start + batch]]
            total = sum(e['tokens'] for e in items)
            for e in items:
                for key in keys(e): mass[key] += e['tokens'] / total
            steps += 1
    total_tokens = sum(e['tokens'] for e in examples)
    return {'rows': len(examples), 'supervisedTokens': total_tokens, 'steps': steps,
        'seed': seed, 'batch': batch, 'epochs': epochs, 'batchOrderSha256': order_hash.hexdigest(),
        'groups': {key: {'rows': len(values), 'tokens': sum(values),
            'meanTokens': round(sum(values) / len(values), 6),
            'rowShare': round(len(values) / len(examples), 6),
            'tokenShare': round(sum(values) / total_tokens, 6),
            'fixedBatchLossCoefficientShare': round(mass[key] / steps, 6)}
            for key, values in sorted(lengths.items())}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tokenizer', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    # Only the tokenizer library is imported; no torch/model/download path.
    import tokenizers
    expected = {line.split()[1]: line.split()[0] for line in (M4 / 'train/base-model.sha256').read_text().splitlines()}
    if sha(args.tokenizer / 'tokenizer.json') != expected['tokenizer.json']:
        raise ValueError('frozen tokenizer mismatch')
    protocol_path = M4 / 'train/protocol-v4.json'
    protocol = json.loads(protocol_path.read_text())
    settings, sft_hash = frozen_training_settings(protocol, (M4 / 'train/sft.py').read_bytes())
    manifest = json.loads((M4 / 'data/v4-manifest.json').read_text())
    data = M4 / 'data/generated/v4'
    for name in ('train.jsonl', 'train.gold.jsonl'):
        if sha(data / name) != manifest['files'][name]['sha256']:
            raise ValueError('frozen training data mismatch: ' + name)
    read = lambda path: [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]
    tokenizer = tokenizers.Tokenizer.from_file(str(args.tokenizer / 'tokenizer.json'))
    examples = answer_examples(read(data / 'train.jsonl'), read(data / 'train.gold.jsonl'), tokenizer)
    report = {'mode': 'post-result CPU-tokenization diagnostic', 'newModelCalls': 0,
        'tokenizerRuntime': tokenizers.__version__, 'tokenizerSha256': expected['tokenizer.json'],
        'dataSha256': sha(data / 'train.jsonl'), 'trainingSourceLfSha256': sft_hash,
        'protocolLfSha256': hashlib.sha256(protocol_path.read_bytes().replace(b'\r\n', b'\n')).hexdigest(),
        **coefficient_audit(examples, **settings),
        'limitation': 'Scalar loss-coefficient imbalance is observed, not proof of gradient impact or a causal quality explanation. Token difficulty and repeated JSON syntax also matter. No data, loss, weights or candidate changed.'}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x', encoding='utf-8') as f:
        f.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'groups'}))


if __name__ == '__main__':
    main()
