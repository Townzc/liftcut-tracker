"""Retrospective CPU coverage audit of the exact v2 training decision pools."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path

from controlled_recovery import DATA, ROOT
from liftcut_agent.benchmark import read_jsonl
from server_workspace import dump_new, sha256

REPORT = ROOT / "reports/recovery-v2-state-coverage.json"


def coverage(prepared):
    reviewed = json.loads((ROOT / "reports/recovery-preparation-v2.json").read_text(encoding="utf-8"))
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    if sha256(DATA / "train.jsonl") != manifest["files"]["train.jsonl"]:
        raise ValueError("v2 training fixtures differ from frozen manifest")
    pools, hashes = {}, {}
    for variant in ("clean", "recovery"):
        relative = f"decisions/{variant}/decisions.jsonl"
        path = prepared / relative
        if sha256(path) != reviewed["files"][relative]:
            raise ValueError("training decisions differ from reviewed token preparation")
        hashes[relative] = sha256(path)
        rows = read_jsonl(path)
        transitions, terminal_previous = defaultdict(Counter), Counter()
        for row in rows:
            if row["split"] != "train" or row["variant"] != variant:
                raise ValueError("unexpected training decision scope")
            messages = row["messages"]
            call_names, last_tool = {}, "initial"
            for message in messages[:-1]:
                if message["role"] == "assistant":
                    call_names.update({c["id"]: c["function"]["name"] for c in message["tool_calls"]})
                elif message["role"] == "tool":
                    last_tool = call_names[message["tool_call_id"]]
            calls = messages[-1]["tool_calls"]
            if len(calls) != 1:
                raise ValueError("v2 reference target must have one decision")
            name = calls[0]["function"]["name"]
            transitions[last_tool][name] += 1
            if name == "finish":
                terminal_previous[last_tool] += 1
        pools[variant] = {"unique_decisions": len(rows), "last_tool_to_target": {k: dict(v) for k, v in sorted(transitions.items())},
            "finish_target_previous_tool": dict(sorted(terminal_previous.items())),
            "finish_after_context_or_memory_read": sum(terminal_previous[k] for k in ("get_context", "get_memories"))}
    memory_rows = []
    for row in read_jsonl(DATA / "train.jsonl"):
        if not row["memories"]:
            continue
        eligible = [m for m in row["memories"] if m["confirmed"] and
                    (m["expires_on"] is None or m["expires_on"] > row["as_of"])]
        valid = max(eligible, key=lambda m: m["revision"])
        old = min(eligible, key=lambda m: m["revision"])
        high = max(row["memories"], key=lambda m: m["revision"])
        memory_rows.append({"scenario_id": row["id"], "family_id": row["family_id"], "category": row["category"],
            "valid_position": "first" if row["memories"][0] == valid else "last" if row["memories"][-1] == valid else "middle",
            "high_invalid_kind": "unconfirmed" if not high["confirmed"] else "expired",
            "raw_old_invalid_same_value": row["input"]["constraints"]["equipment"] == old["value"] == high["value"],
            "distinct_equipment_values": len({tuple(m["value"]) for m in row["memories"]} | {tuple(row["input"]["constraints"]["equipment"])})})
    combinations = {position + "/" + kind: sum(r["valid_position"] == position and r["high_invalid_kind"] == kind for r in memory_rows)
                    for position in ("first", "last") for kind in ("unconfirmed", "expired")}
    return {"scope": "Retrospective v2 coverage analysis motivated by new development failures; no new training/model calls",
        "source_sha256": hashes, "train_fixture_sha256": sha256(DATA / "train.jsonl"),
        "decision_pools": pools, "memory_fixtures": memory_rows, "memory_position_invalid_cross": combinations,
        "weighting_limit": "Pool counts are unique exported decisions, not the sampled 648-decision optimizer schedule",
        "causal_limit": "Missing combinations and deterministic transition coverage are plausible explanations, not isolated causal effects"}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--prepared-dir", type=Path, required=True)
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    result = coverage(args.prepared_dir)
    if args.check:
        if result != json.loads(REPORT.read_text(encoding="utf-8")):
            raise ValueError("saved coverage report differs from audited decisions")
    else:
        dump_new(REPORT, result)
    print(json.dumps({"transitions": {k: v["last_tool_to_target"] for k, v in result["decision_pools"].items()},
                      "memory_position_invalid_cross": result["memory_position_invalid_cross"]}, indent=2))
