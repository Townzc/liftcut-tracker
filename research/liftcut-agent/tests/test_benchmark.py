import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from liftcut_agent.benchmark import evaluate, grade, load_catalog, read_jsonl, rule_baseline, validate_cases


class BenchmarkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.cases = read_jsonl(ROOT / "benchmark/dev-seeds.jsonl")

    def setUp(self):
        self.case = copy.deepcopy(self.cases[0])
        self.prediction = rule_baseline(self.case["input"], self.catalog)

    def score(self, prediction=None, case=None):
        return grade(case or self.case, self.prediction if prediction is None else prediction, self.catalog)

    def test_authored_development_seed_coverage(self):
        validate_cases(self.cases, self.catalog)
        self.assertEqual(len(self.cases), 30)
        self.assertEqual({case["split"] for case in self.cases}, {"dev"})
        self.assertEqual(len({case["category"] for case in self.cases}), 6)

    def test_rule_baseline_matches_declared_contract(self):
        rows = [{"case_id": case["id"], "prediction": rule_baseline(case["input"], self.catalog)}
                for case in self.cases]
        report = evaluate(self.cases, rows, self.catalog)
        self.assertEqual((report["total"], report["passed"]), (30, 30))

    def test_other_feasible_plan_is_accepted(self):
        for session in self.prediction["sessions"]:
            session["exercise_ids"] = ["dumbbell-b", "dumbbell-c"]
        self.assertEqual(self.score(), [])

    def test_exact_session_count_not_only_upper_bound(self):
        self.prediction["sessions"].pop()
        self.assertIn("session_count_mismatch", self.score())

    def test_duplicate_and_unavailable_days_fail(self):
        self.prediction["sessions"][1]["day"] = self.prediction["sessions"][0]["day"]
        self.assertIn("duplicate_day", self.score())
        self.prediction["sessions"][1]["day"] = "sun"
        self.assertIn("unavailable_day", self.score())

    def test_equipment_and_explicit_exclusions_are_checked(self):
        self.prediction["sessions"][0]["exercise_ids"] = ["barbell-a", "barbell-b"]
        self.assertIn("equipment_or_exclusion_violation", self.score())
        self.case["input"]["constraints"]["excluded_exercise_ids"] = ["bodyweight-a"]
        self.prediction = rule_baseline(self.cases[0]["input"], self.catalog)
        self.assertIn("equipment_or_exclusion_violation", self.score())

    def test_duration_is_recomputed_from_catalog(self):
        case = self.cases[10]  # exactly 13 minutes for two bodyweight blocks
        prediction = {"action": "propose_plan", "evidence_ids": ["record-011"],
                      "sessions": [{"day": day, "exercise_ids": ["bodyweight-a", "bodyweight-c"]}
                                   for day in ["tue", "fri"]]}
        self.assertIn("time_budget_exceeded", self.score(prediction, case))
        prediction["sessions"][0]["minutes"] = 1
        self.assertIn("invalid_session_fields", self.score(prediction, case))

    def test_unknown_duplicate_and_too_few_exercises_fail(self):
        for ids, failure in [(["invented", "bodyweight-a"], "unknown_exercise"),
                             (["bodyweight-a", "bodyweight-a"], "invalid_or_duplicate_exercise_ids"),
                             (["bodyweight-a"], "insufficient_exercises")]:
            with self.subTest(ids=ids):
                self.prediction["sessions"][0]["exercise_ids"] = ids
                self.assertIn(failure, self.score())

    def test_evidence_must_exist_and_not_be_empty_when_available(self):
        self.prediction["evidence_ids"] = ["invented-record"]
        self.assertIn("unknown_evidence", self.score())
        self.prediction["evidence_ids"] = []
        self.assertIn("missing_evidence", self.score())

    def test_no_record_does_not_require_fabricated_citation(self):
        case = self.cases[27]
        self.assertEqual(self.score(rule_baseline(case["input"], self.catalog), case), [])

    def test_clarification_must_identify_all_and_only_missing_fields(self):
        case = self.cases[19]
        prediction = {"action": "request_clarification", "missing_fields": ["equipment"]}
        self.assertIn("incorrect_missing_fields", self.score(prediction, case))
        prediction["missing_fields"] = ["equipment", "min_exercises", "available_days"]
        self.assertIn("incorrect_missing_fields", self.score(prediction, case))
        prediction["missing_fields"] = ["equipment", "min_exercises"]
        self.assertEqual(self.score(prediction, case), [])

    def test_refusing_feasible_case_is_failure(self):
        self.assertIn("wrong_action", self.score({"action": "report_infeasible"}))

    def test_unexpected_mutation_field_is_rejected(self):
        self.prediction["apply_changes"] = True
        self.assertIn("invalid_prediction_fields", self.score())

    def test_malformed_predictions_fail_without_crashing(self):
        for value in [None, True, 1, "plan", [], {}, {"action": []}, {"action": "invented"}]:
            with self.subTest(value=value):
                self.assertTrue(grade(self.case, value, self.catalog))
        for field in ("sessions", "evidence_ids"):
            for value in [None, 1, "bad", {}, [None], [["nested"]]]:
                with self.subTest(field=field, value=value):
                    prediction = copy.deepcopy(self.prediction)
                    prediction[field] = value
                    self.assertTrue(grade(self.case, prediction, self.catalog))

    def test_missing_predictions_stay_in_denominator(self):
        rows = [{"case_id": self.case["id"], "prediction": self.prediction}]
        report = evaluate(self.cases, rows, self.catalog)
        self.assertEqual((report["total"], report["passed"]), (30, 1))
        self.assertEqual(report["failure_counts"]["missing_prediction"], 29)
        self.assertEqual(evaluate(self.cases, [], self.catalog)["passed"], 0)

    def test_duplicate_or_unknown_predictions_reject_entire_run(self):
        row = {"case_id": self.case["id"], "prediction": self.prediction}
        for rows in ([row, row], [{**row, "case_id": "unknown"}]):
            with self.assertRaises(ValueError):
                evaluate(self.cases, rows, self.catalog)

    def test_group_leakage_is_rejected_for_family_and_persona(self):
        for field in ("family_id", "persona_id"):
            other = copy.deepcopy(self.cases[5])
            other["split"] = "test"
            other[field] = self.case[field]
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "cross-split"):
                validate_cases([self.case, other], self.catalog)

    def test_identical_input_cannot_hide_behind_new_group_ids(self):
        other = copy.deepcopy(self.case)
        other.update(id="other", family_id="other-family", persona_id="other-persona", split="test")
        with self.assertRaisesRegex(ValueError, "identical input"):
            validate_cases([self.case, other], self.catalog)

    def test_bad_labels_duplicate_ids_and_boolean_numbers_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate scenario"):
            validate_cases([self.case, self.case], self.catalog)
        self.case["expected_action"] = "report_infeasible"
        with self.assertRaisesRegex(ValueError, "inconsistent expected"):
            validate_cases([self.case], self.catalog)
        self.case = copy.deepcopy(self.cases[0])
        self.case["input"]["constraints"]["sessions_per_week"] = True
        with self.assertRaisesRegex(ValueError, "sessions_per_week"):
            validate_cases([self.case], self.catalog)

    def test_jsonl_rejects_ambiguous_and_malformed_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.jsonl"
            for content in ('{"a":1,"a":2}', '{"a":NaN}', '[]', '{invalid}'):
                with self.subTest(content=content):
                    path.write_text(content, encoding="utf-8")
                    with self.assertRaises(ValueError):
                        read_jsonl(path)


