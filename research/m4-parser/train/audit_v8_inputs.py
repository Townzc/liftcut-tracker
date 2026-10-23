"""Audit the shared train/inference contract and unchanged paired payloads before model loading."""
import argparse
import hashlib
import json
from pathlib import Path


def hash_json(value, compact=True):
    return hashlib.sha256(json.dumps(value, separators=(',', ':') if compact else None).encode()).hexdigest()


def audit(data, tokenizer, systems, max_len=512):
    result, paired = {}, {}
    for name in ('A-train', 'D-train', 'A-dev', 'D-dev'):
        path = Path(data) / (name + '.jsonl')
        rows = [json.loads(s) for s in path.read_text(encoding='utf8').splitlines()]
        if not rows or len({r['id'] for r in rows}) != len(rows):
            raise ValueError('nonempty unique IDs required')
        tokens, masks, prefixes, answers = [], [], [], 0
        system = systems['enumSystem' if name.startswith('A-') else 'contractSystem']
        for row in rows:
            m = row['messages']
            if [v['role'] for v in m] != ['system', 'user', 'assistant'] or m[0]['content'] != system:
                raise ValueError('prompt contract mismatch')
            if set(json.loads(m[1]['content'])) != {'exercises', 'sentence'}:
                raise ValueError('training input allowlist changed')
            prompt = tokenizer.apply_chat_template(m[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
            p = tokenizer(prompt, add_special_tokens=False)['input_ids']
            a = tokenizer(m[-1]['content'] + '<|im_end|>', add_special_tokens=False)['input_ids']
            if not p or not a or len(p) + len(a) > max_len:
                raise ValueError('would truncate supervised tokens')
            if p != tokenizer.encode(prompt, add_special_tokens=False):
                raise ValueError('training/inference token IDs differ')
            tokens.append(p + a); masks.append([-100] * len(p) + a); prefixes.append(p); answers += len(a)
        paired[name] = [(r['id'], r['messages'][1:]) for r in rows]
        result[name] = {'rows': len(rows), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'maxTokens': max(map(len, tokens)), 'answerTokens': answers, 'tokenIdsSha256': hash_json(tokens),
            'maskSha256': hash_json(masks), 'promptTokenIdsSha256': hash_json(prefixes), 'truncated': 0}
    for a, d in (('A-train', 'D-train'), ('A-dev', 'D-dev')):
        if paired[a] != paired[d]:
            raise ValueError('IDs, sentences, catalogs, targets or order changed')
    return result


def audit_evaluation(paths, tokenizer, systems):
    result, paired = {}, {}
    for name, path in paths.items():
        rows = [json.loads(s) for s in Path(path).read_text(encoding='utf8').splitlines()]
        if not rows or len({r['id'] for r in rows}) != len(rows):
            raise ValueError('nonempty unique evaluation IDs required')
        tokens = []
        for row in rows:
            m = row['messages']
            if set(row) != {'id', 'messages'} or [v['role'] for v in m] != ['system', 'user']:
                raise ValueError('evaluation may contain only id/system/user')
            if m[0]['content'] != systems[name] or set(json.loads(m[1]['content'])) != {'exercises', 'sentence'}:
                raise ValueError('evaluation prompt/input allowlist mismatch')
            prompt = tokenizer.apply_chat_template(m, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            tokens.append(tokenizer.encode(prompt, add_special_tokens=False))
        if max(map(len, tokens)) + 256 > 1024:
            raise ValueError('would truncate evaluation')
        paired[name] = [(r['id'], r['messages'][1]) for r in rows]
        result[name] = {'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            'items': len(rows), 'maxInputTokens': max(map(len, tokens)), 'tokenIdsSha256': hash_json(tokens, compact=False)}
    if len(paired) != 2 or len({hash_json(v) for v in paired.values()}) != 1:
        raise ValueError('factorial inference payloads/order differ')
    return result


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    for key in ('data', 'eval-dir', 'tokenizer', 'expected', 'out'):
        ap.add_argument('--' + key, required=True)
    args = ap.parse_args()
    from transformers import AutoTokenizer
    protocol = json.loads(Path(args.expected).read_text(encoding='utf8'))
    tok = AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True)
    actual = audit(args.data, tok, protocol['promptContract'])
    inputs = audit_evaluation({n: Path(args.eval_dir) / ('all-eval-' + n + '.jsonl') for n in ('enum', 'contract')}, tok,
        {n: protocol['promptContract'][n + 'System'] for n in ('enum', 'contract')})
    if actual != protocol['trainingInputAudit'] or inputs != protocol['inputs']:
        raise ValueError('CPU-reviewed training/inference tokens differ')
    with Path(args.out).open('x', encoding='utf8') as f:
        json.dump({'training': actual, 'inputs': inputs}, f, indent=2); f.write('\n')
    print(json.dumps({'verified': True, 'modelCalls': 0}))
