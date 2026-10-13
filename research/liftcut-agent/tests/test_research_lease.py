import copy
from datetime import datetime, timezone
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from research_lease import validate


def lease():
    return {'version':'liftcut-research-lease-v1','booted_at_proxy':'2026-10-13T04:27:00+00:00',
        'shutdown_at_utc':'2026-10-13T15:00:00+00:00','hourly_cny':2.18,'reserve_cny':25,
        'automatic_shutdown':True,'automatic_reboot':False,'paid_api_calls':0,
        'disk_expansion':False,'heldout_tasks_allowed':0,'authorization':'User: keep until Oct13 08:00 America/Los_Angeles',
        'maximum_followup_trials':2,'final_collection_buffer_minutes':45}


class LeaseTest(unittest.TestCase):
    def test_original_absolute_cutoff(self):
        value=lease();end=validate(value,datetime(2026,10,13,4,40,tzinfo=timezone.utc))
        self.assertEqual(end,datetime(2026,10,13,15,tzinfo=timezone.utc))

    def test_reject_stale_and_excess_scope(self):
        for key,value in [('reserve_cny',20),('reserve_cny',float('nan')),('hourly_cny',True),
                          ('automatic_reboot',True),('paid_api_calls',1),('heldout_tasks_allowed',48),
                          ('automatic_shutdown',False),('shutdown_at_utc','2026-10-14T15:00:00+00:00')]:
            with self.subTest(key=key,value=value):
                changed=copy.deepcopy(lease());changed[key]=value
                with self.assertRaises(ValueError):validate(changed)
        for now in [datetime(2026,10,13,4,tzinfo=timezone.utc),datetime(2026,10,13,15,tzinfo=timezone.utc)]:
            with self.assertRaises(ValueError):validate(lease(),now)


if __name__=='__main__':unittest.main()
