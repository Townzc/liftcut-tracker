"""Compare fixed weights under one CPU runtime, with a predeclared Q8 fallback.

No training or downloads. Outputs and manifests are exclusive-create; old
results cannot be overwritten. Raw JSON agreement is measured before any guard.
"""
import argparse
import ctypes
import hashlib
import json
import platform
import time
from pathlib import Path


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''): h.update(block)
    return h.hexdigest()


def read(path):
    rows = [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]
    if not rows or any(not isinstance(r.get('id'), str) or not r['id'] for r in rows) or len({r['id'] for r in rows}) != len(rows):
        raise ValueError('nonempty, unique IDs required')
    return rows


def parsed(text):
    try:
        value = json.loads(text, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))
        return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')) if isinstance(value, dict) else None
    except (TypeError, ValueError): return None


def agreement(a, b):
    if not a or set(a) != set(b): raise ValueError('prediction ID sets differ')
    same = sum(parsed(a[k]) is not None and parsed(a[k]) == parsed(b[k]) for k in a)
    return {'same':same, 'total':len(a), 'rate':same/len(a)}


def main():
    ap = argparse.ArgumentParser()
    for name in ['f16', 'q4', 'tokenizer', 'input', 'reference', 'out']: ap.add_argument('--'+name, required=True)
    ap.add_argument('--threads', type=int, default=4)
    args = ap.parse_args()
    if not 1 <= args.threads <= 16: raise ValueError('threads outside 1..16')
    rows, refs = read(args.input), read(args.reference)
    reference = {r['id']:r['output'] for r in refs}
    if set(reference) != {r['id'] for r in rows}: raise ValueError('reference/input ID mismatch')
    if any(any(m['role'] not in ('user','system') for m in row['messages']) for row in rows):
        raise ValueError('evaluation input must not contain answers')
    out = Path(args.out); out.mkdir(parents=True, exist_ok=False)
    def save(name, data):
        with (out/name).open('x',encoding='utf-8') as f: f.write(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    import llama_cpp
    from transformers import AutoTokenizer
    protocol = {'version':1,'purpose':'same-engine diagnostic on previously seen evaluation data, not independent acceptance',
        'startedAt':time.time(),'platform':platform.platform(),'llamaCppPython':llama_cpp.__version__,
        'scriptSha256':digest(__file__),'inputSha256':digest(args.input),'referenceSha256':digest(args.reference),
        'f16Sha256':digest(args.f16),'q4Sha256':digest(args.q4),
        'temperature':0,'repeatPenalty':1,'threads':args.threads,'prefillThreads':args.threads,'maxNewTokens':256,
        'resetBetweenItems':True,'inputTokens':'HF and GGUF IDs must match, passed as token IDs without added BOS',
        'minAgreement':0.95,'q8Trigger':'Q4 below 0.95 against either f16 or original HF; no threshold change'}
    save('protocol.json',protocol)
    tok = AutoTokenizer.from_pretrained(args.tokenizer,local_files_only=True)
    prompts = [tok.apply_chat_template(r['messages'],tokenize=False,add_generation_prompt=True,enable_thinking=False) for r in rows]
    token_ids = [tok.encode(p,add_special_tokens=False) for p in prompts]
    save('inputs.json',{'ids':[r['id'] for r in rows], 'tokenIdsSha256':hashlib.sha256(json.dumps(token_ids).encode()).hexdigest()})
    outputs = {}
    conditions = {}
    def predict(name, path):
        start=time.monotonic()
        llm=llama_cpp.Llama(model_path=str(path),n_ctx=1024,n_threads=args.threads,n_threads_batch=args.threads,seed=0,verbose=False)
        try:
            if any(llm.tokenize(p.encode(),add_bos=False,special=True)!=ids for p,ids in zip(prompts,token_ids)):
                raise ValueError('GGUF tokenizer does not match input token IDs')
            load_ms=(time.monotonic()-start)*1000
            result={}; truncated=0
            with (out/f'{name}.jsonl').open('x',encoding='utf-8') as f:
                for i,(row,ids) in enumerate(zip(rows,token_ids)):
                    llm.reset(); start=time.monotonic()
                    response=llm.create_completion(ids,max_tokens=256,temperature=0.0,repeat_penalty=1.0,
                        frequency_penalty=0.0,presence_penalty=0.0,stop=['<|im_end|>'],seed=0)
                    choice=response['choices'][0]; text=choice['text'].strip()
                    item={'id':row['id'],'output':text,'latencyMs':round((time.monotonic()-start)*1000,1),
                        'finishReason':choice['finish_reason'],'usage':response['usage']}
                    f.write(json.dumps(item,ensure_ascii=False)+'\n'); f.flush(); result[row['id']]=text
                    truncated += choice['finish_reason']=='length'
                    if i%100==0: print(name,i+1,len(rows),item['latencyMs'],flush=True)
            conditions[name]={'fileSha256':digest(path),'predictionSha256':digest(out/f'{name}.jsonl'),'loadAndTokenAuditMs':load_ms,
                'inputTokensMatch':True,'truncated':truncated}
            outputs[name]=result
        finally: llm.close()
    predict('f16',args.f16)
    predict('q4',args.q4)
    comparisons={'f16VsHF':agreement(outputs['f16'],reference),'q4VsF16':agreement(outputs['q4'],outputs['f16']),
        'q4VsHF':agreement(outputs['q4'],reference)}
    if min(comparisons['q4VsF16']['rate'],comparisons['q4VsHF']['rate']) < 0.95:
        q8=out/'parser-q8_0.gguf'
        params=llama_cpp.llama_model_quantize_default_params();params.ftype=llama_cpp.LLAMA_FTYPE_MOSTLY_Q8_0;params.nthread=args.threads
        if llama_cpp.llama_model_quantize(str(args.f16).encode(),str(q8).encode(),ctypes.byref(params)):
            raise RuntimeError('Q8 quantization failed')
        predict('q8',q8)
        comparisons.update(q8VsF16=agreement(outputs['q8'],outputs['f16']),q8VsHF=agreement(outputs['q8'],reference))
    passed=[name for name in ['q4','q8'] if name in outputs and conditions[name]['truncated']==0
        and min(comparisons[f'{name}VsF16']['rate'],comparisons[f'{name}VsHF']['rate'])>=0.95]
    save('report.json',{'comparisons':comparisons,'conditions':conditions,'quantizationCandidatesPassing':passed,
        'qualityPassed':False,'enabledInProduct':False,'finishedAt':time.time()})
    print(json.dumps(comparisons),flush=True)
    if not passed: raise SystemExit(3)


if __name__=='__main__': main()
