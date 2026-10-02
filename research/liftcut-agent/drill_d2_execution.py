"""CPU oracle operating drill, explicitly NOT model inference or model evidence.

Token IDs and environment transitions are real; generated text and 1s timings
are scripted. Complete recovery is tested only with actual local seed42 weights.
CI metadata mode never creates a complete recovery receipt.
"""
import argparse
from contextlib import ExitStack
from datetime import timedelta
import json
from pathlib import Path

from d2_execution import (ARMS, BUDGET, ROOT, append_json, aware, binding, execute_arm, ordered_cases,
                          read, tag_timings, verify_adapters, verify_plan)
from counterfactual_diagnostics import config, load_prepared
from gpu_counterfactual_diagnostics import manifest_for
from audit_counterfactual_diagnostics import audit
from restore_counterfactual_diagnostics import restore_d2
from d2_receipt_transfer import validate_index, validate_receipt
from run_counterfactual_window import finalize, observed_progress
from run_recovery_window import archive_run
from prepare_counterfactual_diagnostics import load_tokenizer
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.model_policy import Reply, encode
from liftcut_agent.qwen_transport import parse_tool_message
from liftcut_agent.trajectories import normalize_messages
from server_workspace import dump_new, sha256


class ScriptClock:
    def __init__(self):
        self.value = aware("2026-10-02T12:01:00+00:00")

    def now(self):
        return self.value


class ScriptedNativeTransport:
    """Oracle actions in Qwen native syntax; model_called only exercises schema."""
    def __init__(self, cases, tokenizer, record):
        self.cases, self.tokenizer, self.record = cases, tokenizer, record
        self.case_index, self.action_index, self.number = 0, 0, 0

    def advance(self):
        self.case_index, self.action_index = self.case_index + 1, 0

    def complete(self, payload):
        case = self.cases[self.case_index]
        actions = case["expected"].get("reference_actions", [case["expected"].get("reference_action")])
        selected = actions[self.action_index]
        self.action_index, self.number = self.action_index + 1, self.number + 1
        text = "<tool_call>" + encode({"name": selected["tool"], "arguments": selected["arguments"]}) + "</tool_call><|im_end|>"
        ids = self.tokenizer.encode(text, add_special_tokens=False)
        prompt = self.tokenizer.apply_chat_template(normalize_messages(payload["messages"]), tools=payload["tools"],
                                                    tokenize=True, add_generation_prompt=True)
        assert len(prompt) + 512 <= 4096 and len(ids) <= 512 and ids[-1] == self.tokenizer.eos_token_id
        raw = self.tokenizer.decode(ids, skip_special_tokens=False)
        message = parse_tool_message(raw, self.number)
        self.record({"request_number": self.number, "raw_text": raw, "output_ids": ids,
            "prompt_tokens": len(prompt), "model_called": True, "parse_error": None, "eos_reached": True,
            "elapsed_seconds": 1.0})
        body = {"model": config().model, "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls"}],
                "usage": {"prompt_tokens": len(prompt), "completion_tokens": len(ids), "total_tokens": len(prompt) + len(ids)}}
        return Reply(encode(body), 200, None, 1.0)


