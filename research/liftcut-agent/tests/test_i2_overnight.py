from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from i2_protocol import binding,deadlines,validate_opening,BUDGET,aware
from launch_i2_overnight import science_unchanged
from run_i2_window import finalize
from drill_d2_execution import ScriptClock
from test_research_lease import lease


class OvernightTests(unittest.TestCase):
    def test_trial_has_same_60_20_budget_without_resetting_machine_opening(self):
        power={**lease(),'final_collection_buffer_minutes':45}
        start='2026-10-13T05:15:00+00:00';boot=power['booted_at_proxy']
        work,collect,hard=deadlines(boot,start,aware(start),power_lease=power)
        self.assertEqual((work-aware(start)).total_seconds(),3600)
        self.assertEqual((collect-work).total_seconds(),1200)
        self.assertEqual((hard-aware(start)).total_seconds(),5400)
        with self.assertRaises(TimeoutError):deadlines(boot,start,aware(start))
        with self.assertRaises(ValueError):deadlines(start,start,aware(start),power_lease=power)
        with self.assertRaises(TimeoutError):deadlines(boot,'2026-10-13T13:00:00+00:00',aware('2026-10-13T13:00:00+00:00'),power_lease=power)
        b=binding({'reference':{}},'a'*40,boot,start,power_lease=power)
        opening={'binding':b,'budget':BUDGET,'booted_at_proxy':boot,'trial_started_at_utc':start,'started_at_utc':start,'evidence_kind':'model'}
        self.assertEqual(validate_opening(opening,{'reference':{}}),b)
        changed=deepcopy(opening);changed['binding']['power_lease']['shutdown_at_utc']='2026-10-13T16:00:00+00:00'
        with self.assertRaises(ValueError):validate_opening(changed,{'reference':{}})
        changed=deepcopy(opening);del changed['binding']['power_lease']
        with self.assertRaises(TimeoutError):validate_opening(changed,{'reference':{}})

    def test_only_execution_sources_may_differ_from_prepared_plan(self):
        old={'source_sha256':{'a':'old'},'gates':{'threshold':10},'budget':BUDGET,'candidate':'D'}
        science_unchanged(old,{**old,'source_sha256':{'a':'new'}})
        for field,value in [('gates',{'threshold':9}),('candidate','B'),('budget',{})]:
            with self.assertRaises(ValueError):science_unchanged(old,{**old,field:value})

    def test_completion_or_backup_failure_retains_instance_and_never_writes_shutdown(self):
        for failure in (False,True):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as directory:
                out=Path(directory);clock=ScriptClock();clock.value=aware('2026-10-13T06:00:00+00:00');calls=[]
                def sleep(seconds):clock.value+=timedelta(seconds=seconds)
                def archive(_):
                    if failure:raise OSError('scripted full disk')
                    return {'archive':'evidence.tar.gz','sha256':'a'*64,'bytes':1}
                finalize(out,'partial',[],{'hard_cutoff':'2026-10-13T06:30:00+00:00','power_lease':lease()},
                    clock.now()+timedelta(seconds=35),clock,sleep=sleep,archive=archive,shutdown=lambda:calls.append(1))
                self.assertFalse(calls);self.assertFalse((out/'shutdown-request.json').exists())
                close=json.loads((out/'window-close.json').read_text())
                self.assertFalse(close['off_instance_acknowledged'])
                self.assertEqual(close['power_action'],'retain_under_original_overnight_guard')


if __name__=='__main__':unittest.main()
