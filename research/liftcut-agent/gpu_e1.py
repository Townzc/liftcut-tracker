"""One E1 full-task arm on the unchanged actual adapter; opt-in GPU only."""
import argparse
from pathlib import Path
import time
from e1_execution import ROOT, verify_worker, verify_parent, cases_for_run
from e1_protocol import ARMS, run_config
from e1_rollout import evaluate
from d2_execution import aware, runtime, utcnow
from gpu_counterfactual_diagnostics import verify_model
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.qwen_transport import QwenTransport
from server_workspace import dump_new


def main():
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for n in ('model-dir', 'model-manifest', 'run-dir', 'parent-run'):
        p.add_argument('--' + n, type=Path, required=True)
    p.add_argument('--expected-code-commit', required=True)
    p.add_argument('--arm', choices=ARMS, required=True)
    p.add_argument('--allow-gpu', action='store_true'); a = p.parse_args()
    if not a.allow_gpu: raise ValueError('explicit authorized GPU execution required')
    plan, b = verify_worker(a.run_dir, a.expected_code_commit)
    verify_parent(a.parent_run, plan); verify_model(a.model_dir, a.model_manifest)
    catalog = load_catalog(ROOT / 'benchmark/catalog.json')
    cases = cases_for_run(a.run_dir, plan, catalog)
    output = a.run_dir / 'evaluation' / a.arm
    if output.exists(): raise ValueError('cannot repeat an E1 arm')
    cfg = run_config()
    dump_new(output / 'manifest.json', {'binding': b, 'arm': a.arm, 'config': cfg.manifest()})
    start = time.monotonic()
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from peft import PeftModel, prepare_model_for_kbit_training
    observed = runtime(torch); set_seed(42); torch.set_num_threads(8)
    tokenizer = AutoTokenizer.from_pretrained(a.model_dir, local_files_only=True, trust_remote_code=False)
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4',
                              bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)
    base = AutoModelForCausalLM.from_pretrained(a.model_dir, local_files_only=True, trust_remote_code=False,
        dtype=torch.bfloat16, quantization_config=quant, device_map={'': 0}, attn_implementation='sdpa')
    base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=False)
    model = PeftModel.from_pretrained(base, a.parent_run / 'reference/final', is_trainable=False, local_files_only=True)
    model.eval(); model.config.use_cache = True
    dump_new(output / 'load.json', {'binding': b, 'arm': a.arm, 'runtime': observed,
                                   'at_utc': utcnow().isoformat(), 'seconds': time.monotonic() - start})
    def deadline():
        if utcnow() >= aware(b['work_cutoff']): raise TimeoutError('original E1 work cutoff')
    begin = time.monotonic()
    evaluate(output / 'episodes', cases, catalog,
             lambda callback: QwenTransport(model, tokenizer, cfg, callback), a.arm, before_case=deadline)
    dump_new(output / 'finished.json', {'binding': b, 'arm': a.arm, 'at_utc': utcnow().isoformat(),
        'inference_wall_seconds': time.monotonic() - begin,
        'total_wall_seconds_including_load': time.monotonic() - start, 'new_training': False})


if __name__ == '__main__': main()
