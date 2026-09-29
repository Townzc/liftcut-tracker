"""Check four explicit scripted proposal repairs; these are not model recoveries."""
import argparse
from copy import deepcopy
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.environment import PlanEnvironment
from liftcut_agent.interactive import digest
from server_workspace import dump_new, sha256
from state_coverage import ROOT, original

CASES = (("t", "r2-05-missing_time", "evidence"),
         ("t", "r2-05-missing_equipment", "evidence"),
         ("t", "r2-05-missing_days", "evidence"),
         ("m", "r2-05-missing_days", "sessions"))


def check_repair(scenario, catalog, episode, kind):
    """Replay through the last invalid validation, then edit only an observed field."""
    if episode["scenario_id"] != scenario["id"] or episode["trace"]["score"]["passed"]:
        raise ValueError("repair illustration requires the selected failed task")
    events = episode["trace"]["events"]
    invalid = [e for e in events if e["actor"] == "agent" and e["action"]["tool"] == "validate_plan"
               and e["observation"]["ok"] and e["observation"]["result"]["valid"] is False]
    if not invalid:
        raise ValueError("no invalid validation to diagnose")
    last = invalid[-1]
    prefix = events[:last["index"] + 1]
    env = PlanEnvironment(scenario, catalog)
    env.reset(episode_id=episode["trace"]["episode_id"])
    observed_inputs, known_ids = None, set()
    for event in prefix:
        result = (env.step(event["action"]) if event["actor"] == "agent" else env.user_event(event["action"]))
        if result != event["observation"] or env.export_trace()["events"][-1] != event:
            raise ValueError("repair prefix does not reproduce the recorded state")
        action = event["action"]
        if event["actor"] == "agent" and result["ok"]:
            if action["tool"] == "get_context":
                observed_inputs = result["result"]["input"]
                known_ids.update(r["id"] for r in observed_inputs["records"])
            elif action["tool"] == "get_memories":
                known_ids.update(r["id"] for r in result["result"]["memories"])
    rejected = last["action"]["arguments"]["plan"]
    repaired = deepcopy(rejected)
    if kind == "evidence":
        if last["observation"]["result"]["issues"] != ["unknown_evidence"]:
            raise ValueError("illustration no longer isolates unknown evidence")
        repaired["evidence_ids"] = [i for i in rejected["evidence_ids"] if i in known_ids]
        edited = "evidence_ids"
        basis = {"known_ids_from_observed_tools": sorted(known_ids)}
    elif kind == "sessions":
        if observed_inputs is None or last["observation"]["result"]["issues"] != ["session_count_mismatch"]:
            raise ValueError("illustration no longer isolates session count")
        count = observed_inputs["constraints"]["sessions_per_week"]
        if type(count) is not int or not 0 < count < len(rejected["sessions"]):
            raise ValueError("observed constraint does not justify the selected session repair")
        repaired["sessions"] = deepcopy(rejected["sessions"][:count])
        edited = "sessions"
        basis = {"sessions_per_week_from_observed_context": count}
    else:
        raise ValueError("unknown explicit repair kind")
    if (repaired == rejected or {k: v for k, v in repaired.items() if k != edited} !=
            {k: v for k, v in rejected.items() if k != edited}):
        raise ValueError("repair must change exactly the selected plan field")
    before = env.snapshot()
    result = env.step({"tool": "validate_plan", "arguments": {"plan": repaired}})
    if (not result["ok"] or result["result"]["valid"] is not True or result["result"]["issues"]
            or env.snapshot()["writes"] != before["writes"] or env.done):
        raise ValueError("scripted proposal repair was not valid and read-only")
    return {"scenario_id": scenario["id"], "prefix_last_event_index": last["index"],
        "prefix_events_digest": digest(prefix), "repair_origin": "operator_script_not_model",
        "original_issues": last["observation"]["result"]["issues"], "edited_plan_field": edited,
        "observed_basis": basis, "rejected_plan": rejected, "scripted_plan": repaired,
        "validation": result, "model_calls": 0, "writes_added": 0,
        "complete_task_success_claimed": False,
        "limit": "A valid proposal can be constructed from already observed information; the model did not perform this repair"}


def review_repairs(run):
    scenarios = {s["id"]: s for s in original("dev")}
    catalog, rows = load_catalog(ROOT / "benchmark/catalog.json"), []
    for arm, identity, kind in CASES:
        source = run / "evaluation" / arm / "normal/episodes.jsonl"
        episode = next(e for e in read_jsonl(source) if e["scenario_id"] == identity)
        rows.append({"arm": arm, "episodes_sha256": sha256(source),
                     **check_repair(scenarios[identity], catalog, episode, kind)})
    return {"scope": "Post-hoc scripted validation diagnostics, not new model successes or deployable automatic repair",
        "cases": rows, "new_model_calls": 0, "new_complete_task_successes": 0}


if __name__ == "__main__":
    from publish_state_coverage import verify_publication
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    args = p.parse_args()
    verify_publication(args.run_dir, args.prepared_dir, args.diagnostic_dir)
    result = review_repairs(args.run_dir)
    dump_new(args.output, result)
    print("Four scripted proposal validations passed; zero new model successes.")
