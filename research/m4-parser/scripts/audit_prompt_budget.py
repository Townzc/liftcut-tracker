"""Read-only tokenizer inventory of existing prompts; no training or generation.

The legacy cloud prompt is measured as a hypothetical replacement, not selected
as a new candidate. All sentences, catalogs and answers remain in memory only.
"""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    for key in ('data', 'tokenizer', 'out'):
        ap.add_argument('--' + key, required=True)
    args = ap.parse_args()
    from transformers import AutoTokenizer
    root = Path(__file__).resolve().parents[1]
    sha = lambda b: hashlib.sha256(b).hexdigest()
    protocol_bytes = (root / 'train/protocol-v7.json').read_bytes().replace(b'\r\n', b'\n')
    protocol = json.loads(protocol_bytes)
    source = (root / 'src/prompt.ts').read_bytes().replace(b'\r\n', b'\n')
    prefix = 'export const SYSTEM_PROMPT = `'
    if source.decode().count(prefix) != 1:
        raise ValueError('Unexpected legacy prompt declaration')
    legacy = source.decode().split(prefix)[1].split('`;')[0]
    if '${' in legacy:
        raise ValueError('Do not interpret a dynamic template as literal text')
    tok = AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True)
    systems = {'aligned': protocol['promptContract']['alignedSystem'], 'legacy_cloud': legacy}
    result = {}
    for split in ('S-train', 'dev'):
        content = (Path(args.data) / (split + '.jsonl')).read_bytes()
        expected = protocol['trainingInputAudit'][split]
        if sha(content) != expected['sha256']:
            raise ValueError('Reviewed input bytes differ')
        rows = [json.loads(line) for line in content.decode().splitlines()]
        result[split] = {}
        for name, system in systems.items():
            tokens, lengths = [], []
            for row in rows:
                messages = row['messages']
                if [m['role'] for m in messages] != ['system', 'user', 'assistant']:
                    raise ValueError('Unexpected roles')
                if messages[0]['content'] != systems['aligned']:
                    raise ValueError('Unexpected reviewed system')
                prompt = tok.apply_chat_template([{'role': 'system', 'content': system}, messages[1]],
                    tokenize=False, add_generation_prompt=True, enable_thinking=False)
                p = tok(prompt, add_special_tokens=False)['input_ids']
                a = tok(messages[2]['content'] + '<|im_end|>', add_special_tokens=False)['input_ids']
                tokens.append(p + a); lengths.append(len(p) + len(a))
            token_hash = sha(json.dumps(tokens, separators=(',', ':')).encode())
            if name == 'aligned' and (token_hash != expected['tokenIdsSha256'] or len(rows) != expected['rows']):
                raise ValueError('Tokenizer does not reproduce the reviewed sequence')
            result[split][name] = {'rows': len(rows), 'maxTokens': max(lengths),
                'exceeds512': sum(n > 512 for n in lengths), 'tokenIdsSha256': token_hash}
    report = {'mode': 'Post-result CPU prompt-size inventory; no candidate selection or efficacy evidence',
        'newModelCalls': 0, 'trainingRuns': 0, 'trainingFilesWritten': 0, 'gpuReady': False,
        'protocolLfSha256': sha(protocol_bytes), 'legacySourceLfSha256': sha(source),
        'scriptLfSha256': sha(Path(__file__).read_bytes().replace(b'\r\n', b'\n')),
        'systemsSha256': {k: sha(v.encode()) for k, v in systems.items()},
        'tokenizerFiles': {n: sha((Path(args.tokenizer) / n).read_bytes()) for n in ('tokenizer.json', 'tokenizer_config.json')},
        'results': result,
        'limitations': 'Existing synthetic train/dev only. No private originals, derivatives or model outputs used as training data. Legacy prompt is not an accepted new contract; token fit cannot prove semantic correctness.'}
    with Path(args.out).open('x', encoding='utf8') as f:
        json.dump(report, f, indent=2); f.write('\n')
    print(json.dumps({'results': result, 'newModelCalls': 0, 'gpuReady': False}))


if __name__ == '__main__':
    main()