def drill(output, prepared, tokenizer_dir, adapters=None):
    if output.exists():
        raise ValueError("new CPU drill directory required")
    plan = verify_plan(prepared)
    if adapters is not None:
        verify_adapters(adapters)
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    cases, catalog = ordered_cases(load_prepared(prepared)), load_catalog(ROOT / "benchmark/catalog.json")
    clock, boot = ScriptClock(), "2026-10-02T12:00:00+00:00"
    bind = binding(plan, "0" * 40, boot)  # Explicit synthetic commit; not a GPU execution reference.
    run = output / "SYNTHETIC-CONTRACT-ONLY"
    dump_new(run / "opening.json", {"binding": bind, "booted_at_proxy": boot, "budget": BUDGET,
                                    "evidence_kind": "scripted_contract", "started_at_utc": clock.now().isoformat()})
    all_timings, loads = [], []
    for arm in ARMS:
        directory = run / "evaluation" / arm
        dump_new(directory / "manifest.json", manifest_for(plan, bind, arm, "scripted_contract"))
        dump_new(directory / "load.json", {"seconds": 0., "runtime": {"scripted_contract": True},
                  "model_inventory_verified": False, "at_utc": clock.now().isoformat()})
        timings = []
        with ExitStack() as stack:
            streams = {n: stack.enter_context((directory / (n + ".jsonl")).open("x", encoding="utf-8", newline="\n"))
                       for n in ("episodes", "generations", "calls", "estimates")}
            def record(row):
                timings.append(row)
                append_json(streams["generations"], row)
            transport = ScriptedNativeTransport(cases, tokenizer, record)
            def episode(row):
                append_json(streams["episodes"], row)
                transport.advance()
            report, episodes = execute_arm(cases, catalog, transport, arm, aware(bind["work_cutoff"]), 0., clock=clock,
                timing_rows=timings, previous_timings=all_timings, previous_loads=loads,
                on_episode=episode, on_call=lambda identity, call: append_json(streams["calls"], {"case_id": identity, "call": call}),
                on_estimate=lambda row: append_json(streams["estimates"], row))
        assert report["completed_attempts"] == 80 and report["stop_reason"] is None
        dump_new(directory / "report.json", report)
        backup = archive_run(directory)
        with (run / "early-index.jsonl").open("a", encoding="utf-8", newline="\n") as stream:
            append_json(stream, {"event": "arm_archive", "arm": arm, "binding": bind,
                "path": "evaluation/" + backup["archive"], **backup, "at_utc": clock.now().isoformat()})
        all_timings.extend(tag_timings(cases, episodes, timings))
        loads.append(0.)
    result = audit(run, prepared, tokenizer_dir, adapters, metadata_only=adapters is None, allow_scripted=True)
    if any(p["correct"] != p["total"] for arm in result["arms"].values() for p in arm["panels"].values()):
        raise AssertionError("native oracle contract is not correct for every registered case")
    dump_new(run / "comparison.json", result)
    dump_new(run / "presence.json", observed_progress(run, cases))
    receipt, shutdowns = None, []
    if adapters is not None:
        def recover(_seconds):
            nonlocal receipt
            if receipt is None:
                index = read(run / "backup-index.json")
                # Normal production entry point must reject this synthetic archive.
                try:
                    validate_index(index, bind)
                except ValueError:
                    pass
                else:
                    raise AssertionError("scripted archive accepted as model evidence")
                restored = output / "restored"
                receipt = restore_d2(run / "evidence.tar.gz", restored, index, prepared, tokenizer_dir, adapters,
                                     allow_scripted=True)
                # Local stand-in for transport: bytes come only from successful restorer.
                actual = (restored / "off-instance-backup.json").read_bytes()
                validate_receipt(actual, index, bind, kind="scripted_contract")
                with (run / "off-instance-backup.json").open("xb") as stream:
                    stream.write(actual)
        finalize(run, "complete", [], bind, aware(bind["hard_cutoff"]), clock, evidence_kind="scripted_contract",
                 sleep=recover, shutdown=lambda: shutdowns.append("stub-only") or 0)
        if receipt is None or not read(run / "backup-copy-status.json")["off_instance_acknowledged"] or shutdowns != ["stub-only"]:
            raise AssertionError("CPU recovery/ack/shutdown drill did not finish")
    report = {"version": "d2-operating-drill-v1", "execution_contract_digest": bind["execution_plan_sha256"],
        "evidence_kind": "scripted_contract", "model_result": False,
        "new_model_calls": 0, "gpu_calls": 0, "real_shutdown_calls": 0, "test_episodes": 0,
        "episodes_replayed": 320, "scripted_native_responses": len(all_timings), "real_token_ids_reconstructed": True,
        "budget_forecasts_recomputed": 272, "actual_seed42_adapter_bytes_verified": adapters is not None,
        "full_restore_and_local_receipt_consumption": receipt is not None,
        "reference_panel_counts": {a: result["arms"][a]["panels"] for a in ARMS},
        "sftp_tested_by_this_drill": False, "paired": result["paired"], "g1": result["g1"],
        "scope": "CPU oracle text and synthetic timings, not model latency/accuracy. SFTP faults are separate unit tests; live startup remains conditional."}
    dump_new(output / "drill-report.json", report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ("output-dir", "prepared-dir", "tokenizer-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--adapters-root", type=Path)
    args = parser.parse_args()
    print(json.dumps(drill(args.output_dir, args.prepared_dir, args.tokenizer_dir, args.adapters_root), indent=2))
