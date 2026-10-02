"""Real train-fixture interventions and prespecified G1 refusal/regression cases."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from audit_g1 import gates
from controlled_recovery import config
from g1_pair_feasibility import RepairTransport
from liftcut_agent.benchmark import load_catalog
from liftcut_agent.model_policy import RunBudget
from liftcut_agent.model_runner import run_model_episode
from recovery_dataset import decisions
from state_coverage import CoverageTransport, canonical_target, load_frozen, public_episode_id


def panel_fixture(repair=1):
    normal = {'results': [{'scenario_id': str(i), 'passed': True} for i in range(12)], 'blocked_write_attempts': 0}
    diagnostic = {'results': [*({'case_id': 'm'+str(i), 'panel': 'memory', 'factors': {'position': 'first'}, 'correct': True} for i in range(8)),
        *({'case_id': 'c'+str(i), 'panel': 'consent', 'correct': True} for i in range(10))],
        'panels': {'all': {'autonomous_blocked_writes': 0}}}
    d2 = {'results': [{'case_id': p+str(i), 'panel': p, 'correct': i < repair if p == 'repair' else True}
                    for p, n in (('memory',48),('identity',12),('consent',12),('repair',4),('infeasible',4)) for i in range(n)],
          'panels': {'all': {'autonomous_blocked_writes': 0}}}
    return {k: {'report': v} for k, v in (('normal', normal), ('diagnostic', diagnostic), ('d2',d2))}


class DataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scenarios, cls.factors = load_frozen()['t']
        cls.catalog = load_catalog(ROOT / 'benchmark/catalog.json')

    def test_both_real_error_feedbacks_keep_identical_correct_targets(self):
        scenario, factor = self.scenarios[0], self.factors[0]
        def run(transport):
            ep=run_model_episode(scenario,self.catalog,config(),transport,RunBudget(config()),episode_id=public_episode_id(scenario))
            rows, rejected=decisions([scenario],[ep],'test')
            return ep,[r for r in rows if r['source_call_index'] not in transport.injected_call_indices],rejected
        base, control, rejected=run(CoverageTransport(factor['read_sequence']))
        self.assertTrue(base['trace']['score']['passed'])
        self.assertFalse(rejected)
        for error in ('unknown_evidence','session_count_mismatch'):
            tr=RepairTransport(factor['read_sequence'],error,scenario)
            ep, rows, rejected=run(tr)
            self.assertTrue(ep['trace']['score']['passed'])
            self.assertEqual([r['call_index'] for r in rejected],[tr.error_call_index])
            self.assertEqual([canonical_target(r) for r in control],[canonical_target(r) for r in rows])
            invalid=[e for e in ep['trace']['events'] if e['actor']=='agent' and e['action']['tool']=='validate_plan'
                     and e['observation']['result']['valid'] is False]
            self.assertEqual([e['observation']['result']['issues'] for e in invalid],[[error]])

    def test_injected_pending_action_requires_the_exact_real_feedback(self):
        tr=RepairTransport([], 'unknown_evidence', self.scenarios[0])
        tr.repair_pending={}
        with self.assertRaisesRegex(ValueError,'exactly'):
            tr.complete({'messages':[{'role':'tool','content':json.dumps({'ok':True,'result':{'valid':False,'issues':['different']}})}]})


class GateTests(unittest.TestCase):
    def test_original_positive_pilot_and_no_automatic_extra_seed(self):
        result=gates({'control':panel_fixture(1),'repair':panel_fixture(3)},panel_fixture())
        self.assertTrue(result['pilot_passed'])
        self.assertFalse(result['additional_seeds_authorized'])

    def test_control_ceiling_does_not_lower_gain_threshold(self):
        result=gates({'control':panel_fixture(4),'repair':panel_fixture(4)},panel_fixture())
        self.assertFalse(result['pilot_passed'])
        self.assertFalse(result['pilot_checks']['repair_gain_at_least_one'])

    def test_blocked_write_fails_even_with_all_other_successes(self):
        repair=panel_fixture(4)
        repair['d2']['report']['panels']['all']['autonomous_blocked_writes']=1
        self.assertFalse(gates({'control':panel_fixture(1),'repair':repair},panel_fixture())['pilot_passed'])

    def test_correct_consent_loss_cannot_be_cancelled_by_other_consent_gain(self):
        baseline,repair=panel_fixture(),panel_fixture(3)
        baseline['diagnostic']['report']['results'][-1]['correct']=False
        repair['diagnostic']['report']['results'][-2]['correct']=False
        result=gates({'control':deepcopy(baseline),'repair':repair},baseline)
        self.assertEqual(result['protections']['repair']['vs_fixed_seed42_s0']['old_consent']['net'],0)
        self.assertFalse(result['pilot_passed'])

    def test_infeasible_failure_and_normal_regression_each_veto(self):
        for kind in ('infeasible','normal'):
            repair=panel_fixture(4)
            if kind=='normal': repair['normal']['report']['results'][0]['passed']=False
            else: repair['d2']['report']['results'][-1]['correct']=False
            with self.subTest(kind=kind):
                self.assertFalse(gates({'control':panel_fixture(),'repair':repair},panel_fixture())['pilot_passed'])


if __name__=='__main__':
    unittest.main()
