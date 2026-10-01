"""R1 seed/arm/probe provenance, native/token replay and unchanged screening gates."""
import argparse
from pathlib import Path
import re

from state_coverage import ARMS, ROOT, config, original
from prepare_coverage_replication import VERSION, REVIEWED, RUN_SEEDS, arm_binding, run_binding, require_binding, schedules, verify_prepared
from audit_state_coverage import paired_comparisons
from audit_coverage_tokens import audit as audit_tokens
from liftcut_agent.interactive import digest
from prepare_state_diagnostics import verify_prepared as verify_diagnostics
from state_diagnostics import REVIEWED as DIAGNOSTIC_PLAN, load_prepared, replay, summary
from coverage_rollout import normal_report
from audit_controlled import audit_generations
from audit_recovery import audit_training_log
from gpu_state_diagnostics import PARSER, PRECISION, read
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.model_policy import encode
from server_workspace import dump_new, sha256


def audit(run, prepared, diagnostic, replication, seed, tokenizer_dir, *, verify_weights=True):
    plan = verify_prepared(prepared, diagnostic, replication, seed)
    verify_diagnostics(diagnostic)
    schedule, tokens, _ = schedules(prepared, seed)
    catalog, scenarios, cases = load_catalog(ROOT / "benchmark/catalog.json"), original("dev"), load_prepared(diagnostic)
    reports, commits, configs, initial_digests = {}, set(), [], set()
    model = read(ROOT / "reports/qwen-gpu-pilot-2026-09-28/model-files.json")
    for arm in ARMS:
        directory, training = run / "evaluation" / arm, run / "training" / arm
        manifest, trained, tm = read(directory / "manifest.json"), read(training / "report.json"), read(training / "manifest.json")
        expected = {"version": VERSION, "arm": arm, "model": model,
            "prepared_plan_sha256": sha256(REVIEWED), "diagnostic_plan_sha256": sha256(DIAGNOSTIC_PLAN),
            "parser_version": PARSER, "precision": PRECISION, "test_evaluation": False}
        if (any(manifest.get(k) != v for k, v in expected.items()) or not re.fullmatch(r"[0-9a-f]{40}", manifest["code_commit"])
                or tm["code_commit"] != manifest["code_commit"] or tm["model"] != model or tm["plan"] != plan
                or tm["arm"] != arm or trained["arm"] != arm or trained["reload_close"] is not True
                or trained["changed_adapter_tensors"] <= 0 or trained["adapter_sha256"] != manifest["adapter_sha256"]):
            raise ValueError("coverage model/training/evaluation provenance mismatch")
        binding = arm_binding(plan, manifest["code_commit"], arm)
        for artifact in (manifest, trained, tm):
            require_binding(artifact.get("binding"), binding)
        require_binding(read(run / "run-binding.json"), run_binding(plan, manifest["code_commit"]))
        initialization, probe = read(training / "initialization.json"), read(training / "memory-probe.json")
        require_binding(initialization.get("binding"), binding)
        require_binding(probe.get("binding"), binding)
        fingerprint = initialization.get("initial_adapter_sha256")
        if (initialization.get("initialization_seed") != seed or initialization.get("post_probe_seed") != seed
                or not isinstance(fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", fingerprint)
                or trained.get("initial_adapter_sha256") != fingerprint
                or probe.get("initial_parameters_unchanged") is not True or probe.get("optimizer_steps") != 0
                or probe.get("forward_backward_passed") is not True
                or probe.get("sequence_tokens") != plan["arms"][arm]["max_sequence_tokens"]):
            raise ValueError("replication initialization/probe mismatch")
        if any(row.get("binding_digest") != digest(binding) for row in read_jsonl(training / "training.jsonl")):
            raise ValueError("training log seed binding mismatch")
        for location in (training, directory):
            runtime = read(location / "runtime.json")
            require_binding(runtime.get("binding"), binding)
            if runtime.get("runtime") != plan["expected_runtime"]:
                raise ValueError("replication runtime differs from reviewed environment")
        initial_digests.add(fingerprint)
        commits.add(manifest["code_commit"])
        if read(directory / "config.json") != config().manifest()["config"]:
            raise ValueError("coverage policy configuration differs")
        audit_training_log(training, plan, [tokens[x["variant"]][x["index"]] for x in schedule[arm]], arm)
        if set(trained["adapter_sha256"]) != {"adapter_config.json", "adapter_model.safetensors"}:
            raise ValueError("unexpected trained adapter inventory")
        for name, expected_hash in trained["adapter_sha256"].items():
            if (verify_weights or name != "adapter_model.safetensors") and sha256(training / "final" / name) != expected_hash:
                raise ValueError("coverage adapter file mismatch")
        ac = read(training / "final/adapter_config.json")
        if any(ac[k] != v for k, v in {"r": 16, "lora_alpha": 32, "lora_dropout": 0.0,
                                      "bias": "none", "task_type": "CAUSAL_LM"}.items()):
            raise ValueError("coverage adapter configuration mismatch")
        configs.append({k: sorted(v) if isinstance(v, list) else v for k, v in ac.items()})
        panels = {}
        for panel in ("normal", "diagnostic"):
            path = directory / panel
            episodes = read_jsonl(path / "episodes.jsonl")
            if panel == "normal":
                result = normal_report(scenarios, catalog, episodes)
                indexed = [{"case_id": e["scenario_id"], "call": c} for e in episodes for c in e["calls"]]
            else:
                checked = replay(cases, catalog, episodes)
                result = {**summary(cases, episodes), "replay": checked}
                indexed = [{"case_id": e["case_id"], "call": c} for e in episodes for c in e["calls"][e["scripted_prefix_calls"]:]]
            if result != read(path / "report.json") or indexed != read_jsonl(path / "calls.jsonl"):
                raise ValueError("coverage report/durable calls differ from replay")
            generations = read_jsonl(path / "generations.jsonl")
            audit_generations([r["call"] for r in indexed], generations)
            result["actual_model_generations"] = sum(g.get("model_called", True) for g in generations)
            result["local_context_guards"] = sum(not g.get("model_called", True) for g in generations)
            panels[panel] = result
        reports[arm] = panels
    if len(commits) != 1 or len(initial_digests) != 1 or any(c != configs[0] for c in configs):
        raise ValueError("unmatched source commits, initial parameters or adapter configurations")
    token_audit = audit_tokens(run, tokenizer_dir)
    if token_audit != read(run / "generation-token-audit.json"):
        raise ValueError("saved token audit differs from independent reconstruction")
    return {"scope": "R1 single-seed repeated-development study; not independent generalization",
        "run_binding": run_binding(plan, next(iter(commits))), "initial_adapter_sha256": next(iter(initial_digests)),
        "token_ids_verified": True,
        "episodes_replayed": 124, "test_episodes": 0, "adapter_files_verified": verify_weights,
        "arms": reports, "comparisons": paired_comparisons(reports)}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir", "replication-dir", "tokenizer-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--seed", type=int, choices=RUN_SEEDS, required=True)
    p.add_argument("--metadata-only", action="store_true")
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = audit(args.run_dir, args.prepared_dir, args.diagnostic_dir, args.replication_dir, args.seed, args.tokenizer_dir, verify_weights=not args.metadata_only)
    if args.output:
        dump_new(args.output, result)
    print(encode({"episodes_replayed": result["episodes_replayed"], "comparisons": result["comparisons"]}))
