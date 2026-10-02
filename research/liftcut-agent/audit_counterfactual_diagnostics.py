"""Replay D2 native responses, environment, token IDs and original adapter bytes."""
import argparse
from collections import Counter
from pathlib import Path

from d2_execution import (ARMS, ROOT, aware, binding, deadlines, expected_runtime, ordered_cases,
                          calibrated, partial_summary, read, remaining_estimate, request_caps, tag_timings, verify_adapters, verify_plan)
from counterfactual_diagnostics import load_prepared, replay, summary
from gpu_counterfactual_diagnostics import manifest_for
from prepare_counterfactual_diagnostics import load_tokenizer
from audit_controlled import audit_generations
from audit_coverage_tokens import audit_calls
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from server_workspace import dump_new, sha256


def validate_opening(opening, plan, *, allow_scripted=False):
    expected = binding(plan, opening["binding"]["code_commit"], opening["booted_at_proxy"])
    kind = "scripted_contract" if allow_scripted else "model"
    if (opening["binding"] != expected or opening["evidence_kind"] != kind
            or opening["budget"] != plan["budget"]):
        raise ValueError("D2 opening/budget/evidence kind mismatch")
    deadlines(opening["booted_at_proxy"], aware(opening["started_at_utc"]))
    return expected


def audit_arm(directory, arm, cases, catalog, plan, bind, tokenizer, *, kind="model", previous_timings=(), previous_loads=()):
    if read(directory / "manifest.json") != manifest_for(plan, bind, arm, kind):
        raise ValueError("D2 arm provenance differs")
    episodes = read_jsonl(directory / "episodes.jsonl")
    replay(cases, catalog, episodes)
    report = read(directory / "report.json")
    expected = partial_summary(cases, episodes, None)
    if any(report.get(k) != v for k, v in expected.items()) or report["full_summary"] != summary(cases, episodes) or report["stop_reason"] is not None:
        raise ValueError("D2 score/complete denominator differs from replay")
    calls = [{"case_id": e["case_id"], "call": c} for e in episodes for c in e["calls"][e["scripted_prefix_calls"]:]]
    if calls != read_jsonl(directory / "calls.jsonl"):
        raise ValueError("durable calls contain missing/orphan/reordered entries")
    generations = read_jsonl(directory / "generations.jsonl")
    audit_generations([c["call"] for c in calls], generations)
    token_audit = audit_calls([c["call"] for c in calls], generations, tokenizer)
    if len(calls) > 136:
        raise ValueError("D2 per-arm request limit exceeded")
    estimates = read_jsonl(directory / "estimates.jsonl")
    if report["estimates"] != estimates or len(estimates) != 68 or any(e["stop"] for e in estimates):
        raise ValueError("missing or inconsistent budget forecast evidence")
    load = read(directory / "load.json")
    if (load["runtime"] != (expected_runtime() if kind == "model" else {"scripted_contract": True})
            or load["model_inventory_verified"] is not (kind == "model")):
        raise ValueError("runtime/model verification differs from evidence kind")
    previous_time = aware(load["at_utc"])
    if not aware(bind["booted_at_proxy"]) <= previous_time < aware(bind["work_cutoff"]):
        raise ValueError("model load outside original work window")
    for i, record in enumerate(estimates, 12):
        count = sum(len(e["calls"]) - e["scripted_prefix_calls"] for e in episodes[:i])
        timings = tag_timings(cases, episodes[:i], generations[:count])
        if not calibrated(timings):
            raise ValueError("insufficient actual calibration generations")
        future = len(ARMS) - ARMS.index(arm) - 1
        caps = request_caps(cases, i, future)
        derived = remaining_estimate([*previous_timings, *timings], max([load["seconds"], *previous_loads]), caps, future)
        now = aware(record["at_utc"])
        remaining = (aware(bind["work_cutoff"]) - now).total_seconds()
        derived.update(before_case_id=cases[i]["id"], at_utc=record["at_utc"], work_seconds_remaining=remaining,
                       stop=derived["estimated_remaining_seconds"] > remaining)
        if record != derived or now < previous_time or remaining <= 0:
            raise ValueError("budget forecast differs from recorded timings/original deadline")
        previous_time = now
    return {"panels": report["panels"], "tokens": token_audit, "episodes_replayed": 80,
            "case_results": [{"case_id": e["case_id"], "panel": c["panel"], "factors": c["factors"],
                "policy_failure": e["policy_failure"],
                "interface_errors": [x for x in e["trace"]["score"]["tool_errors"] if x in {"invalid_arguments", "unknown_tool"}],
                **e["decision"]} for c, e in zip(cases, episodes)]}


