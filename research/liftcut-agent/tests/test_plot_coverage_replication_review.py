"""Synthetic three-seed plotting inputs; no real seed44 result or model execution."""
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import plot_coverage_replication_review as plotting
from review_coverage_replication import summarize


def synthetic_review():
    """Reuse public 42/43 and deliberately COPY 42 as fake44 for schema tests only."""
    old_path = ROOT / "reports/qwen-state-coverage-2026-09-29/comparison.json"
    new_path = ROOT / "reports/qwen-coverage-replication-seed43-2026-10-01/comparison.json"
    old = json.loads(old_path.read_text(encoding="utf-8"))
    current = json.loads(new_path.read_text(encoding="utf-8"))
    review = summarize({42: old, 43: current, 44: deepcopy(old)})
    review["source_sha256"] = {"seed42_comparison": hashlib.sha256(old_path.read_bytes()).hexdigest(),
        "seed43_comparison": hashlib.sha256(new_path.read_bytes()).hexdigest(),
        "seed44_comparison": hashlib.sha256(b"SYNTHETIC ONLY; SEED44 WAS NOT RUN BY THIS TEST").hexdigest()}
    review["initialization"] = {"seed42": "not recorded by the historical runner",
        "seed43": current["initial_adapter_sha256"], "seed44": "b" * 64, "new_seeds_differ": True}
    return review


