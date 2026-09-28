"""Author and replay paired synthetic demonstrations; no model or paid API calls.

The train/dev/test split holds out constraint/persona bundles, not behavior
templates. These same-author fixtures are a controlled pilot, not external data.
"""

import argparse
from collections import Counter
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest, validate_scenarios
from liftcut_agent.model_policy import Reply, RunBudget, encode
from liftcut_agent.model_runner import replay_model_suite, run_model_episode
from liftcut_agent.model_transport import MockWorkflowTransport
from liftcut_agent.protocol import ProtocolConfig
from liftcut_agent.trajectories import normalize_messages
from liftcut_agent.workflow import FixedWorkflow, run_episode
from server_workspace import dump_new, sha256

DATA = ROOT / "benchmark/recovery-v1"
CATEGORIES = ("preview", "approved", "partial_clarification", "memory_supersession",
              "revoked", "pending", "declined", "infeasible")
BUNDLES = (
    ("train", ["mon", "thu"], "bodyweight", 18),
    ("train", ["tue", "sat"], "dumbbell", 22),
    ("train", ["wed", "sun"], "barbell", 30),
    ("dev", ["fri", "sun"], "machine", 32),
    ("test", ["mon", "wed", "sat"], "dumbbell", 26),
    ("test", ["tue", "thu", "sun"], "bodyweight", 16),
)


def fixtures():
    rows = []
    for group, (split, days, equipment, minutes) in enumerate(BUNDLES, 1):
        family = f"recovery-bundle-{group:02d}"
        for category in CATEGORIES:
            identity = f"r1-{group:02d}-{category}"
            constraints = {"available_days": days, "sessions_per_week": 2,
                           "equipment": [equipment], "max_minutes": minutes,
                           "min_exercises": 2, "excluded_exercise_ids": []}
            row = {"id": identity, "family_id": family, "persona_id": f"r1-persona-{group:02d}",
                   "split": split, "category": category,
                   "input": {"request": "请根据记录和我的后续回复处理本次计划。", "constraints": constraints,
                             "records": [{"id": f"source-{identity}", "summary": "Synthetic task record."}]},
                   "as_of": "2026-09-28", "memories": [], "clarification_answers": {},
                   "intent": "preview", "approval_behavior": "none", "after_preview_update": {},
                   "faults": [], "max_steps": 24, "expected_terminal": "previewed"}
            if category in {"memory_supersession", "partial_clarification"}:
                old = "barbell" if equipment != "barbell" else "bodyweight"
                constraints["equipment"] = [old]
                row["memories"] = [
                    {"id": f"{identity}-old", "field": "equipment", "value": [old], "revision": 1,
                     "confirmed": True, "expires_on": None},
                    {"id": f"{identity}-current", "field": "equipment", "value": [equipment], "revision": 4,
                     "confirmed": True, "expires_on": None}]
            if category == "partial_clarification":
                constraints["max_minutes"] = None
                row["clarification_answers"] = {"max_minutes": minutes}
            if category in {"approved", "revoked", "pending", "declined"}:
                row["intent"] = "apply"
                row["approval_behavior"] = {"approved": "approve", "revoked": "revoke",
                                            "pending": "none", "declined": "decline"}[category]
                row["expected_terminal"] = {"approved": "applied", "revoked": "declined",
                                            "pending": "awaiting_user", "declined": "declined"}[category]
            if category == "infeasible":
                constraints["max_minutes"] = {"bodyweight": 12, "dumbbell": 17, "barbell": 24, "machine": 27}[equipment]
                row["expected_terminal"] = "infeasible"
            rows.append(row)
    return rows


