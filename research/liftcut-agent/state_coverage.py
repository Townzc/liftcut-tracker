"""Train-only 2x2 coverage interventions; every context is executed and replayed."""
import argparse
from collections import Counter
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import random

from controlled_recovery import DATA as V2, ROOT, config, opaque
from recovery_dataset import check_splits, decisions, write_rows
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.environment import PlanEnvironment, ScriptedUser
from liftcut_agent.interactive import digest, resolved_inputs
from liftcut_agent.model_policy import Reply, RunBudget, encode
from liftcut_agent.model_runner import replay_model_suite, run_model_episode
from liftcut_agent.model_transport import MockWorkflowTransport
from state_diagnostics import business_state
from server_workspace import dump_new, sha256

ARMS = ("s0", "t", "m", "tm")
DATA = ROOT / "benchmark/state-coverage-v1"
EQUIPMENT = ("bodyweight", "dumbbell", "barbell", "machine")
READS = (("get_context",), ("get_memories",), ("get_context", "get_memories"))


def original(split):
    if split not in {"train", "dev"}:
        raise ValueError("coverage preparation never reads reserved test tasks")
    manifest = json.loads((V2 / "manifest.json").read_text(encoding="utf-8"))
    path = V2 / (split + ".jsonl")
    if sha256(path) != manifest["files"][path.name]:
        raise ValueError("original fixture hash mismatch")
    rows = read_jsonl(path)
    if any(r["split"] != split for r in rows):
        raise ValueError("wrong original split")
    return rows


def public_episode_id(scenario):
    public = {k: deepcopy(scenario[k]) for k in ("input", "memories", "intent", "as_of", "max_steps")}
    public["memories"].sort(key=lambda m: m["id"])
    return digest(public)[:32]


def fixtures(arm):
    if arm not in ARMS:
        raise ValueError("unknown coverage arm")
    rows, factors = [], []
    for source in original("train"):
        group = int(source["family_id"].rsplit("-", 1)[1])
        variants = [(None, 0)] if not source["memories"] else [
            (kind, slot) for kind in ("unconfirmed", "expired") for slot in (0, 1)]
        for kind, slot in variants:
            row = deepcopy(source)
            row["id"] = source["id"].replace("r2-", "sc1-", 1) + (f"-{kind}-{slot}" if kind else "")
            # Keep original family/persona memberships, even for expanded variants.
            position = None
            if kind:
                good_value = resolved_inputs(source["input"], source["memories"], source["as_of"])["constraints"]["equipment"][0]
                index = EQUIPMENT.index(good_value)
                raw, old, high = [EQUIPMENT[(index + n) % 4] for n in (1, 2, 3)]
                row["input"]["constraints"]["equipment"] = [raw]
                records = [
                    {"field": "equipment", "value": [old], "revision": group, "confirmed": True, "expires_on": None},
                    {"field": "equipment", "value": [good_value], "revision": group + 3, "confirmed": True, "expires_on": None},
                    {"field": "equipment", "value": [high], "revision": group + 7,
                     "confirmed": kind == "expired", "expires_on": "2026-09-28" if kind == "expired" else None}]
                # IDs assigned before permutation; opaque slot assignment rotates across bundles.
                slots = list(range(3))
                random.Random(9319 + group).shuffle(slots)
                for memory, identity in zip(records, slots):
                    memory["id"] = opaque(group + 100, "memory", identity)
                first = kind == "unconfirmed"
                if arm in {"m", "tm"} and slot == 1:
                    first = not first
                others = [records[0], records[2]] if slot == 0 else [records[2], records[0]]
                row["memories"] = [records[1], *others] if first else [*others, records[1]]
                position = "first" if first else "last"
            rows.append(row)
            factors.append({"scenario_id": row["id"], "source_id": source["id"], "family_id": row["family_id"],
                "invalid_kind": kind, "replica": slot, "valid_position": position,
                "read_sequence": list(READS[(group - 1 + slot) % len(READS)]) if arm in {"t", "tm"} else []})
    return rows, factors


