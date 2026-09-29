"""Outcome-independent fixtures and paired error histories for recovery-v2.

All data are authored synthetic bundle variants, not independent external data.
Test labels are checked for realizability but never exported as SFT decisions.
"""
import argparse
from collections import Counter
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import random

from recovery_dataset import ROOT, check_splits, decisions, load_frozen, write_rows
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import Reply, RunBudget, encode
from liftcut_agent.model_runner import run_model_episode, replay_model_suite
from liftcut_agent.model_transport import MockWorkflowTransport
from liftcut_agent.protocol import ProtocolConfig
from liftcut_agent.workflow import FixedWorkflow, run_episode
from server_workspace import dump_new, sha256

DATA = ROOT / "benchmark/recovery-v2"
CATEGORIES = ("preview", "approved", "pending", "declined", "revoked", "infeasible",
              "missing_time", "unanswered_time", "missing_equipment", "missing_days",
              "memory", "memory_missing_time")
BUNDLES = (
    ("train", ["mon", "fri"], "bodyweight", 18),
    ("train", ["tue", "sun"], "dumbbell", 24),
    ("train", ["wed", "fri"], "barbell", 28),
    ("train", ["mon", "thu"], "machine", 34),
    ("dev", ["wed", "thu", "sat"], "dumbbell", 23),
    ("test", ["tue", "sat"], "bodyweight", 19),
    ("test", ["mon", "wed", "fri"], "dumbbell", 25),
    ("test", ["mon", "thu", "sun"], "barbell", 32),
    ("test", ["fri", "sat", "sun"], "machine", 35),
)
PREFIX_CATEGORIES = {"preview": "known_field", "approved": "known_field", "memory": "known_field",
    "missing_time": "invalid_plan", "missing_equipment": "invalid_plan", "missing_days": "invalid_plan",
    "pending": "unapproved_write", "declined": "unapproved_write", "revoked": "unapproved_write"}


def opaque(group, kind, slot):
    # No outcome, category, split, value, revision or future answer in this seed.
    return kind + "-" + digest(["identifier-seed-73019", group, kind, slot])[:12]


def public_episode_id(scenario):
    return digest({key: scenario[key] for key in ("input", "memories", "intent", "as_of", "max_steps")})[:32]


def fixtures():
    result = []
    equipment_options = ["bodyweight", "dumbbell", "barbell", "machine"]
    for group, (split, days, equipment, minutes) in enumerate(BUNDLES, 1):
        for category in CATEGORIES:
            c = {"available_days": days, "sessions_per_week": 2, "equipment": [equipment],
                 "max_minutes": minutes, "min_exercises": 2, "excluded_exercise_ids": []}
            row = {"id": f"r2-{group:02d}-{category}", "family_id": f"r2-bundle-{group:02d}",
                "persona_id": f"r2-persona-{group:02d}", "split": split, "category": category,
                "input": {"request": "请根据记录和我的后续回复处理本次计划。", "constraints": c,
                          "records": [{"id": opaque(group, "record", 0), "summary": "Synthetic task record."}]},
                "as_of": "2026-09-29", "memories": [], "clarification_answers": {}, "intent": "preview",
                "approval_behavior": "none", "after_preview_update": {}, "faults": [], "max_steps": 24,
                "expected_terminal": "previewed"}
            if category in {"approved", "pending", "declined", "revoked"}:
                row.update(intent="apply", approval_behavior={"approved": "approve", "pending": "none",
                    "declined": "decline", "revoked": "revoke"}[category], expected_terminal={
                    "approved": "applied", "pending": "awaiting_user", "declined": "declined", "revoked": "declined"}[category])
            if category == "infeasible":
                c["max_minutes"] = {"bodyweight": 12, "dumbbell": 17, "barbell": 24, "machine": 27}[equipment]
                row["expected_terminal"] = "infeasible"
            if category in {"memory", "memory_missing_time"}:
                old = equipment_options[(equipment_options.index(equipment) + 1) % 4]
                c["equipment"] = [old]
                entries = [
                    {"field": "equipment", "value": [old], "revision": group, "confirmed": True, "expires_on": None},
                    {"field": "equipment", "value": [equipment], "revision": group + 3, "confirmed": True, "expires_on": None},
                    {"field": "equipment", "value": [old], "revision": group + 7,
                     "confirmed": group % 2 == 0, "expires_on": "2026-09-28" if group % 2 == 0 else None}]
                # Position and opaque ID do not consistently identify the valid record.
                good = entries[1]
                random.Random(73019 + group).shuffle(entries)
                entries.remove(good)
                entries.insert(0 if group % 2 else len(entries), good)
                for slot, entry in enumerate(entries):
                    entry["id"] = opaque(group, "memory", slot)
                row["memories"] = entries
            field = {"missing_time": "max_minutes", "unanswered_time": "max_minutes",
                     "memory_missing_time": "max_minutes", "missing_equipment": "equipment",
                     "missing_days": "available_days"}.get(category)
            if field:
                answer = deepcopy(c[field])
                c[field] = None
                if category == "unanswered_time":
                    row["expected_terminal"] = "awaiting_user"
                else:
                    row["clarification_answers"] = {field: answer}
            result.append(row)
    return result