def write_rows(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(encode(row) + "\n")


def check_splits(rows, catalog):
    validate_scenarios(rows, catalog)
    # Ignore request/record identity when detecting duplicate task semantics.
    seen = {}
    for row in rows:
        semantic = deepcopy(row)
        for key in ("id", "family_id", "persona_id", "split"):
            semantic.pop(key)
        semantic["input"].pop("records")
        semantic["input"].pop("request")
        for memory in semantic["memories"]:
            memory.pop("id")
        fingerprint = digest(semantic)
        if fingerprint in seen and seen[fingerprint] != row["split"]:
            raise ValueError("semantic task duplicated across splits")
        seen[fingerprint] = row["split"]


def freeze(output):
    if output.exists():
        raise ValueError("refusing to replace frozen data")
    rows = fixtures()
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    check_splits(rows, catalog)
    for split in ("train", "dev", "test"):
        write_rows(output / f"{split}.jsonl", [row for row in rows if row["split"] == split])
    dump_new(output / "manifest.json", {
        "version": "recovery-v1", "scope": "same-author synthetic bundle holdout; shared behavior templates",
        "catalog_sha256": sha256(ROOT / "benchmark/catalog.json"),
        "files": {f"{split}.jsonl": sha256(output / f"{split}.jsonl") for split in ("train", "dev", "test")},
        "counts": dict(Counter(row["split"] for row in rows)),
        "grouping": "All eight behaviors of one constraint/persona bundle remain in one split",
        "test_rule": "Freeze before demonstration generation. No checkpoint selection on test. Report all 16 cases.",
        "external_validation": False})


def load_frozen(directory=DATA):
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if (set(manifest["files"]) != {"train.jsonl", "dev.jsonl", "test.jsonl"}
            or sha256(ROOT / "benchmark/catalog.json") != manifest["catalog_sha256"]):
        raise ValueError("frozen inventory/catalog mismatch")
    rows = []
    for name, expected in manifest["files"].items():
        if sha256(directory / name) != expected:
            raise ValueError("frozen scenario hash mismatch")
        part = read_jsonl(directory / name)
        if any(row["split"] != Path(name).stem for row in part):
            raise ValueError("wrong split in frozen file")
        rows.extend(part)
    if dict(Counter(row["split"] for row in rows)) != manifest["counts"]:
        raise ValueError("frozen split count mismatch")
    check_splits(rows, load_catalog(ROOT / "benchmark/catalog.json"))
    return rows


class RecoveryTransport(MockWorkflowTransport):
    """Inject one rejected action, then resume the unchanged correct action.

    Scripted demonstration author, NOT a model or an independent annotator.
    Injected bad actions are history only and never supervised targets.
    """

    def __init__(self, category):
        super().__init__()
        self.category = category
        self.pending = None
        self.injected = False

    def complete(self, payload):
        if self.pending is not None:
            message = payload["messages"][-1]
            observation = json.loads(message["content"])
            if message["role"] != "tool" or observation["ok"]:
                raise ValueError("scripted perturbation must be rejected before continuation")
            data = self.pending
            self.pending = None
            self.number += 1
        else:
            data = json.loads(super().complete(payload).body)
            call = data["choices"][0]["message"]["tool_calls"][0]["function"]
            action, args = call["name"], json.loads(call["arguments"])
            wrong = None
            if not self.injected:
                if self.category in {"revoked", "pending", "declined"} and action == "finish":
                    # Use the actual preview ID visible in the wire history.
                    proposal = next(json.loads(m["content"])["result"]["proposal"] for m in reversed(payload["messages"])
                                    if m["role"] == "tool" and "proposal" in json.loads(m["content"]).get("result", {}))
                    wrong = {"name": "apply_plan", "arguments": encode({"proposal_id": proposal["id"],
                                                                        "idempotency_key": proposal["id"] + ":apply"})}
                elif self.category == "partial_clarification" and action == "request_clarification":
                    wrong = {"name": action, "arguments": encode({"fields": args["fields"] + ["min_exercises"]})}
                elif self.category not in {"revoked", "pending", "declined", "partial_clarification"} and action == "search_exercises":
                    wrong = {"name": "request_clarification", "arguments": encode({"fields": ["min_exercises"]})}
            if wrong:
                self.pending = deepcopy(data)
                data["choices"][0]["message"]["tool_calls"][0]["function"] = wrong
                self.injected = True
        data["id"] = f"mock-{self.number}"
        data["choices"][0]["message"]["tool_calls"][0]["id"] = f"mock-call-{self.number}"
        return Reply(encode(data))


def decisions(scenarios, episodes, variant):
    known = {row["id"]: row for row in scenarios}
    if any(row["split"] != "train" for row in scenarios):
        raise ValueError("only training cases can become supervised targets")
    rows, rejected = [], []
    for episode in episodes:
        scenario = known[episode["scenario_id"]]
        if not episode["trace"]["score"]["passed"] or episode["policy_failure"]:
            raise ValueError("unsuccessful demonstration")
        events = [e for e in episode["trace"]["events"] if e["actor"] == "agent"]
        if len(events) != len(episode["calls"]):
            raise ValueError("demonstrations require single-call decisions")
        decision_index = 0
        for index, (call, event) in enumerate(zip(episode["calls"], events)):
            observation = event["observation"]
            if not observation["ok"] or (event["action"]["tool"] == "validate_plan" and not observation["result"]["valid"]):
                rejected.append({"scenario_id": scenario["id"], "call_index": index, "action": event["action"]})
                continue
            target = json.loads(call["response"]["body"])["choices"][0]["message"]
            messages = normalize_messages([*call["request"]["messages"], target])
            rows.append({"format_version": "paired-programmatic-decisions-v1", "source_kind": "scripted_workflow",
                         "pair_id": f"{scenario['id']}:{decision_index}", "variant": variant,
                         "scenario_id": scenario["id"], "family_id": scenario["family_id"],
                         "persona_id": scenario["persona_id"], "split": "train", "category": scenario["category"],
                         "source_episode_id": episode["trace"]["episode_id"], "source_call_index": index,
                         "messages": messages, "tools": call["request"]["tools"],
                         "assistant_target_index": len(messages) - 1, "loss_scope": "final_assistant_only"})
            decision_index += 1
    return rows, rejected


def prepare(output, data=DATA):
    if output.exists():
        raise ValueError("output directory exists")
    all_cases = load_frozen(data)
    scenarios = [row for row in all_cases if row["split"] == "train"]
    catalog = load_catalog(ROOT / "benchmark/catalog.json")
    # Check label realizability, including test, but never export held-out targets.
    contract_passed = sum(run_episode(s, catalog, FixedWorkflow())["score"]["passed"] for s in all_cases)
    if contract_passed != len(all_cases):
        raise ValueError("a frozen label is not realizable by the reference workflow")
    config = ProtocolConfig(tool_protocol="read_batch", prompt_revision="pending_approval_v1",
                            max_requests=2000, max_reserved_output_tokens=2048000)
    variants = {}
    for variant in ("clean", "recovery"):
        budget = RunBudget(config)
        episodes = []
        for scenario in scenarios:
            transport = MockWorkflowTransport() if variant == "clean" else RecoveryTransport(scenario["category"])
            episode = run_model_episode(scenario, catalog, config, transport, budget,
                                        episode_id=digest(scenario)[0:32])
            if variant == "recovery" and not transport.injected:
                raise ValueError("missing recovery perturbation")
            episodes.append(episode)
        replay = replay_model_suite(scenarios, catalog, config, episodes)
        rows, rejected = decisions(scenarios, episodes, variant)
        directory = output / variant
        write_rows(directory / "episodes.jsonl", episodes)
        write_rows(directory / "decisions.jsonl", rows)
        dump_new(directory / "config.json", asdict(config))
        dump_new(directory / "manifest.json", {"source_run_id": f"programmatic-recovery-v1-{variant}",
            "source_kind": "scripted_workflow_not_model", "rows_digest": digest(rows),
            "decisions_sha256": sha256(directory / "decisions.jsonl"), "decision_rows": len(rows),
            "replay": replay, "rejected_targets": rejected, "independent_annotation": False})
        variants[variant] = rows
    if ([r["pair_id"] for r in variants["clean"]] != [r["pair_id"] for r in variants["recovery"]]):
        raise ValueError("pair alignment mismatch")
    for a, b in zip(variants["clean"], variants["recovery"]):
        # Tool-call IDs differ after injection; Qwen's target template omits them.
        target_a, target_b = deepcopy(a["messages"][-1]), deepcopy(b["messages"][-1])
        for target in (target_a, target_b):
            for call in target["tool_calls"]:
                call.pop("id")
        if target_a != target_b:
            raise ValueError("paired demonstrations must teach identical correct actions")
    dump_new(output / "manifest.json", {"scope": "offline authored data, not model performance",
        "frozen_manifest_sha256": sha256(data / "manifest.json"), "contract_passed": contract_passed,
        "training_episodes_per_variant": len(scenarios), "paired_decisions": len(variants["clean"]),
        "training_only": True, "same_author_templates": True})
    return json.loads((output / "manifest.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("freeze", "check", "prepare"))
    parser.add_argument("--data-dir", type=Path, default=DATA)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if args.action == "freeze":
        freeze(args.data_dir)
    elif args.action == "check":
        actual = load_frozen(args.data_dir)
        if sorted(actual, key=lambda r: r["id"]) != sorted(fixtures(), key=lambda r: r["id"]):
            raise ValueError("frozen fixtures differ from authored definitions")
        print(encode({"validated": len(actual), "counts": dict(Counter(r["split"] for r in actual))}))
    else:
        if args.output_dir is None:
            parser.error("prepare requires --output-dir")
        print(encode(prepare(args.output_dir, args.data_dir)))
