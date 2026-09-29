"""Replay real public traces with stdlib; tokenizer CI also audits full preparation."""
from copy import deepcopy
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from audit_controlled import audit_generations
from audit_state_coverage import paired_comparisons
from coverage_case_study import render_normal
from check_coverage_repairs import review_repairs
from coverage_rollout import normal_report
from gpu_state_diagnostics import read
from liftcut_agent.benchmark import load_catalog, read_jsonl
from publish_state_coverage import public_paths, verify_publication, verify_restore_scope, verify_token_receipt
from review_state_coverage import describe_normal
from server_workspace import sha256
from state_coverage import ARMS, original
from state_diagnostics import fixtures, replay, summary

REPORT = ROOT / "reports/qwen-state-coverage-2026-09-29"


class CoveragePublishedEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog(ROOT / "benchmark/catalog.json")
        cls.scenarios = original("dev")
        cases = fixtures(cls.catalog)
        cls.arms = {}
        for arm in ARMS:
            panels = {}
            for panel in ("normal", "diagnostic"):
                path = REPORT / "evaluation" / arm / panel
                episodes = read_jsonl(path / "episodes.jsonl")
                if panel == "normal":
                    result = normal_report(cls.scenarios, cls.catalog, episodes)
                    calls = [{"case_id": e["scenario_id"], "call": c} for e in episodes for c in e["calls"]]
                else:
                    result = {**summary(cases, episodes), "replay": replay(cases, cls.catalog, episodes)}
                    calls = [{"case_id": e["case_id"], "call": c} for e in episodes
                             for c in e["calls"][e["scripted_prefix_calls"]:]]
                if result != read(path / "report.json") or calls != read_jsonl(path / "calls.jsonl"):
                    raise AssertionError("published reports or durable calls differ from actual replay")
                generations = read_jsonl(path / "generations.jsonl")
                audit_generations([r["call"] for r in calls], generations)
                result["actual_model_generations"] = sum(g["model_called"] for g in generations)
                result["local_context_guards"] = sum(not g["model_called"] for g in generations)
                panels[panel] = result
            cls.arms[arm] = panels

    def test_every_actual_episode_and_prespecified_comparison_reproduces(self):
        expected = read(REPORT / "comparison.json")
        self.assertEqual(self.arms, expected["arms"])
        self.assertEqual(paired_comparisons(self.arms), expected["comparisons"])
        self.assertEqual(expected["episodes_replayed"], 124)
        self.assertEqual(expected["test_episodes"], 0)
        verify_restore_scope(REPORT)
        verify_token_receipt(REPORT, expected)

    def test_analysis_entrypoints_start_without_a_configured_pythonpath(self):
        env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        with tempfile.TemporaryDirectory() as folder:
            for name in ("coverage_case_study.py", "plot_state_coverage.py", "check_coverage_repairs.py"):
                with self.subTest(entrypoint=name):
                    result = subprocess.run([sys.executable, str(ROOT / name), "--help"], cwd=folder,
                                            env=env, capture_output=True, text=True, timeout=30)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("--run-dir", result.stdout)

    def test_missing_normal_episode_remains_in_the_denominator(self):
        episodes = read_jsonl(REPORT / "evaluation/t/normal/episodes.jsonl")
        with self.assertRaisesRegex(ValueError, "missing, duplicate or reordered"):
            normal_report(self.scenarios, self.catalog, episodes[:-1])

    def test_native_text_tamper_is_rejected_even_when_the_length_stays_equal(self):
        path = REPORT / "evaluation/t/diagnostic"
        calls = [r["call"] for r in read_jsonl(path / "calls.jsonl")]
        generations = deepcopy(read_jsonl(path / "generations.jsonl"))
        original_text = generations[0]["raw_text"]
        generations[0]["raw_text"] = original_text.replace("awaiting_user", "awaiting_uses")
        self.assertNotEqual(generations[0]["raw_text"], original_text)
        self.assertEqual(len(generations[0]["raw_text"]), len(original_text))
        with self.assertRaisesRegex(ValueError, "native text"):
            audit_generations(calls, generations)

    def test_exact_public_inventory_has_no_model_weights(self):
        manifest = read(REPORT / "publication-manifest.json")
        files = {p.relative_to(REPORT).as_posix(): sha256(p) for p in REPORT.rglob("*")
                 if p.is_file() and p.name != "publication-manifest.json"}
        self.assertEqual(files, manifest["files"])
        self.assertEqual(set(files), set(public_paths()) |
                         {"adapter-verification.json", "review.json", "scripted-repair-checks.json", "README.md"})
        self.assertFalse(any(n.endswith((".safetensors", ".pt", ".bin")) for n in files))

    def test_extra_artifact_cannot_bypass_the_publication_allowlist(self):
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "public"
            shutil.copytree(REPORT, copied)
            (copied / "unexpected.txt").write_text("not part of the verified publication", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "inventory mismatch"):
                verify_publication(copied, Path(folder) / "unused", Path(folder) / "unused")

    def test_grounding_regressions_are_visible_in_the_case_review(self):
        episodes = read_jsonl(REPORT / "evaluation/t/normal/episodes.jsonl")
        ids = {"r2-05-missing_time", "r2-05-missing_equipment", "r2-05-missing_days"}
        selected = [describe_normal(e) for e in episodes if e["scenario_id"] in ids]
        self.assertEqual(len(selected), 3)
        for row in selected:
            self.assertFalse(row["passed"])
            self.assertTrue(row["finish_after_invalid_validation"])
            self.assertEqual(row["invalid_validations"][-1]["issues"], ["unknown_evidence"])
        case = render_normal(REPORT, "r2-05-missing_time")
        self.assertIn("unknown_evidence", case)
        self.assertIn("infeasible", case)
        for arm in ARMS:
            self.assertIn("## " + arm.upper(), case)

    def test_minimal_scripted_repairs_show_valid_proposals_without_inflating_model_scores(self):
        hashes = {a: sha256(REPORT / "evaluation" / a / "normal/episodes.jsonl") for a in ("t", "m")}
        result = review_repairs(REPORT)
        self.assertEqual(result, read(REPORT / "scripted-repair-checks.json"))
        self.assertEqual(len(result["cases"]), 4)
        self.assertEqual(result["new_complete_task_successes"], 0)
        self.assertEqual(result["new_model_calls"], 0)
        for row in result["cases"]:
            self.assertTrue(row["validation"]["result"]["valid"])
            self.assertFalse(row["complete_task_success_claimed"])
            self.assertEqual(row["writes_added"], 0)
        self.assertEqual(hashes, {a: sha256(REPORT / "evaluation" / a / "normal/episodes.jsonl") for a in hashes})


if __name__ == "__main__":
    unittest.main()
