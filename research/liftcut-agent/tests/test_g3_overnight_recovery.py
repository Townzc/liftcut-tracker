"""Inspected archive resume preserves old bytes and refuses mismatches before appending."""
from contextlib import contextmanager
import hashlib
import io
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
import recover_g3_overnight as recovery


class Budget:
    def check(self): pass


class FakeSFTP:
    def __init__(self,content): self.content=content
    def lstat(self,path): return SimpleNamespace(st_mode=stat.S_IFREG,st_size=len(self.content))
    @contextmanager
    def open(self,path,mode):
        yield io.BytesIO(self.content)


class RecoveryTests(unittest.TestCase):
    def exercise(self,remote_hash):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root=Path(temp.name);old=root/'original';new=root/'new';old.mkdir();new.mkdir()
        data=b'prefix-and-real-remaining-test-bytes'
        partial=old/'stop_half.tar.gz.fixture.partial';partial.write_bytes(data[:6])
        item={'archive':'stop_half.tar.gz','path':'training/stop_half.tar.gz','bytes':len(data),
              'sha256':hashlib.sha256(data).hexdigest()}
        cfg={'downloads':new,'remote_run':recovery.RUN}
        with patch.object(recovery,'io_budget'),patch.object(recovery,'remote_python',return_value={'sha256':remote_hash}):
            recovery.resume_archive(None,FakeSFTP(data),item,cfg,Budget(),lambda *a,**k:None,old)
        self.assertEqual(partial.read_bytes(),data[:6])
        self.assertEqual((new/item['archive']).read_bytes(),data)

    def test_verified_prefix_can_resume_and_original_stays_unchanged(self):
        self.exercise(hashlib.sha256(b'prefix').hexdigest())

    def test_mismatched_prefix_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'does not match remote prefix'):
            self.exercise('0'*64)

    def test_different_existing_full_archive_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path=root/'stop_half.tar.gz';path.write_bytes(b'wrong')
            item={'archive':path.name,'bytes':5,'sha256':'0'*64}
            with self.assertRaisesRegex(ValueError,'different existing full archive'):
                recovery.resume_archive(None,None,item,{'downloads':root},None,None,root)
            self.assertEqual(path.read_bytes(),b'wrong')


if __name__=='__main__': unittest.main()