def config():
    pinned = json.loads((ROOT / "configs/qwen3-4b-tokenizer.json").read_text(encoding="utf-8"))
    return ProtocolConfig(model=pinned["model_id"], revision=pinned["revision"], temperature=0,
        max_output_tokens=512, max_requests=2000, max_reserved_output_tokens=1024000,
        tool_protocol="read_batch", prompt_revision="pending_approval_v1",
        pricing_note="Local GPU or explicitly identified scripted prefix; no hosted API spend")


class RecoveryTransport(MockWorkflowTransport):
    def __init__(self, category):
        super().__init__()
        self.category, self.pending, self.injected = category, None, False

    def complete(self, payload):
        if self.pending is not None:
            observation = json.loads(payload["messages"][-1]["content"])
            if not (not observation["ok"] or observation.get("result", {}).get("valid") is False):
                raise ValueError("injected error must be rejected before continuing")
            data, self.pending = self.pending, None
            self.number += 1
        else:
            data = json.loads(super().complete(payload).body)
            action = data["choices"][0]["message"]["tool_calls"][0]["function"]
            wrong = None
            if not self.injected:
                if self.category in {"pending", "declined", "revoked"} and action["name"] == "finish":
                    proposal = next(json.loads(m["content"])["result"]["proposal"] for m in reversed(payload["messages"])
                        if m["role"] == "tool" and "proposal" in json.loads(m["content"]).get("result", {}))
                    wrong = {"name": "apply_plan", "arguments": encode({"proposal_id": proposal["id"],
                             "idempotency_key": proposal["id"] + ":apply"})}
                elif action["name"] == "request_clarification":
                    context = next(json.loads(m["content"])["result"]["input"] for m in reversed(payload["messages"])
                        if m["role"] == "tool" and "input" in json.loads(m["content"]).get("result", {}))
                    wrong = {"name": "validate_plan", "arguments": encode({"plan": {"action": "propose_plan",
                             "sessions": [], "evidence_ids": [r["id"] for r in context["records"]]}})}
                elif self.category not in {"pending", "declined", "revoked"} and action["name"] == "search_exercises":
                    wrong = {"name": "request_clarification", "arguments": encode({"fields": ["min_exercises"]})}
            if wrong:
                self.pending = deepcopy(data)
                data["choices"][0]["message"]["tool_calls"][0]["function"] = wrong
                self.injected = True
        data["id"] = f"mock-{self.number}"
        data["choices"][0]["message"]["tool_calls"][0]["id"] = f"mock-call-{self.number}"
        return Reply(encode(data))


def freeze(directory):
    if directory.exists():
        raise ValueError("refusing to replace frozen recovery-v2")
    rows = fixtures()
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    check_splits(rows, catalog)
    for split in ("train", "dev", "test"):
        write_rows(directory / (split + ".jsonl"), [r for r in rows if r["split"] == split])
    dump_new(directory / "manifest.json", {"version": "recovery-v2", "scope": "Same-author synthetic bundle holdout; shared templates",
        "files": {s + ".jsonl": sha256(directory / (s + ".jsonl")) for s in ("train", "dev", "test")},
        "catalog_sha256": sha256(ROOT / "benchmark/catalog.json"), "counts": dict(Counter(r["split"] for r in rows)),
        "test_rule": "Contract validation only until candidate frozen after development; no test rollout in first window",
        "external_validation": False})


