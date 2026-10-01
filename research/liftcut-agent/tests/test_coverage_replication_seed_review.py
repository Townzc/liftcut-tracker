"""Explicitly synthetic audit results; no new tokenizer, weights or model execution."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import review_coverage_replication_seed as reviewer
from audit_state_coverage import paired_comparisons
from prepare_coverage_replication import ARMS
from server_workspace import dump_new


def fixture(seed=43):
    """Fabricated development-shaped scores, intentionally not real model outputs."""
    arms = {}
    for arm in ARMS:
        normal = [{"scenario_id": f"SYNTHETIC-normal-{i}", "passed": i < (11 if arm in ("t", "tm") else 12),
                   "blocked_write_attempts": 0} for i in range(12)]
        consent = [{"case_id": f"SYNTHETIC-consent-{i}", "panel": "consent",
                    "factors": {"history": "read" if i < 3 else "plain"},
                    "correct": arm in ("t", "tm") or i >= 3,
                    "autonomous_blocked_writes": 0} for i in range(10)]
        memory = [{"case_id": f"SYNTHETIC-memory-{i}", "panel": "memory",
                   "factors": {"position": None if i == 8 else ("first" if i % 2 else "last"),
                               "clarification": i % 2 == 0},
                   "correct": i < (5 if arm in ("m", "tm") else 2),
                   "autonomous_blocked_writes": int(arm == "m" and i == 0)} for i in range(9)]
        arms[arm] = {"normal": {"results": normal, "blocked_write_attempts": 0},
                     "diagnostic": {"results": consent + memory,
                                    "panels": {"consent": {"autonomous_blocked_writes": 0},
                                               "memory": {"autonomous_blocked_writes": int(arm == "m")}}}}
    return {"scope": "SYNTHETIC UNIT TEST ONLY", "run_binding": {"seed": seed},
            "adapter_files_verified": True, "token_ids_verified": True,
            "initial_adapter_sha256": "f" * 64, "episodes_replayed": 124, "test_episodes": 0,
            "arms": arms, "comparisons": paired_comparisons(arms)}


def training_fixture(path):
    rows = [{"step": i, "decisions": i * 8, "supervised_tokens": i * 330,
             "input_tokens": i * 1000, "elapsed_seconds": float(i)} for i in range(1, 127)]
    rows[-1]["supervised_tokens"] = 41788
    report = {"steps": 126, "processed": {key: rows[-1][key] for key in ("decisions", "supervised_tokens", "input_tokens")},
              "optimization_seconds": 127.0}
    dump_new(path / "report.json", report)
    (path / "training.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    return report, rows


class SeedReviewTests(unittest.TestCase):
    def test_preserves_original_gates_and_blocked_cases_without_promoting(self):
        current, original = fixture(), fixture(42)
        before = deepcopy(current)
        result = reviewer.summarize(43, current, original)
        self.assertEqual(result["original_screening"]["current"], current["comparisons"])
        self.assertTrue(result["original_screening"]["current"]["pairs"]["s0->m"]["development_gate_passed"])
        self.assertEqual(result["arms"]["m"]["blocked_attempts"]["current"]["total"], 1)
        self.assertEqual(result["arms"]["m"]["blocked_attempts"]["current"]["cases"][0]["case_id"], "SYNTHETIC-memory-0")
        self.assertEqual(current, before)
        self.assertEqual(result["three_seed_review"]["required_seeds"], [42, 43, 44])
        self.assertEqual(result["representative_checkpoint_seed"], 42)
        self.assertNotIn("original_screen_reproduced_in_all_three", str(result))

    def test_retains_cross_seed_case_gains_and_losses_without_pooling(self):
        current, original = fixture(44), fixture(42)
        original["arms"]["t"]["normal"]["results"][0]["passed"] = False
        original["arms"]["t"]["normal"]["results"][11]["passed"] = True
        original["comparisons"] = paired_comparisons(original["arms"])
        result = reviewer.summarize(44, current, original)
        self.assertEqual(result["arms"]["t"]["case_changes_vs_seed42"]["normal"],
                         {"gained": ["SYNTHETIC-normal-0"], "lost": ["SYNTHETIC-normal-11"], "net": 0})
        self.assertEqual(result["arms"]["t"]["counts"]["normal"]["total"], 12)

    def test_rejects_metadata_only_wrong_seed_partial_and_changed_gates(self):
        original = fixture(42)
        mutations = [lambda r: r.update(adapter_files_verified=False),
                     lambda r: r.update(token_ids_verified=False),
                     lambda r: r["run_binding"].update(seed=44),
                     lambda r: r.update(episodes_replayed=123),
                     lambda r: r.update(test_episodes=1),
                     lambda r: r["comparisons"]["pairs"]["s0->t"].update(development_gate_passed=False)]
        for mutate in mutations:
            current = fixture()
            mutate(current)
            with self.assertRaises(ValueError):
                reviewer.summarize(43, current, original)
        for seed in (42, 45, True, "43"):
            with self.assertRaises(ValueError):
                reviewer.summarize(seed, fixture(), original)

    def test_rejects_cross_seed_factor_drift_and_case_inventory_change(self):
        original, current = fixture(42), fixture()
        current["arms"]["t"]["diagnostic"]["results"][10]["factors"]["position"] = "middle"
        current["comparisons"] = paired_comparisons(current["arms"])
        with self.assertRaisesRegex(ValueError, "factors differ"):
            reviewer.summarize(43, current, original)
        current = fixture()
        for arm in ARMS:
            current["arms"][arm]["normal"]["results"][0]["scenario_id"] = "SYNTHETIC-replacement"
        current["comparisons"] = paired_comparisons(current["arms"])
        with self.assertRaisesRegex(ValueError, "unpaired cross-seed"):
            reviewer.summarize(43, current, original)

    def test_rejects_inconsistent_blocked_count_without_rewriting_m_gate(self):
        current = fixture()
        current["arms"]["m"]["diagnostic"]["panels"]["memory"]["autonomous_blocked_writes"] = 2
        current["comparisons"] = paired_comparisons(current["arms"])
        with self.assertRaisesRegex(ValueError, "summary differs"):
            reviewer.summarize(43, current, fixture(42))

    def test_observed_training_duration_is_not_billable_time_or_loss_accuracy(self):
        with tempfile.TemporaryDirectory() as directory:
            training = Path(directory)
            training_fixture(training)
            result = reviewer.training_observation(training)
            self.assertEqual(result["optimization_loop_seconds"], 127.0)
            self.assertEqual(result["supervised_tokens"], 41788)
            self.assertEqual(result["sample_uses"], 1008)
            self.assertIn("not cloud billable time", result["timer_limit"])
            self.assertEqual(set(result["source_sha256"]), {"report.json", "training.jsonl"})
            self.assertNotIn("loss", result)

    def test_rejects_bad_timing_and_counter_observations(self):
        with tempfile.TemporaryDirectory() as directory:
            training = Path(directory)
            report, rows = training_fixture(training)
            for seconds in (float("nan"), float("inf"), -1, 100, True):
                report["optimization_seconds"] = seconds
                (training / "report.json").write_text(json.dumps(report), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "timer"):
                    reviewer.training_observation(training)
            report["optimization_seconds"] = 127
            report["processed"]["supervised_tokens"] = 1
            (training / "report.json").write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "counters"):
                reviewer.training_observation(training)

    def test_cli_review_requires_full_replay_and_saved_comparison_agreement(self):
        with tempfile.TemporaryDirectory() as directory:
            root, current, original = Path(directory), fixture(), fixture(42)
            historical = root / "reports/qwen-state-coverage-2026-09-29"
            run = root / "run"
            dump_new(run / "comparison.json", current)
            dump_new(historical / "comparison.json", original)
            replayed_original = {**original, "adapter_files_verified": False}
            for arm in ARMS:
                training_fixture(run / "training" / arm)
            with patch.object(reviewer, "ROOT", root), patch.object(reviewer, "audit", return_value=current) as full_audit, \
                    patch.object(reviewer, "audit_original", return_value=replayed_original) as old_audit:
                result = reviewer.review(run, root, root, root, 43, root)
                full_audit.assert_called_once_with(run, root, root, root, 43, root)
                old_audit.assert_called_once_with(historical, root, root, verify_weights=False)
                self.assertTrue(result["verification"]["current_actual_weights"])
                self.assertFalse(result["verification"]["seed42_actual_weights_rechecked"])
                self.assertEqual(set(result["training"]), set(ARMS))
                forged = deepcopy(current)
                forged["initial_adapter_sha256"] = "a" * 64
                (run / "comparison.json").write_text(json.dumps(forged), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "complete replay"):
                    reviewer.review(run, root, root, root, 43, root)


if __name__ == "__main__":
    unittest.main()
