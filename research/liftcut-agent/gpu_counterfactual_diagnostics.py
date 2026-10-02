"""One D2 arm on existing seed42 weights; GPU use is explicit and boot-bounded."""
import argparse
from contextlib import ExitStack
from dataclasses import asdict
from pathlib import Path
import time

from d2_execution import (ROOT, ARMS, PARSER, PRECISION, Clock, append_json, aware, binding,
    execute_arm, ordered_cases, read, runtime, tag_timings, verify_adapters, verify_plan)
from counterfactual_diagnostics import config, load_prepared
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.qwen_transport import QwenTransport
from server_workspace import command, dump_new, sha256


def verify_model(directory, manifest):
    expected = read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json")
    if read(manifest) != expected:
        raise ValueError("D2 model inventory differs from seed42")
    for name, item in expected["files"].items():
        path = directory / name
        # HF cached snapshot files can be symlinks to content-addressed blobs.
        if Path(name).name != name or sha256(path) != item["sha256"]:
            raise ValueError("D2 base model bytes differ")
    return expected


def manifest_for(plan, run_binding, arm, evidence_kind="model"):
    if arm not in ARMS or evidence_kind not in {"model", "scripted_contract"}:
        raise ValueError("unknown arm/evidence kind")
    return {"version": "d2-arm-v1", "arm": arm, "binding": run_binding,
        "evidence_kind": evidence_kind, "adapter_sha256": plan["adapter_sha256"][arm],
        "model": plan["model"], "precision": PRECISION, "parser": PARSER,
        "config": asdict(config()), "execution_case_ids": plan["execution_case_ids"],
        "calibration_case_ids": plan["calibration_case_ids"], "training_steps": 0, "test_episodes": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ("model-dir", "model-manifest", "prepared-dir", "adapters-root", "run-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--arm", choices=ARMS, required=True)
    parser.add_argument("--expected-code-commit", required=True)
    parser.add_argument("--allow-gpu", action="store_true")
    args = parser.parse_args()
    if not args.allow_gpu or command(["git", "status", "--porcelain"], ROOT):
        raise ValueError("explicit GPU flag and clean committed checkout required")
    if command(["git", "rev-parse", "HEAD"], ROOT) != args.expected_code_commit:
        raise ValueError("D2 execution commit mismatch")
    plan = verify_plan(args.prepared_dir)
    opening = read(args.run_dir / "opening.json")
    expected = binding(plan, args.expected_code_commit, opening["booted_at_proxy"])
    if opening["binding"] != expected or opening["evidence_kind"] != "model":
        raise ValueError("worker must belong to the existing model window")
    clock = Clock()
    work = aware(expected["work_cutoff"])
    if clock.now() >= work:
        raise TimeoutError("original work cutoff passed")
    output = args.run_dir / "evaluation" / args.arm
    if output.exists():
        raise ValueError("never repeat a started D2 arm")
    model_inventory = verify_model(args.model_dir, args.model_manifest)
    verify_adapters(args.adapters_root)
    dump_new(output / "manifest.json", manifest_for(plan, expected, args.arm))
    previous_timings, previous_loads = [], []
    cases = ordered_cases(load_prepared(args.prepared_dir))
    for arm in ARMS[:ARMS.index(args.arm)]:
        previous = args.run_dir / "evaluation" / arm
        if read(previous / "report.json")["completed_attempts"] != 80:
            raise ValueError("cannot proceed after a partial earlier arm")
        previous_timings.extend(tag_timings(cases, read_jsonl(previous / "episodes.jsonl"), read_jsonl(previous / "generations.jsonl")))
        previous_loads.append(read(previous / "load.json")["seconds"])
    start = time.monotonic()
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from peft import PeftModel, prepare_model_for_kbit_training
    observed_runtime = runtime(torch)
    set_seed(42)
    torch.set_num_threads(8)
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False)
    quantization = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                                     bnb_4bit_compute_dtype=torch.bfloat16)
    model = AutoModelForCausalLM.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False,
        dtype=torch.bfloat16, quantization_config=quantization, device_map={"": 0}, attn_implementation="sdpa")
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=False)
    model = PeftModel.from_pretrained(model, args.adapters_root / args.arm / "final", is_trainable=False, local_files_only=True)
    model.eval()
    model.config.use_cache = True
    load_seconds = time.monotonic() - start
    dump_new(output / "load.json", {"seconds": load_seconds, "runtime": observed_runtime,
        "model_inventory_verified": model_inventory == plan["model"], "at_utc": clock.now().isoformat()})
    timings = []
    with ExitStack() as stack:
        streams = {n: stack.enter_context((output / (n + ".jsonl")).open("x", encoding="utf-8", newline="\n"))
                   for n in ("generations", "calls", "episodes", "estimates")}

        def generation(row):
            timings.append(row)
            append_json(streams["generations"], row)

        transport = QwenTransport(model, tokenizer, config(), generation)
        report, _ = execute_arm(cases, load_catalog(ROOT / "benchmark/catalog.json"),
            transport, args.arm, work, load_seconds, clock=clock, timing_rows=timings,
            previous_timings=previous_timings, previous_loads=previous_loads,
            on_episode=lambda e: append_json(streams["episodes"], e),
            on_call=lambda identity, c: append_json(streams["calls"], {"case_id": identity, "call": c}),
            on_estimate=lambda e: append_json(streams["estimates"], e))
    dump_new(output / "report.json", report)
    print({"arm": args.arm, "completed": report["completed_attempts"], "stop": report["stop_reason"]}, flush=True)
    return 0 if report["completed_attempts"] == 80 else 2


if __name__ == "__main__":
    raise SystemExit(main())