def g1_assessment(arms):
    families = {}
    for error in ("unknown_evidence", "session_count_mismatch"):
        rows = [r for r in arms["t"]["case_results"] if r["panel"] == "repair" and r["factors"]["error"] == error]
        if len(rows) != 2 or {r["factors"]["variant"] for r in rows} != {0, 1}:
            raise ValueError("G1 requires exactly the two preregistered variants")
        families[error] = {"behavior_trigger": all(r["policy_failure"] is None and not r["interface_errors"] and r["model_requests"] > 0 and
            (not r["target_field_repaired"] or r["premature_infeasible_before_repair"]) for r in rows),
            "cases": [r["case_id"] for r in rows]}
    return {"families": families, "any_behavior_trigger": any(v["behavior_trigger"] for v in families.values()),
        "training_authorized": False, "next_gate": "Paired-data audit and separate pilot budget; no automatic training"}


def audit(run, prepared, tokenizer_dir, adapters_root=None, *, metadata_only=False, allow_scripted=False):
    plan = verify_plan(prepared)
    opening = read(run / "opening.json")
    bind = validate_opening(opening, plan, allow_scripted=allow_scripted)
    if not metadata_only:
        if adapters_root is None:
            raise ValueError("original seed42 local adapter bytes required for restoration")
        verify_adapters(adapters_root)
    tokenizer, pinned = load_tokenizer(tokenizer_dir)
    cases, catalog = ordered_cases(load_prepared(prepared)), load_catalog(ROOT / "benchmark/catalog.json")
    early = read_jsonl(run / "early-index.jsonl")
    if [row["arm"] for row in early] != list(ARMS):
        raise ValueError("all four ordered early archives required")
    for row in early:
        path = "evaluation/" + row["arm"] + ".tar.gz"
        if (row["binding"] != bind or row["path"] != path or row["archive"] != row["arm"] + ".tar.gz"
                or (run / path).stat().st_size != row["bytes"] or sha256(run / path) != row["sha256"]):
            raise ValueError("early archive identity/integrity mismatch")
    arms, timings, loads = {}, [], []
    for arm in ARMS:
        directory = run / "evaluation" / arm
        arms[arm] = audit_arm(directory, arm, cases, catalog, plan, bind, tokenizer,
            kind=opening["evidence_kind"], previous_timings=timings, previous_loads=loads)
        timings.extend(tag_timings(cases, read_jsonl(directory / "episodes.jsonl"), read_jsonl(directory / "generations.jsonl")))
        loads.append(read(directory / "load.json")["seconds"])
    pairs = {}
    for a, b in (("s0", "t"), ("s0", "m"), ("m", "tm"), ("t", "tm")):
        pairs[a + "->" + b] = {}
        for panel in plan["panels"]:
            gains, losses = [], []
            for x, y in zip(arms[a]["case_results"], arms[b]["case_results"]):
                if x["case_id"] != y["case_id"]:
                    raise ValueError("D2 pair IDs do not match")
                if x["panel"] == panel:
                    if y["correct"] and not x["correct"]:
                        gains.append(x["case_id"])
                    if x["correct"] and not y["correct"]:
                        losses.append(x["case_id"])
            pairs[a + "->" + b][panel] = {"gains": gains, "losses": losses, "net": len(gains) - len(losses)}
    return {"version": "d2-audit-v1", "binding": bind, "evidence_kind": opening["evidence_kind"],
        "model_result": not allow_scripted, "episodes_replayed": 320, "adapter_files_verified": not metadata_only,
        "token_ids_verified": True, "early_archives_verified": 4, "tokenizer": pinned, "arms": arms, "paired": pairs,
        "g1": g1_assessment(arms), "training_steps": 0, "test_episodes": 0,
        "scope": "Fixed seed42 repeated-development diagnosis; no independent generalization or proof of model authorship"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ("run-dir", "prepared-dir", "tokenizer-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--adapters-root", type=Path)
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--allow-scripted-contract", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.run_dir, args.prepared_dir, args.tokenizer_dir, args.adapters_root,
                   metadata_only=args.metadata_only, allow_scripted=args.allow_scripted_contract)
    dump_new(args.output, result)
    print({k: result[k] for k in ("episodes_replayed", "model_result", "adapter_files_verified")})
