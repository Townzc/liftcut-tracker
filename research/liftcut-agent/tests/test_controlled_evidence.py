import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from audit_controlled import audit_generations
from controlled_recovery import config, prepare, public_episode_id
from controlled_rollout import evaluation_cases, summarize_controlled
from liftcut_agent.benchmark import load_catalog, read_jsonl
from liftcut_agent.model_runner import replay_model_suite
from publish_controlled import verify_publication
from server_workspace import sha256

REPORT = ROOT / "reports/qwen-controlled-recovery-2026-09-29"


class ControlledEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.prepared = Path(cls.tmp.name)
        prepare(cls.prepared / "decisions")
        cls.scenarios, cls.prefixes = evaluation_cases(cls.prepared)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_all_63_real_episodes_and_raw_generations_replay(self):
        for arm in ("unadapted", "clean", "mixed"):
            directory = REPORT / "evaluation" / arm
            episodes = read_jsonl(directory / "episodes.jsonl")
            report = summarize_controlled(self.scenarios, self.prefixes, episodes)
            report["replay"] = replay_model_suite(self.scenarios, load_catalog(ROOT / "benchmark/catalog.json"), config(), episodes)
            self.assertEqual(report["replay"]["replayed"], 21)
            self.assertEqual(report, json.loads((directory / "report.json").read_text(encoding="utf-8")))
            self.assertEqual([e["trace"]["episode_id"] for e in episodes], [public_episode_id(s) for s in self.scenarios])
            calls = [c for e in episodes for c in e["calls"][len(self.prefixes[e["scenario_id"]]["calls"])
                     if e["scenario_id"] in self.prefixes else 0:]]
            audit_generations(calls, read_jsonl(directory / "generations.jsonl"))

    def test_public_inventory_covers_every_file_and_excludes_weights(self):
        inventory = json.loads((REPORT / "publication-manifest.json").read_text(encoding="utf-8"))
        actual = {p.relative_to(REPORT).as_posix(): sha256(p) for p in REPORT.rglob("*")
                  if p.is_file() and p.name != "publication-manifest.json"}
        self.assertEqual(actual, inventory["files"])
        self.assertFalse(any(name.endswith((".safetensors", ".pt", ".pth", ".bin")) for name in actual))

    def test_published_file_change_is_rejected_before_replaying(self):
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "report"
            shutil.copytree(REPORT, copied)
            changed = copied / "evaluation/mixed/report.json"
            changed.write_bytes(changed.read_bytes() + b" ")
            with self.assertRaisesRegex(ValueError, "inventory mismatch"):
                verify_publication(copied, self.prepared)
