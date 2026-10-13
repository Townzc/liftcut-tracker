"""One preregistered I3 C/D first-decision arm; unchanged model, no training."""
import argparse
from pathlib import Path
import time
from d2_execution import runtime,utcnow
from gpu_counterfactual_diagnostics import verify_model
from i3_protocol import verify_worker,verify_parent_files,prepared_cases,ARMS
from i3_probe import evaluate
from liftcut_agent.qwen_transport import QwenTransport
from state_coverage import config
from server_workspace import dump_new


def main():
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('model-dir','model-manifest','d2-dir','run-dir','parent-run'):p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--expected-code-commit',required=True);p.add_argument('--arm',choices=ARMS,required=True)
    p.add_argument('--allow-gpu',action='store_true');a=p.parse_args()
    if not a.allow_gpu:raise ValueError('explicit GPU execution required')
    plan,b=verify_worker(a.run_dir,a.expected_code_commit)
    verify_parent_files(a.parent_run,plan['reference']);verify_model(a.model_dir,a.model_manifest)
    cases=prepared_cases(a.d2_dir,plan)
    output=a.run_dir/'evaluation'/a.arm
    if output.exists():raise ValueError('fresh I3 arm required')
    dump_new(output/'manifest.json',{'binding':b,'arm':a.arm,'config':plan['config']})
    start=time.monotonic()
    import torch
    from transformers import AutoModelForCausalLM,AutoTokenizer,BitsAndBytesConfig,set_seed
    from peft import PeftModel,prepare_model_for_kbit_training
    observed=runtime(torch);set_seed(42);torch.set_num_threads(8)
    tokenizer=AutoTokenizer.from_pretrained(a.model_dir,local_files_only=True,trust_remote_code=False)
    quant=BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type='nf4',bnb_4bit_use_double_quant=True,
                            bnb_4bit_compute_dtype=torch.bfloat16)
    base=AutoModelForCausalLM.from_pretrained(a.model_dir,local_files_only=True,trust_remote_code=False,
        dtype=torch.bfloat16,quantization_config=quant,device_map={'':0},attn_implementation='sdpa')
    base=prepare_model_for_kbit_training(base,use_gradient_checkpointing=False)
    model=PeftModel.from_pretrained(base,a.parent_run/'reference/final',is_trainable=False,local_files_only=True)
    model.eval();model.config.use_cache=True
    dump_new(output/'load.json',{'binding':b,'arm':a.arm,'runtime':observed,'at_utc':utcnow().isoformat(),
                                'seconds':time.monotonic()-start})
    begin=time.monotonic()
    evaluate(output/'decisions',cases,lambda callback:QwenTransport(model,tokenizer,config(),callback),a.arm)
    dump_new(output/'finished.json',{'binding':b,'arm':a.arm,'at_utc':utcnow().isoformat(),
        'inference_wall_seconds':time.monotonic()-begin,'total_wall_seconds_including_load':time.monotonic()-start,
        'new_training':False})


if __name__=='__main__':main()
