from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from d2_execution import read
from i2_gates import ARMS,evaluate
from i2_protocol import REFERENCE,validate_reference
from test_i1_protocol import maps


class GatesTests(unittest.TestCase):
    def test_preselected_D_and_fresh_A_gain_are_not_replaced_by_best_arm(self):
        arms={'A':maps(42,6),'B':maps(48,12),'C':maps(48,12),'D':maps(42,10)}
        def score(fixed=None,stops=None,blocked=0):
            with patch('i2_gates.panel_maps',side_effect=lambda r:r),patch('i2_gates.published_maps',
                side_effect=lambda a:(arms[a],stops or [],blocked)):
                return evaluate(arms,fixed or maps(26,7),{a:a for a in ARMS})
        result=score();self.assertTrue(result['candidate_passed']);self.assertEqual(result['preselected_candidate'],'D')
        self.assertEqual(result['factorial']['N_without_R']['d2_identity']['net'],6)
        arms['A']=maps(42,7)
        self.assertFalse(score()['mechanism_checks']['identity_net_gain_at_least_4'])
        arms['A']=maps(42,6);arms['D']=maps(41,10)
        self.assertFalse(score()['mechanism_checks']['memory_no_net_loss_vs_fresh_A'])
        arms['D']=maps(42,10)
        self.assertFalse(score(maps(26,11))['candidate_passed']);self.assertTrue(score(maps(26,11))['mechanism_passed'])
        self.assertFalse(score(stops=['wrong-stop'])['candidate_passed']);self.assertFalse(score(blocked=1)['candidate_passed'])
        arms['D']=maps(48,12,11)
        self.assertFalse(score()['candidate_passed'])

    def test_I1_trigger_and_checkpoint_selection_remain_fixed(self):
        reference=read(REFERENCE);self.assertEqual(validate_reference(reference),reference)
        for key,value in [('selection','best_G4_score'),('i1_candidate_passed',True),('i1_episodes_replayed',111),('model_result',False)]:
            with self.assertRaises(ValueError):validate_reference({**reference,key:value})
        broken=deepcopy(reference);broken['i1_view_sha256'].pop('normal/inputs.jsonl')
        with self.assertRaises(ValueError):validate_reference(broken)


if __name__=='__main__':unittest.main()
