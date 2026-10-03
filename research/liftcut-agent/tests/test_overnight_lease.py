"""Overnight handoff must not affect workers or retire guards without replacement."""
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import overnight_lease as lease


def config():
    return {'version':'liftcut-overnight-lease-v1','deadline':lease.DEADLINE,'reserve_cny':20,'hourly_cny':2.18,
            'execution_commit':lease.COMMIT,'g3_run':lease.RUN,'original_hard_cutoff':lease.ORIGINAL_HARD,
            'code_root':f'/root/autodl-tmp/liftcut/code/{lease.COMMIT}/research/liftcut-agent',
            'authorization':'explicit_user_20261003_overnight_0700_Los_Angeles_CNY20',
            'booted_at_proxy':'2026-10-03T05:35:00.409447+00:00','earlier_failed_opening_cny':0.3630052281944445}


class LeaseTests(unittest.TestCase):
    def test_includes_prior_failure_and_rejects_expired_or_changed_budget(self):
        cfg=config()
        _,amount=lease.validate_lease(cfg,datetime(2026,10,3,7,tzinfo=timezone.utc))
        self.assertGreater(amount,18.7)
        self.assertLess(amount,20)
        for key,value in [('deadline','2026-10-03T15:00:00+00:00'),('reserve_cny',21),('hourly_cny',2.19)]:
            with self.subTest(key=key),self.assertRaises(ValueError):
                lease.validate_lease({**cfg,key:value},datetime(2026,10,3,7,tzinfo=timezone.utc))
        with self.assertRaises(ValueError):
            lease.validate_lease(cfg,datetime(2026,10,3,14,tzinfo=timezone.utc))

    def test_pid_reuse_or_zombie_never_matches(self):
        identity={'pid':12,'argv':['python','original'],'start_ticks':'99','state':'S'}
        for changed in ({'start_ticks':'100'},{'argv':['python','other']},{'state':'Z'}):
            with patch.object(lease,'process',return_value={**identity,**changed}),self.assertRaises(ValueError):
                lease.checked_process(identity)

    def test_missing_guard_never_signals_original_controller(self):
        cfg={**config(),'controller_identity':{'pid':12}}
        with tempfile.TemporaryDirectory() as temp,patch.object(lease,'now',return_value=datetime(2026,10,3,7,tzinfo=timezone.utc)),patch.object(lease.os,'kill') as kill:
            with self.assertRaises(FileNotFoundError):
                lease.handoff(cfg,Path(temp))
            kill.assert_not_called()

    def test_no_archive_is_not_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertIsNone(lease.archive_ready(Path(temp),config()))


if __name__=='__main__':
    unittest.main()
