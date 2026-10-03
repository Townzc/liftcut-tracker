"""Fresh raw or view inference with the SAME preselected G4 control; no training."""
import argparse
from pathlib import Path
import time

from d2_execution import runtime, utcnow
from gpu_counterfactual_diagnostics import verify_model
from i1_protocol import ARMS, manifest_for, verify_worker
from i1_rollout import run_projected_panels
from liftcut_agent.qwen_transport import QwenTransport
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from prepare_counterfactual_diagnostics import verify_prepared as verify_d2
from server_workspace import dump_new
from state_coverage import config


def main():
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('model-dir', 'model-manifest', 'diagnostic-dir', 'd2-dir', 'run-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--arm', choices=ARMS, required=True)
    p.add_argument('--expected-code-commit', required=True)
    p.add_argument('--allow-gpu', action='store_true')
    a = p.parse_args()
    if not a.allow_gpu:
        raise ValueError('explicit GPU inference required')
    plan, bind = verify_worker(a.run_dir, a.expected_code_commit)
    verify_diagnostic(a.diagnostic_dir)
    verify_d2(a.d2_dir)
    verify_model(a.model_dir, a.model_manifest)
    output = a.run_dir / 'evaluation' / a.arm
    if output.exists():
        raise ValueError('fresh I1 arm evaluation required')
    dump_new(output / 'manifest.json', manifest_for(bind, plan, a.arm))
    start = time.monotonic()
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from peft import PeftModel, prepare_model_for_kbit_training
    observed = runtime(torch)
    set_seed(42)
    torch.set_num_threads(8)
    tokenizer = AutoTokenizer.from_pretrained(a.model_dir, local_files_only=True, trust_remote_code=False)
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True,
                              bnb_4bit_compute_dtype=torch.bfloat16)
    base = AutoModelForCausalLM.from_pretrained(a.model_dir, local_files_only=True, trust_remote_code=False,
        dtype=torch.bfloat16, quantization_config=quant, device_map={'': 0}, attn_implementation='sdpa')
    base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=False)
    model = PeftModel.from_pretrained(base, a.run_dir / 'reference/final', is_trainable=False, local_files_only=True)
    model.eval()
    model.config.use_cache = True
    dump_new(output / 'load.json', {'binding': bind, 'arm': a.arm, 'runtime': observed,
                                  'seconds': time.monotonic() - start, 'at_utc': utcnow().isoformat()})
    inference_start = time.monotonic()
    run_projected_panels(output, a.diagnostic_dir, a.d2_dir,
                        lambda panel, callback: QwenTransport(model, tokenizer, config(), callback), a.arm)
    dump_new(output / 'finished.json', {'binding': bind, 'arm': a.arm,
        'finished_at_utc': utcnow().isoformat(), 'inference_wall_seconds': time.monotonic() - inference_start,
        'total_wall_seconds_including_load': time.monotonic() - start, 'new_training': False})


if __name__ == '__main__':
    main()