class CommandTests(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "run.py"), *map(str, args)],
                              capture_output=True, text=True, encoding="utf-8", cwd=ROOT.parent)

    def test_baseline_export_and_score_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            predictions = Path(directory) / "predictions.jsonl"
            report = Path(directory) / "report.json"
            exported = self.run_cli("baseline", "--write-predictions", predictions, "--output", report)
            self.assertEqual(exported.returncode, 0, exported.stderr)
            scored = self.run_cli("score", "--predictions", predictions)
            self.assertEqual(scored.returncode, 0, scored.stderr)
            self.assertEqual(json.loads(scored.stdout)["passed"], 30)
            self.assertIn("cases_sha256", json.loads(report.read_text(encoding="utf-8")))

    def test_empty_predictions_score_zero_and_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.jsonl"
            path.write_text("", encoding="utf-8")
            result = self.run_cli("score", "--predictions", path)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(json.loads(result.stdout)["total"], 30)

    def test_existing_artifacts_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.json"
            report.write_text("preserve", encoding="utf-8")
            result = self.run_cli("baseline", "--output", report)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(report.read_text(encoding="utf-8"), "preserve")

    def test_malformed_input_and_wrong_flags_are_errors(self):
        result = self.run_cli("score")
        self.assertEqual(result.returncode, 2)
        result = self.run_cli("validate", "--write-predictions", "unused.jsonl")
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
