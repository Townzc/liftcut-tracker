import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from restore_recovery import restore
from server_workspace import sha256


class RestoreTests(unittest.TestCase):
    def make_archive(self, directory, extra=None, corrupt=False):
        archive = directory / "run.tar.gz"
        content = b"recorded evidence\n"
        inventory = {"files": [{"path": "nested/log.txt", "bytes": len(content),
                                "sha256": hashlib.sha256(content).hexdigest()}]}
        files = {"run/nested/log.txt": b"corrupt" if corrupt else content,
                 "run/backup-inventory.json": json.dumps(inventory).encode()}
        if extra:
            files[extra] = b"unexpected"
        with tarfile.open(archive, "w:gz") as tar:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
        return archive

    def test_restore_checks_every_file_and_refuses_existing_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            archive = self.make_archive(directory)
            result = restore(archive, directory / "restored", sha256(archive))
            self.assertEqual(result["verified_files"], 1)
            with self.assertRaisesRegex(ValueError, "destination"):
                restore(archive, directory / "restored", sha256(archive))

    def test_rejects_bad_archive_hash_extra_files_and_path_escape(self):
        for extra in ("run/unlisted.txt", "../escape.txt"):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                archive = self.make_archive(directory, extra)
                with self.assertRaises(ValueError):
                    restore(archive, directory / "restored", sha256(archive))
                self.assertFalse((directory / "restored").exists())
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            archive = self.make_archive(directory)
            with self.assertRaisesRegex(ValueError, "archive SHA256"):
                restore(archive, directory / "restored", "0" * 64)

    def test_corrupt_member_does_not_receive_success_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            archive = self.make_archive(directory, corrupt=True)
            with self.assertRaisesRegex(ValueError, "artifact size/hash"):
                restore(archive, directory / "restored", sha256(archive))
            self.assertFalse((directory / "restored/restore-receipt.json").exists())


if __name__ == "__main__":
    unittest.main()