class ReviewValidationTests(unittest.TestCase):
    def setUp(self):
        self.review = synthetic_review()

    def test_frozen_summary_shape_accepted_without_changing_review(self):
        before = deepcopy(self.review)
        self.assertIs(plotting.validate_review(self.review), self.review)
        self.assertEqual(before, self.review)
        self.assertTrue(self.review["pairs"]["s0->t"]["effects"]["main_memory"]["sign_reversal"])
        self.assertFalse(self.review["prospective_non_regression_guard"]["t"]["all_three_pass"])

    def test_missing_extra_or_substituted_seed_rejected_in_every_layer(self):
        for location in (lambda r: r["panels"], lambda r: r["pairs"]["s0->t"]["per_seed"],
                         lambda r: r["pairs"]["s0->t"]["effects"]["normal"]["per_seed"],
                         lambda r: r["prospective_non_regression_guard"]["t"]["per_seed"]):
            for replacement in (None, "45"):
                review = deepcopy(self.review)
                target = location(review)
                removed = target.pop("44")
                if replacement: target[replacement] = removed
                with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                    plotting.validate_review(review)
        with self.assertRaises(ValueError): plotting.validate_review({"seed": 44, "arms": {}})

    def test_representative_calls_tests_and_bool_counters_are_not_coerced(self):
        for key, value in (("representative_checkpoint_seed", 43), ("new_model_calls", 1),
                           ("test_episodes", 48), ("new_model_calls", False), ("test_episodes", False)):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                plotting.validate_review({**self.review, key: value})
        self.review["panels"]["44"]["s0"]["normal"] = True
        with self.assertRaises(ValueError): plotting.validate_review(self.review)

    def test_pair_case_overlap_duplicate_excess_and_wrong_net_rejected(self):
        for change in ({"gained": ["a"], "lost": ["a"], "net": 0},
                       {"gained": ["a", "a"], "lost": [], "net": 2},
                       {"gained": [str(i) for i in range(13)], "lost": [], "net": 13},
                       {"gained": [], "lost": [], "net": 1}):
            review = deepcopy(self.review)
            review["pairs"]["s0->t"]["per_seed"]["44"]["normal"] = change
            with self.subTest(change=change), self.assertRaises(ValueError): plotting.validate_review(review)

    def test_panel_counts_and_subpanel_membership_must_match(self):
        changed = deepcopy(self.review)
        changed["panels"]["42"]["t"]["normal"] += 1
        with self.assertRaises(ValueError): plotting.validate_review(changed)
        changed = deepcopy(self.review)
        changed["pairs"]["s0->t"]["per_seed"]["43"]["read_consent"]["gained"][0] = "SYNTHETIC-UNRELATED"
        with self.assertRaises(ValueError): plotting.validate_review(changed)

    def test_all_effect_statistics_and_strict_sign_reversal_are_checked(self):
        for key, value in (("mean", float("nan")), ("mean", 99), ("minimum", -99),
                           ("maximum", 99), ("sign_reversal", False)):
            review = deepcopy(self.review)
            review["pairs"]["s0->t"]["effects"]["main_memory"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): plotting.validate_review(review)
        changed = deepcopy(self.review)
        # Normal deltas are [-1, 0, -1]: a zero and a negative do not reverse sign.
        changed["pairs"]["s0->t"]["effects"]["normal"]["sign_reversal"] = True
        with self.assertRaises(ValueError): plotting.validate_review(changed)

    def test_original_screen_cannot_be_promoted_or_confused_with_guard(self):
        for edit in (lambda r: r["pairs"]["s0->t"].update(original_screen_pass_count=0),
                     lambda r: r["pairs"]["s0->t"].update(original_screen_reproduced_in_all_three=False),
                     lambda r: r["pairs"]["s0->t"]["per_seed"]["42"].update(development_gate_passed=False),
                     lambda r: r["prospective_non_regression_guard"]["t"].update(all_three_pass=True),
                     lambda r: r["prospective_non_regression_guard"]["t"]["per_seed"]["42"].update(necessary_guard_passed=True)):
            changed = deepcopy(self.review); edit(changed)
            with self.assertRaises(ValueError): plotting.validate_review(changed)

    def test_blocked_attempts_and_lost_consent_cannot_be_hidden_by_guard(self):
        changed = deepcopy(self.review)
        changed["prospective_non_regression_guard"]["tm"]["per_seed"]["42"]["autonomous_blocked_writes"] = 0
        with self.assertRaises(ValueError): plotting.validate_review(changed)
        changed = deepcopy(self.review)
        changed["prospective_non_regression_guard"]["t"]["per_seed"]["43"]["lost_correct_consent_cases"] = ["invented"]
        with self.assertRaises(ValueError): plotting.validate_review(changed)

    def test_added_blocked_cases_cannot_invent_a_screen_failure_with_zero_attempts(self):
        pair = self.review["pairs"]["s0->t"]
        row = pair["per_seed"]["43"]
        self.assertEqual(self.review["panels"]["43"]["t"]["autonomous_blocked_writes"], 0)
        row["cases_with_added_blocked_writes"] = ["SYNTHETIC-INVENTED-BLOCKED-CASE"]
        row["development_gate_passed"] = False
        pair["original_screen_pass_count"] = sum(r["development_gate_passed"] for r in pair["per_seed"].values())
        pair["original_screen_reproduced_in_all_three"] = False
        with self.assertRaisesRegex(ValueError, "added blocked-write cases"):
            plotting.validate_review(self.review)

    def test_positive_blocked_delta_requires_at_least_one_added_case(self):
        row = self.review["pairs"]["m->tm"]["per_seed"]["42"]
        self.assertGreater(row["autonomous_blocked_write_delta"], 0)
        row["cases_with_added_blocked_writes"] = []
        with self.assertRaisesRegex(ValueError, "added blocked-write cases"):
            plotting.validate_review(self.review)

    def test_read_consent_and_memory_ids_cannot_overlap_in_either_direction(self):
        for seed, memory_direction in (("43", "gained"), ("42", "lost")):
            changed = deepcopy(self.review)
            row = changed["pairs"]["s0->t"]["per_seed"][seed]
            row["read_consent"]["gained"][0] = row["main_memory"][memory_direction][0]
            with self.subTest(seed=seed, direction=memory_direction), self.assertRaisesRegex(ValueError, "must be disjoint"):
                plotting.validate_review(changed)

    def test_missing_provenance_or_invented_seed42_initialization_rejected(self):
        for edit in (lambda r: r.pop("source_sha256"),
                     lambda r: r["source_sha256"].update(seed44_comparison="not-a-hash"),
                     lambda r: r["initialization"].update(seed42="a" * 64),
                     lambda r: r["initialization"].update(seed44=r["initialization"]["seed43"])):
            changed = deepcopy(self.review); edit(changed)
            with self.assertRaises(ValueError): plotting.validate_review(changed)

    def test_duplicate_json_keys_rejected_before_plotting(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.json"
            path.write_text('{"test_episodes":48,' + json.dumps(self.review)[1:], encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate"): plotting.read_review(path)

    def test_existing_figure_is_never_overwritten_even_without_matplotlib(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.png"
            path.write_bytes(b"KEEP ORIGINAL")
            with self.assertRaisesRegex(ValueError, "never overwrite"): plotting.plot(self.review, path)
            self.assertEqual(path.read_bytes(), b"KEEP ORIGINAL")
            with self.assertRaisesRegex(ValueError, "format"): plotting.plot(self.review, Path(directory) / "new.txt")

    def test_cli_uses_review_only_and_reports_no_new_source_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "synthetic.json", Path(directory) / "synthetic.png"
            source.write_text(json.dumps(self.review), encoding="utf-8")
            with patch.object(sys, "argv", ["plot", "--review", str(source), "--output", str(output)]), \
                    patch.object(plotting, "plot") as plot, patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(plotting.main(), 0)
            plot.assert_called_once_with(self.review, output)
            report = json.loads(stdout.getvalue())
            self.assertIs(report["source_audit_performed_now"], False)
            self.assertEqual(report["new_model_calls"], 0)
            self.assertEqual(report["test_episodes"], 0)


if __name__ == "__main__":
    unittest.main()