def freeze():
    if DATA.exists():
        raise ValueError("new frozen coverage directory required")
    catalog, dev = load_catalog(ROOT / "benchmark/catalog.json"), original("dev")
    for arm in ARMS:
        rows, factors = fixtures(arm)
        check_splits(rows + dev, catalog)
        write_rows(DATA / arm / "train.jsonl", rows)
        write_rows(DATA / arm / "factors.jsonl", factors)
    dump_new(DATA / "manifest.json", {"version": "state-coverage-v1", "arms": list(ARMS),
        "files": {p.relative_to(DATA).as_posix(): sha256(p) for p in sorted(DATA.rglob("*.jsonl"))},
        "source_train_sha256": sha256(V2 / "train.jsonl"), "source_dev_sha256": sha256(V2 / "dev.jsonl"),
        "catalog_sha256": sha256(ROOT / "benchmark/catalog.json"),
        "scope": "Same four training bundles, shared authored templates; not independent data",
        "reserved_test_read": False})


def load_frozen():
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    expected_files = {f"{arm}/{name}.jsonl" for arm in ARMS for name in ("train", "factors")}
    if set(manifest["files"]) != expected_files or set(p.relative_to(DATA).as_posix() for p in DATA.rglob("*.jsonl")) != expected_files:
        raise ValueError("coverage frozen inventory mismatch")
    for name, expected in manifest["files"].items():
        if sha256(DATA / name) != expected:
            raise ValueError("coverage fixture hash mismatch")
    if manifest["catalog_sha256"] != sha256(ROOT / "benchmark/catalog.json"):
        raise ValueError("coverage catalog mismatch")
    result = {}
    for arm in ARMS:
        actual = (read_jsonl(DATA / arm / "train.jsonl"), read_jsonl(DATA / arm / "factors.jsonl"))
        if actual != fixtures(arm):
            raise ValueError("coverage fixtures differ from authored definitions")
        result[arm] = actual
    return result


class CoverageTransport(MockWorkflowTransport):
    """Pause after a real preview, execute reads, then resume its correct target.

    The supervisor uses only wire observations. Injected reads are context only;
    they are excluded from target export, never fabricated tool observations.
    """
    def __init__(self, read_sequence):
        super().__init__()
        self.reads = list(read_sequence)
        self.pending = None
        self.injected_call_indices = []
        self.injected = False

    def complete(self, payload):
        if self.pending is not None:
            last = payload["messages"][-1]
            if last["role"] != "tool" or not json.loads(last["content"])["ok"]:
                raise ValueError("injected read must execute successfully")
            self.number += 1
            data = deepcopy(self.pending)
            if not self.reads:
                self.pending = None
        else:
            previous = self.workflow._last
            data = json.loads(super().complete(payload).body)
            if self.reads and not self.injected and previous and previous["tool"] == "propose_plan":
                self.pending = deepcopy(data)
                self.injected = True
        if self.pending is not None:
            tool = self.reads.pop(0)
            data["choices"][0]["message"]["tool_calls"][0]["function"] = {"name": tool, "arguments": "{}"}
            self.injected_call_indices.append(self.number - 1)
        data["id"] = f"mock-{self.number}"
        data["choices"][0]["message"]["tool_calls"][0]["id"] = f"mock-call-{self.number}"
        return Reply(encode(data))


def audit_read_states(scenario, episode, indices, catalog):
    env, user = PlanEnvironment(scenario, catalog), ScriptedUser(scenario)
    env.reset(episode_id=public_episode_id(scenario))
    checks, cursor = [], 0
    for event in episode["trace"]["events"]:
        if event["actor"] != "agent":
            continue
        before = business_state(env.snapshot())
        env.step(event["action"])
        users = user.advance(env)
        if cursor in indices:
            if event["action"]["tool"] not in {"get_context", "get_memories"} or users or before != business_state(env.snapshot()):
                raise ValueError("coverage read changed business state")
            checks.append({"call_index": cursor, "tool": event["action"]["tool"], "business_state_digest": digest(before)})
        cursor += 1
    if len(checks) != len(indices):
        raise ValueError("missing injected read")
    return checks


