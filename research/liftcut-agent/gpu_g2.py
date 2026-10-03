"""Evaluate one fresh G2 adapter; fixed seed42 and all 111 registered states."""
import argparse
from pathlib import Path
import time

from d2_execution import PARSER, PRECISION, runtime, utcnow
from g2_execution import verify_worker
from g2_rollout import run_panels
from gpu_counterfactual_diagnostics import verify_model
from prepare_g2 import ARMS, ROOT
from prepare_state_diagnostics import verify_prepared as verify_diagnostics
from prepare_counterfactual_diagnostics import verify_prepared as verify_d2
from state_coverage import config
from liftcut_agent.qwen_transport import QwenTransport
from server_workspace import dump_new, sha256
from d2_execution import read


def manifest_for(bind, trained, kind='model'):
    return {'version': 'g2-evaluation-v1', 'binding': bind, 'evidence_kind': kind,
            'adapter_sha256': trained['adapter_sha256'], 'parser': PARSER, 'precision': PRECISION,
            'config': config().manifest()['config'], 'test_episodes': 0}


def main():
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('model-dir', 'model-manifest', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'run-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--arm', choices=ARMS, required=True)
    p.add_argument('--expected-code-commit', required=True)
    p.add_argument('--allow-gpu', action='store_true')
    args = p.parse_args()
    if not args.allow_gpu:
        raise ValueError('explicit GPU execution required')
    plan, bind = verify_worker(args.run_dir, args.prepared_dir, args.expected_code_commit, args.arm)
    verify_diagnostics(args.diagnostic_dir)
    verify_d2(args.d2_dir)
    verify_model(args.model_dir, args.model_manifest)
    training, output = args.run_dir / 'training' / args.arm, args.run_dir / 'evaluation' / args.arm
    trained, tm = read(training / 'report.json'), read(training / 'manifest.json')
    if (output.exists() or trained['binding'] != bind or tm['binding'] != bind
            or tm['plan'] != plan or tm['model'] != plan['model'] or not trained['reload_close']
            or trained['changed_adapter_tensors'] <= 0):
        raise ValueError('fresh evaluation and successful bound training required')
    if set(trained['adapter_sha256']) != {'adapter_config.json', 'adapter_model.safetensors'}:
        raise ValueError('exact adapter file inventory required')
    for name, value in trained['adapter_sha256'].items():
        if sha256(training / 'final' / name) != value:
            raise ValueError('trained adapter bytes differ')
    dump_new(output / 'manifest.json', manifest_for(bind, trained))
    start = time.monotonic()
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from peft import PeftModel, prepare_model_for_kbit_training
    observed = runtime(torch)
    set_seed(42)
    torch.set_num_threads(8)
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False)
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True,
                              bnb_4bit_compute_dtype=torch.bfloat16)
    base = AutoModelForCausalLM.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False,
        dtype=torch.bfloat16, quantization_config=quant, device_map={'': 0}, attn_implementation='sdpa')
    base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=False)
    model = PeftModel.from_pretrained(base, training / 'final', is_trainable=False, local_files_only=True)
    model.eval()
    model.config.use_cache = True
    dump_new(output / 'load.json', {'binding': bind, 'runtime': observed,
                                  'seconds': time.monotonic() - start, 'at_utc': utcnow().isoformat()})
    run_panels(output, args.diagnostic_dir, args.d2_dir,
               lambda panel, callback: QwenTransport(model, tokenizer, config(), callback))


if __name__ == '__main__':
    main()
