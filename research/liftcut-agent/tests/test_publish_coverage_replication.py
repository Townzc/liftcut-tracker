"""R1 publication tests: scripted native replies and tiny SYNTHETIC tensor bytes.

No model or GPU is executed. Tokenizer audit is explicitly stubbed here; real
pinned-tokenizer replay remains mandatory in the production publisher.
"""
from copy import deepcopy
import json
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
import test_coverage_replication as fixtures
import publish_coverage_replication as publisher
from prepare_coverage_replication import ARMS, arm_binding, run_binding, read
from liftcut_agent.interactive import digest
from liftcut_agent.model_policy import encode
from run_recovery_window import archive_run
from run_controlled_window import evidence_backup
from server_workspace import dump_new, sha256


def save(path, value):
    path.write_text(encode(value) + "\n", encoding="utf-8", newline="\n")


def rebind(value):
    if isinstance(value, dict):
        return {k: rebind(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rebind(v) for v in value]
    return publisher.EXECUTION_COMMIT if value == "a" * 40 else value


class ReplicationPublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reuse the existing explicitly scripted fixture builder and its scoped
        # preparation/token stubs; production native/environment replay stays real.
        fixtures.ReplicationOperationsTests.setUpClass()
        cls.addClassCleanup(fixtures.ReplicationOperationsTests.doClassCleanups)
        base = fixtures.ReplicationOperationsTests
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.root, cls.plan = Path(cls.tmp.name), deepcopy(base.plan)
        cls.diagnostic = base.diagnostic
        mocked = patch.object(publisher, "verify_prepared", return_value=cls.plan)
        mocked.start()
        cls.addClassCleanup(mocked.stop)
        run = Path(shutil.copytree(base.fixture, cls.root / "synthetic-source"))
        for path in run.rglob("*.json"):
            save(path, rebind(read(path)))
        for arm in ARMS:
            train = run / "training" / arm
            binding = arm_binding(cls.plan, publisher.EXECUTION_COMMIT, arm)
            row = read(train / "training.jsonl")
            row["binding_digest"] = digest(binding)
            save(train / "training.jsonl", row)
            # This is a tiny valid-shaped safetensors header plus synthetic data,
            # not a real adapter. Weight hashes and tensor metadata are read for real.
            header = json.dumps({"synthetic_test_tensor": {
                "dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
            weight = train / "final/adapter_model.safetensors"
            weight.write_bytes(struct.pack("<Q", len(header)) + header + struct.pack("<f", ARMS.index(arm)))
            hashes = {n: sha256(train / "final" / n) for n in ("adapter_config.json", "adapter_model.safetensors")}
            for path in (train / "report.json", run / "evaluation" / arm / "manifest.json"):
                row = read(path)
                row["adapter_sha256"] = hashes
                save(path, row)
        binding = run_binding(cls.plan, publisher.EXECUTION_COMMIT)
        save(run / "window-status.json", {"status": "complete", "failures": [], "run_binding": binding,
            "code_commit": publisher.EXECUTION_COMMIT, "test_episodes": 0})
        save(run / "comparison.json", base.run_audit(run))
        downloads = cls.root / "downloads"
        downloads.mkdir()
        archives = []
        for arm in ARMS:
            item = archive_run(run / "training" / arm)
            archives.append({"part": arm, "binding": arm_binding(cls.plan, publisher.EXECUTION_COMMIT, arm),
                "path": "training/" + item["archive"], **item})
            shutil.copyfile(run / "training" / item["archive"], downloads / item["archive"])
        item = evidence_backup(run)
        archives.append({"part": "evidence", "binding": binding, "path": item["archive"], **item})
        shutil.copyfile(run / item["archive"], downloads / item["archive"])
        index = {"status": "complete", "run_binding": binding, "archives": archives}
        dump_new(downloads / "backup-ready.json", {**index, "inventory_digest": digest(index)})
        fixtures.restorer.assemble(downloads, cls.root, cls.diagnostic, cls.root, 43, cls.root,
            publisher.EXECUTION_COMMIT, cls.root / "restored")
        cls.private = cls.root / "restored/run"
        # A sensitive-looking unrelated file must never enter the static allowlist.
        (cls.private / ".env").write_text("SYNTHETIC_TEST_SECRET=never-copy", encoding="utf-8")
        cls.public = cls.root / "public"
        publisher.publish(cls.private, cls.root, cls.diagnostic, cls.root, 43, cls.root, cls.public)

    def setUp(self):
        self.scratch = Path(tempfile.mkdtemp(dir=self.root))

    def copied_public(self):
        return Path(shutil.copytree(self.public, self.scratch / "public"))

    def copied_private(self):
        return Path(shutil.copytree(self.private, self.scratch / "private"))

    def refresh_public_hashes(self, run):
        manifest = read(run / "publication-manifest.json")
        manifest["files"] = {p.relative_to(run).as_posix(): sha256(p) for p in run.rglob("*")
            if p.is_file() and p.relative_to(run).as_posix() != "publication-manifest.json"}
        save(run / "publication-manifest.json", manifest)

    def check(self, run, *, seed=43, allow=True):
        return publisher.verify_publication(run, self.root, self.diagnostic, self.root, seed, self.root,
            allow_missing_weights=allow)

    def publish(self, run):
        return publisher.publish(run, self.root, self.diagnostic, self.root, 43, self.root, self.scratch / "new-public")

    def test_full_five_archive_restore_then_public_native_replay_keeps_attestation(self):
        result = self.check(self.public)
        self.assertEqual(result["episodes_replayed"], 124)
        self.assertFalse(result["adapter_files_verified"])
        self.assertTrue(result["token_ids_verified"])
        self.assertTrue(read(self.public / "comparison.json")["adapter_files_verified"])
        self.assertEqual(read(self.private / "comparison.json"), read(self.public / "comparison.json"))
        self.assertFalse((self.public / ".env").exists())
        files = set(read(self.public / "publication-manifest.json")["files"])
        self.assertEqual(files, set(publisher.public_paths()) | {"adapter-verification.json", "README.md"})
        self.assertFalse(any(n.endswith((".safetensors", ".bin", ".pt")) for n in files))

    def test_omitted_weights_require_explicit_public_replay_permission(self):
        with self.assertRaisesRegex(ValueError, "explicit allow_missing_weights"):
            self.check(self.public, allow=False)

    def test_publishing_requires_actual_weight_bytes_even_after_original_ack(self):
        run = self.copied_private()
        (run / "training/s0/final/adapter_model.safetensors").write_bytes(b"TAMPERED SYNTHETIC TEST WEIGHTS")
        with self.assertRaisesRegex(ValueError, "adapter file mismatch"):
            self.publish(run)
        self.assertFalse((self.scratch / "new-public").exists())

    def test_partial_seed_never_enters_complete_publisher(self):
        run = self.copied_private()
        receipt = read(run / "off-instance-verification.json")
        receipt.update(run_status="failed", complete_study_replayed=False, episodes_replayed=0,
                       adapter_files_verified=False, token_ids_verified=False)
        save(run / "off-instance-verification.json", receipt)
        with self.assertRaisesRegex(ValueError, "complete actual-weight"):
            self.publish(run)
        self.assertFalse((self.scratch / "new-public").exists())

    def test_receipt_seed_or_execution_commit_cannot_be_relabelled(self):
        for key, value in (("seed", 44), ("code_commit", "0" * 40)):
            with self.subTest(key=key):
                run = Path(shutil.copytree(self.private, self.scratch / key))
                receipt = read(run / "off-instance-verification.json")
                receipt["run_binding"][key] = value
                save(run / "off-instance-verification.json", receipt)
                with self.assertRaisesRegex(ValueError, "binding mismatch"):
                    publisher.verify_restore_scope(run, self.plan)

    def test_omitting_archive_receipt_or_token_attestation_is_rejected(self):
        for key, value in (("archives", []), ("token_ids_verified", False)):
            with self.subTest(key=key):
                run = Path(shutil.copytree(self.private, self.scratch / key))
                receipt = read(run / "off-instance-verification.json")
                receipt[key] = value
                save(run / "off-instance-verification.json", receipt)
                with self.assertRaises(ValueError):
                    publisher.verify_restore_scope(run, self.plan)

    def test_extra_credential_or_weight_file_rejected_even_if_manifest_is_rehashed(self):
        run = self.copied_public()
        (run / ".env").write_text("SYNTHETIC_TEST_SECRET=not-public", encoding="utf-8")
        self.refresh_public_hashes(run)
        with self.assertRaisesRegex(ValueError, "inventory mismatch"):
            self.check(run)

    def test_public_comparison_cannot_erase_historical_weight_verification(self):
        run = self.copied_public()
        result = read(run / "comparison.json")
        result["adapter_files_verified"] = False
        save(run / "comparison.json", result)
        self.refresh_public_hashes(run)
        with self.assertRaisesRegex(ValueError, "lost weight attestation"):
            self.check(run)

    def test_rehashed_native_text_tamper_is_rejected_by_real_native_replay(self):
        run = self.copied_public()
        path = run / "evaluation/s0/normal/generations.jsonl"
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        rows[0]["raw_text"] += " SYNTHETIC TAMPER"
        path.write_text("".join(encode(row) + "\n" for row in rows), encoding="utf-8")
        self.refresh_public_hashes(run)
        with self.assertRaisesRegex(ValueError, "native text"):
            self.check(run)

    def test_rehashed_token_audit_tamper_is_rejected_by_independent_token_check(self):
        run = self.copied_public()
        save(run / "generation-token-audit.json", {"scope": "FORGED TEST RECEIPT"})
        self.refresh_public_hashes(run)
        with self.assertRaisesRegex(ValueError, "token audit differs"):
            self.check(run)

    def test_rehashed_tensor_hash_tamper_is_rejected(self):
        run = self.copied_public()
        metadata = read(run / "adapter-verification.json")
        metadata["saved_tensor_metadata"]["s0"]["sha256"] = "0" * 64
        save(run / "adapter-verification.json", metadata)
        self.refresh_public_hashes(run)
        with self.assertRaisesRegex(ValueError, "saved tensor metadata"):
            self.check(run)

    def test_seed42_is_not_a_new_replication_publication(self):
        with self.assertRaisesRegex(ValueError, "seed42 is CPU-only"):
            self.check(self.public, seed=42)


if __name__ == "__main__":
    unittest.main()