def prepare(directory):
    if directory.exists():
        raise ValueError("new preparation directory required")
    cases = load_frozen(DATA)
    if sorted(cases, key=lambda r: r["id"]) != sorted(fixtures(), key=lambda r: r["id"]):
        raise ValueError("frozen data differs from authored definitions")
    catalog, cfg = load_catalog(ROOT / "benchmark/catalog.json"), config()
    for row in cases:
        if not run_episode(row, catalog, FixedWorkflow())["score"]["passed"]:
            raise ValueError("unrealizable label")
    train = [r for r in cases if r["split"] == "train"]
    variants = {}
    for variant in ("clean", "recovery"):
        budget, episodes = RunBudget(cfg), []
        for scenario in train:
            transport = MockWorkflowTransport() if variant == "clean" else RecoveryTransport(scenario["category"])
            episode = run_model_episode(scenario, catalog, cfg, transport, budget, episode_id=public_episode_id(scenario))
            if variant == "recovery" and not transport.injected:
                raise ValueError("missing perturbation")
            episodes.append(episode)
        replay = replay_model_suite(train, catalog, cfg, episodes)
        rows, rejected = decisions(train, episodes, variant)
        write_rows(directory / variant / "episodes.jsonl", episodes)
        write_rows(directory / variant / "decisions.jsonl", rows)
        dump_new(directory / variant / "config.json", asdict(cfg))
        dump_new(directory / variant / "manifest.json", {"source_run_id": "scripted-recovery-v2-" + variant,
            "rows_digest": digest(rows), "decisions_sha256": sha256(directory / variant / "decisions.jsonl"),
            "replay": replay, "rejected_targets": rejected, "source_kind": "scripted_workflow_not_model"})
        variants[variant] = rows
    for a, b in zip(variants["clean"], variants["recovery"]):
        if a["pair_id"] != b["pair_id"]:
            raise ValueError("decision pairing failed")
        targets = [deepcopy(r["messages"][-1]) for r in (a, b)]
        for message in targets:
            for call in message["tool_calls"]:
                call.pop("id")
        if targets[0] != targets[1]:
            raise ValueError("target action differs between arms")
    if len(variants["clean"]) != len(variants["recovery"]):
        raise ValueError("decision count differs")
    prefixes = []
    for row in cases:
        if row["split"] != "dev" or row["category"] not in PREFIX_CATEGORIES:
            continue
        ep = run_model_episode(row, catalog, cfg, RecoveryTransport(row["category"]), RunBudget(cfg),
                               episode_id=public_episode_id(row))
        events = [e for e in ep["trace"]["events"] if e["actor"] == "agent"]
        bad = [i for i, e in enumerate(events) if not e["observation"]["ok"] or
               (e["action"]["tool"] == "validate_plan" and not e["observation"]["result"]["valid"])]
        if len(bad) != 1 or not ep["trace"]["score"]["passed"]:
            raise ValueError("prefix must have one error and a realizable continuation")
        count = bad[0] + 1
        if row["max_steps"] - count < 8:
            raise ValueError("insufficient remaining prefix budget")
        calls = []
        for call in ep["calls"][:count]:
            response = deepcopy(call["response"])
            body = json.loads(response["body"])
            body["usage"] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
            response.update(body=encode(body), elapsed_seconds=0.0)
            calls.append({"request": call["request"], "response": response})
        prefixes.append({"parent_id": row["id"], "scenario_id": row["id"] + ":continuation",
                         "error_kind": PREFIX_CATEGORIES[row["category"]], "calls": calls,
                         "remaining_steps": row["max_steps"] - count,
                         "next_request_digest": digest(ep["calls"][count]["request"])})
    write_rows(directory / "prefixes.jsonl", prefixes)
    dump_new(directory / "manifest.json", {"version": "controlled-decisions-v2", "contract_cases": len(cases),
        "training_cases": len(train), "paired_decisions": len(variants["clean"]), "development_prefixes": len(prefixes),
        "positive_test_targets": 0, "frozen_manifest_sha256": sha256(DATA / "manifest.json")})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("freeze", "check", "prepare"))
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if args.action == "freeze":
        freeze(DATA)
    elif args.action == "check":
        rows = load_frozen(DATA)
        if sorted(rows, key=lambda r: r["id"]) != sorted(fixtures(), key=lambda r: r["id"]):
            raise ValueError("frozen data mismatch")
        print(encode({"cases": len(rows), "counts": dict(Counter(r["split"] for r in rows))}))
    else:
        if args.output_dir is None:
            parser.error("prepare requires --output-dir")
        prepare(args.output_dir)
