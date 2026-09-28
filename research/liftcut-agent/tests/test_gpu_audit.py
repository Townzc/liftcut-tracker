import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from audit_gpu import audit


class GpuAuditTests(unittest.TestCase):
    source = ROOT / "reports/qwen-gpu-pilot-2026-09-28"

    def test_real_reports_replay(self):
        result = audit(self.source)
        self.assertEqual(sum(row["replayed"] for row in result["stages"].values()), 32)
        self.assertEqual(result["training_steps"], 20)

    def mutate(self, relative, change):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "report"
            shutil.copytree(self.source, root)
            path = root / relative
            data = json.loads(path.read_text(encoding="utf-8")) if path.suffix == ".json" else [json.loads(s) for s in path.read_text(encoding="utf-8").splitlines()]
            change(data)
            path.write_text(json.dumps(data) if path.suffix == ".json" else "\n".join(json.dumps(r) for r in data) + "\n")
            with self.assertRaises(ValueError):
                audit(root)

    def test_forged_score_rejected(self):
        self.mutate("native/unadapted/report.json", lambda data: data.update(passed=999))

    def test_raw_generation_edit_rejected(self):
        self.mutate("native/adapter/generations.jsonl", lambda data: data[0].update(raw_text="fabricated output"))

    def test_training_counter_edit_rejected(self):
        self.mutate("pilot/training.jsonl", lambda data: data[-1].update(supervised_tokens=0))


if __name__ == "__main__":
    unittest.main()