def canonical_target(row):
    target = deepcopy(row["messages"][-1])
    for call in target["tool_calls"]:
        call.pop("id")
    return target


def prepare(output):
    if output.exists():
        raise ValueError("fresh coverage preparation required")
    frozen, catalog, cfg = load_frozen(), load_catalog(ROOT / "benchmark/catalog.json"), config()
    exported, summaries = {}, {}
    for arm, (scenarios, factors) in frozen.items():
        check_splits(scenarios + original("dev"), catalog)
        episodes, rows, audits = [], [], []
        budget = RunBudget(cfg)
        for scenario, factor in zip(scenarios, factors):
            transport = CoverageTransport(factor["read_sequence"])
            episode = run_model_episode(scenario, catalog, cfg, transport, budget, episode_id=public_episode_id(scenario))
            exported_rows, rejected = decisions([scenario], [episode], arm)
            if rejected:
                raise ValueError("coverage supervision must not contain rejected calls")
            injected = transport.injected_call_indices
            kept = [r for r in exported_rows if r["source_call_index"] not in injected]
            for index, row in enumerate(kept):
                row["pair_id"] = f"{scenario['id']}:{index}"
                row["format_version"] = "paired-state-coverage-v1"
            checks = audit_read_states(scenario, episode, injected, catalog)
            has_preview = any(e["action"]["tool"] == "propose_plan" for e in episode["trace"]["events"] if e["actor"] == "agent")
            if len(checks) != (len(factor["read_sequence"]) if has_preview else 0):
                raise ValueError("missing planned coverage intervention")
            audits.append({"scenario_id": scenario["id"], "context_only_reads": checks})
            episodes.append(episode)
            rows.extend(kept)
        replay = replay_model_suite(scenarios, catalog, cfg, episodes)
        directory = output / arm
        write_rows(directory / "episodes.jsonl", episodes)
        write_rows(directory / "decisions.jsonl", rows)
        write_rows(directory / "read-audit.jsonl", audits)
        dump_new(directory / "config.json", asdict(cfg))
        dump_new(directory / "manifest.json", {"source_run_id": "scripted-state-coverage-v1-" + arm,
            "source_kind": "scripted_workflow_not_model", "rows_digest": digest(rows),
            "decisions_sha256": sha256(directory / "decisions.jsonl"), "replay": replay,
            "context_only_read_count": sum(len(a["context_only_reads"]) for a in audits)})
        exported[arm] = rows
        memory = [f for f in factors if f["invalid_kind"]]
        summaries[arm] = {"training_scenarios": len(scenarios), "decisions": len(rows),
            "memory_position_invalid_cross": dict(sorted(Counter(f["valid_position"] + "/" + f["invalid_kind"] for f in memory).items())),
            "context_only_reads": sum(len(a["context_only_reads"]) for a in audits),
            "terminal_targets_after_read": sum(r["messages"][-1]["tool_calls"][0]["function"]["name"] in {"finish", "apply_plan"}
                and r["messages"][-2]["role"] == "tool" and any(c["function"]["name"] in {"get_context", "get_memories"}
                    for c in r["messages"][-3].get("tool_calls", [])) for r in rows)}
    pair_ids = [r["pair_id"] for r in exported["s0"]]
    for arm in ARMS:
        if [r["pair_id"] for r in exported[arm]] != pair_ids or any(canonical_target(a) != canonical_target(b) for a, b in zip(exported["s0"], exported[arm])):
            raise ValueError("coverage correct targets are not paired")
    result = {"scope": "Executed scripted contracts, not model performance", "arms": summaries,
        "paired_targets": True, "positive_test_targets": 0, "frozen_manifest_sha256": sha256(DATA / "manifest.json")}
    dump_new(output / "manifest.json", result)
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=("freeze", "check", "prepare"))
    p.add_argument("--output-dir", type=Path)
    args = p.parse_args()
    if args.action == "freeze":
        freeze()
    elif args.action == "check":
        print(encode({a: len(v[0]) for a, v in load_frozen().items()}))
    elif args.output_dir:
        print(encode(prepare(args.output_dir)))
    else:
        p.error("prepare requires --output-dir")
