from collections import Counter
from copy import deepcopy
import itertools
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from state_coverage import ARMS, EQUIPMENT, audit_read_states, canonical_target, fixtures, load_frozen, original, prepare, public_episode_id
from prepare_state_coverage import schedules
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.interactive import digest, resolved_inputs
from liftcut_agent.model_policy import encode
from recovery_dataset import write_rows


class StateCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.report = prepare(cls.root / "decisions")
        cls.rows = {a: read_jsonl(cls.root / "decisions" / a / "decisions.jsonl") for a in ARMS}
        cls.frozen = load_frozen()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_four_arms_execute_replay_and_pair_every_correct_target(self):
        for arm in ARMS:
            self.assertEqual(self.report["arms"][arm]["training_scenarios"], 72)
            self.assertEqual(len(self.rows[arm]), 504)
            self.assertEqual([r["pair_id"] for r in self.rows[arm]], [r["pair_id"] for r in self.rows["s0"]])
            self.assertEqual([canonical_target(r) for r in self.rows[arm]], [canonical_target(r) for r in self.rows["s0"]])
            manifest = json.loads((self.root / "decisions" / arm / "manifest.json").read_text())
            self.assertEqual(manifest["replay"]["task_passed"], 72)

    def test_training_groups_stay_separate_and_metadata_does_not_enter_messages(self):
        train_groups = {r["family_id"] for r in original("train")}
        self.assertTrue(train_groups.isdisjoint({r["family_id"] for r in original("dev")}))
        for rows in self.rows.values():
            self.assertEqual({r["split"] for r in rows}, {"train"})
            self.assertEqual({r["family_id"] for r in rows}, train_groups)
            for row in rows:
                wire = encode(row["messages"])
                self.assertNotIn("sc1-", wire)
                self.assertNotIn("r2-bundle", wire)
                self.assertNotIn("expected_terminal", wire)
        with self.assertRaisesRegex(ValueError, "never reads reserved"):
            original("test")

    def test_memory_factors_cross_within_each_bundle_and_values_rotate(self):
        role_values = [set() for _ in range(4)]
        for arm in ARMS:
            rows, factors = self.frozen[arm]
            for group in {s["family_id"] for s in rows}:
                cross = Counter((f["valid_position"], f["invalid_kind"]) for f in factors if f["family_id"] == group and f["invalid_kind"])
                expected = {(p, k): 2 for p in ("first", "last") for k in ("unconfirmed", "expired")} if arm in {"m", "tm"} else {("first", "unconfirmed"): 4, ("last", "expired"): 4}
                self.assertEqual(cross, expected)
            for row in rows:
                if not row["memories"]:
                    continue
                old, current, invalid = sorted(row["memories"], key=lambda m: m["revision"])
                values = [row["input"]["constraints"]["equipment"][0], old["value"][0], current["value"][0], invalid["value"][0]]
                self.assertEqual(set(values), set(EQUIPMENT))
                for value, seen in zip(values, role_values):
                    seen.add(value)
        self.assertTrue(all(v == set(EQUIPMENT) for v in role_values))

    def test_identity_is_permutation_invariant_and_ignores_future_outcomes(self):
        for scenario in self.frozen["s0"][0]:
            before = public_episode_id(scenario)
            changed = deepcopy(scenario)
            changed.update(approval_behavior="decline", expected_terminal="declined", clarification_answers={"max_minutes": 99}, id="hidden-label")
            self.assertEqual(public_episode_id(changed), before)
            for permutation in itertools.permutations(scenario["memories"]):
                changed = deepcopy(scenario)
                changed["memories"] = list(permutation)
                self.assertEqual(public_episode_id(changed), before)
                self.assertEqual(resolved_inputs(changed["input"], changed["memories"], changed["as_of"]),
                                 resolved_inputs(scenario["input"], scenario["memories"], scenario["as_of"]))

    def test_consent_wire_prefixes_are_equal_before_the_external_user_event(self):
        episodes = read_jsonl(self.root / "decisions/t/episodes.jsonl")
        for group in range(1, 5):
            selected = [e for e in episodes if e["scenario_id"] in {f"sc1-{group:02d}-{c}" for c in ("approved", "pending", "declined", "revoked")}]
            self.assertEqual(len(selected), 4)
            # Shared run reservation counters differ; they never enter the model wire.
            wire = [[{k: c[k] for k in ("request", "response")} for c in e["calls"][:5]] for e in selected]
            self.assertTrue(all(part == wire[0] for part in wire))

    def test_reads_are_real_state_preserving_context_and_never_extra_targets(self):
        for arm in ARMS:
            audits = read_jsonl(self.root / "decisions" / arm / "read-audit.jsonl")
            indices = {a["scenario_id"]: {r["call_index"] for r in a["context_only_reads"]} for a in audits}
            self.assertEqual(sum(map(len, indices.values())), 80 if arm in {"t", "tm"} else 0)
            self.assertTrue(all(r["source_call_index"] not in indices[r["scenario_id"]] for r in self.rows[arm]))
            self.assertEqual(self.report["arms"][arm]["terminal_targets_after_read"], 64 if arm in {"t", "tm"} else 0)
        episode = read_jsonl(self.root / "decisions/t/episodes.jsonl")[0]
        scenario = self.frozen["t"][0][0]
        # Declaring a mutating propose_plan step as a harmless injected read must fail.
        with self.assertRaisesRegex(ValueError, "changed business state"):
            audit_read_states(scenario, episode, [4], load_catalog(ROOT / "benchmark/catalog.json"))

    def test_removing_valid_memory_changes_effective_value_not_merely_order(self):
        for row in self.frozen["m"][0]:
            if not row["memories"]:
                continue
            changed = deepcopy(row)
            good = sorted(changed["memories"], key=lambda m: m["revision"])[1]
            good["expires_on"] = row["as_of"]
            self.assertNotEqual(resolved_inputs(row["input"], row["memories"], row["as_of"])["constraints"]["equipment"],
                                resolved_inputs(changed["input"], changed["memories"], changed["as_of"])["constraints"]["equipment"])

    def test_schedule_rejects_unequal_targets_and_wrong_loss_masks(self):
        # Synthetic tokens test matching only; real pinned tokenization runs separately in CI.
        tokens = {}
        for arm in ARMS:
            tokens[arm] = []
            for row in self.rows[arm]:
                target = [ord(c) for c in encode(canonical_target(row))]
                prefix = [1, 2, 3]
                tokens[arm].append({"source_episode_id": row["source_episode_id"], "source_call_index": row["source_call_index"],
                    "input_ids": prefix + target, "attention_mask": [1] * (3 + len(target)),
                    "labels": [-100] * 3 + target, "prompt_tokens": 3, "target_tokens": len(target)})
            write_rows(self.root / "tokens" / arm / "tokens.jsonl", tokens[arm])
        schedule, _, _ = schedules(self.root)
        self.assertEqual(len(schedule["s0"]), 1008)
        self.assertEqual([s["index"] for s in schedule["s0"]], [s["index"] for s in schedule["tm"]])
        path = self.root / "tokens/tm/tokens.jsonl"
        bad = deepcopy(tokens["tm"])
        bad[0]["input_ids"][-1] += 1
        bad[0]["labels"][-1] += 1
        path.write_text("".join(encode(r) + "\n" for r in bad), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "token-identical"):
            schedules(self.root)
        bad = deepcopy(tokens["tm"])
        bad[0]["labels"][0] = 1
        path.write_text("".join(encode(r) + "\n" for r in bad), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "labels"):
            schedules(self.root)


if __name__ == "__main__":
    unittest.main()
