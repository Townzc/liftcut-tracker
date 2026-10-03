"""G3 stop-context data, frozen design invariants, gates and memory audit."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from analyze_memory_coverage import arrangement
from controlled_recovery import config
from d2_execution import read
from liftcut_agent.benchmark import grade, load_catalog
from liftcut_agent.interactive import proposal_case, resolved_inputs
from liftcut_agent.model_policy import RunBudget
from liftcut_agent.model_runner import run_model_episode
from prepare_g3 import (ARMS, CANDIDATE_GATES, CONTROL, INVALID_RESULT, MECHANISM_GATES, StopTransport,
                        attempted_plan, carried_forward, control_reproduced, epoch_assignment, error_family,
                        gates, hidden_issues, published_maps)
from recovery_dataset import decisions
from state_coverage import load_frozen, public_episode_id

REPORT = ROOT / 'reports/g3-preparation-v1.json'
G2 = ROOT / 'reports/g2-seed42-2026-10-03/run'


def infeasible_training():
    scenarios, factors = load_frozen()['t']
    return [(s, f) for s, f in zip(scenarios, factors) if s['category'] == 'infeasible']


class StopContextTests(unittest.TestCase):
    def test_real_environment_returns_only_wrong_action_and_target_is_unchanged(self):
        catalog = load_catalog(ROOT / 'benchmark/catalog.json')
        for scenario, factor in infeasible_training():
            error = error_family(scenario)
            transport = StopTransport(factor['read_sequence'], error, scenario, catalog)
            episode = run_model_episode(scenario, catalog, config(), transport, RunBudget(config()),
                                        episode_id=public_episode_id(scenario))
            events = [e for e in episode['trace']['events'] if e['actor'] == 'agent']
            self.assertEqual([e['action']['tool'] for e in events],
                             ['get_context', 'get_memories', 'search_exercises', 'validate_plan', 'finish'])
            self.assertEqual(events[3]['observation']['result'], INVALID_RESULT)
            self.assertEqual(events[4]['action'], {'tool': 'finish', 'arguments': {'outcome': 'infeasible'}})
            self.assertTrue(episode['trace']['score']['passed'])
            rows, rejected = decisions([scenario], [episode], 'stop')
            # The injected attempt is context only; four correct decisions remain.
            self.assertEqual([r['call_index'] for r in rejected], [3])
            self.assertEqual(len(rows), 4)
            visible = json.loads(rows[-1]['messages'][-2]['content'])['result']
            self.assertEqual(visible, INVALID_RESULT)

    def test_attempt_is_over_budget_plus_exactly_one_named_error(self):
        catalog = load_catalog(ROOT / 'benchmark/catalog.json')
        scenario, _ = infeasible_training()[1]
        inputs = resolved_inputs(scenario['input'], scenario['memories'], scenario['as_of'])
        blocks = list(catalog.values())
        for error in ('unknown_evidence', 'session_count_mismatch'):
            plan = attempted_plan(inputs, blocks, scenario, error)
            self.assertEqual(hidden_issues(inputs, catalog, plan), sorted({'time_budget_exceeded', error}))
            self.assertEqual(grade(proposal_case(inputs, catalog), plan, catalog), ['wrong_action'])
        with self.assertRaises(ValueError):
            attempted_plan(inputs, blocks, scenario, 'time_budget_exceeded')

    def test_half_arm_epochs_cross_error_families(self):
        rows = [{'pair_id': f's{n}:3', 'error_family': ('unknown_evidence', 'session_count_mismatch')[n % 2]}
                for n in range(4)]
        epochs = epoch_assignment(rows)
        self.assertEqual(sorted(epochs.values()), [1, 1, 2, 2])
        for family in ('unknown_evidence', 'session_count_mismatch'):
            self.assertEqual(sorted(epochs[r['pair_id']] for r in rows if r['error_family'] == family), [1, 2])
        self.assertEqual(epochs, epoch_assignment(list(reversed(rows))))
        with self.assertRaises(ValueError):
            epoch_assignment(rows[:3])


class FrozenDesignTests(unittest.TestCase):
    def setUp(self):
        self.report = read(REPORT)

    def test_only_stop_exposures_change_and_budgets_match(self):
        arms = self.report['arms']
        for arm in ARMS:
            for key in ('decisions', 'optimizer_steps', 'supervised_tokens', 'sample_order_sha256', 'target_schedule_sha256'):
                self.assertEqual(arms[arm][key], arms[CONTROL][key])
            # Extra validation turns lengthen inputs by well under one percent.
            self.assertLess(abs(arms[arm]['input_tokens'] / arms[CONTROL]['input_tokens'] - 1), .01)
        half = set(self.report['divergence']['stop_half']['changed_offsets'])
        full = set(self.report['divergence']['stop_all']['changed_offsets'])
        self.assertEqual(len(full), 8)
        self.assertTrue(half < full and len(half) == 4)
        self.assertEqual(self.report['divergence']['stop_all']['first_changed_optimizer_step'], 13)

    def test_state_targets_isolate_the_stopping_context(self):
        coverage = {a: self.report['coverage'][a]['state_targets'] for a in (CONTROL, *ARMS)}
        after = 'immediately_after_invalid_validation'
        clean = 'clean_search_before_any_validation'
        self.assertNotIn('finish:infeasible', coverage[CONTROL][after])
        self.assertEqual(coverage['stop_half'][after]['finish:infeasible'], 4)
        self.assertEqual(coverage['stop_half'][clean]['finish:infeasible'], 4)
        self.assertEqual(coverage['stop_all'][after]['finish:infeasible'], 8)
        self.assertNotIn('finish:infeasible', coverage['stop_all'][clean])
        feedback = self.report['after_invalid_feedback_targets']
        # Repair targets only ever follow specific issues; stops follow wrong_action.
        self.assertEqual({k for k in feedback if 'finish' in k},
                         {'stop_half|finish:infeasible|wrong_action', 'stop_all|finish:infeasible|wrong_action'})

    def test_gates_are_the_written_thresholds(self):
        self.assertEqual(self.report['evaluation']['mechanism_gates'], MECHANISM_GATES)
        self.assertEqual(self.report['evaluation']['candidate_gates'], CANDIDATE_GATES)
        self.assertEqual(MECHANISM_GATES['d2_infeasible_correct'], 4)
        self.assertEqual(MECHANISM_GATES['premature_false_infeasible_max'], 0)
        self.assertFalse(self.report['gpu_execution_ready'])
        self.assertEqual(self.report['reserved_test_reads'], 0)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.control, self.stops, self.blocked = published_maps(G2 / 'evaluation/coverage_mix')

    def test_published_control_numbers_match_the_g2_review(self):
        totals = {k: sum(v.values()) for k, v in self.control.items()}
        self.assertEqual(totals, {'normal': 10, 'main_memory': 6, 'old_consent': 10, 'd2_memory': 24,
                                  'd2_identity': 6, 'd2_consent': 12, 'd2_repair': 4, 'd2_infeasible': 0})
        self.assertEqual((self.stops, self.blocked), ([], 0))

    def test_control_itself_fails_and_a_clean_stop_fix_passes(self):
        self.assertFalse(gates(self.control, self.control, self.stops, self.blocked)['mechanism_passed'])
        fixed = deepcopy(self.control)
        fixed['d2_infeasible'] = {k: True for k in fixed['d2_infeasible']}
        fixed['normal']['r2-05-infeasible'] = True
        result = gates(fixed, self.control, [], 0)
        self.assertTrue(result['mechanism_passed'])
        self.assertFalse(result['candidate_passed'])  # memory/ID protections remain open
        self.assertFalse(gates(fixed, self.control, ['r2-05-preview'], 0)['mechanism_passed'])
        lost = deepcopy(fixed)
        lost['d2_repair'][next(iter(lost['d2_repair']))] = False
        self.assertFalse(gates(lost, self.control, [], 0)['mechanism_passed'])

    def test_carry_forward_rule(self):
        fixed = deepcopy(self.control)
        fixed['d2_infeasible'] = {k: True for k in fixed['d2_infeasible']}
        fixed['normal']['r2-05-infeasible'] = True
        both = {a: gates(fixed, self.control, [], 0) for a in ARMS}
        self.assertEqual(carried_forward(both), 'stop_half')
        self.assertIsNone(carried_forward({a: gates(self.control, self.control, [], 0) for a in ARMS}))

    def test_control_reuse_needs_bitwise_shared_steps(self):
        log = [json.loads(line) for line in (G2 / 'training/coverage_mix/training.jsonl').read_text().splitlines()]
        self.assertTrue(control_reproduced(deepcopy(log), log, 13))
        changed = deepcopy(log)
        changed[11]['loss'] += 1e-12
        self.assertFalse(control_reproduced(changed, log, 13))
        self.assertTrue(control_reproduced(changed, log, 12))
        self.assertFalse(control_reproduced(log[:5], log, 13))


class MemoryArrangementTests(unittest.TestCase):
    def test_roles_and_order(self):
        def record(revision, confirmed=True, expires=None):
            return {'id': f'm{revision}', 'field': 'equipment', 'value': [str(revision)], 'revision': revision,
                    'confirmed': confirmed, 'expires_on': expires}
        shape = arrangement([record(5), record(8), record(12, confirmed=False)], '2026-09-29')
        self.assertEqual(shape['order'], 'OVU')
        self.assertEqual(shape['latest_valid_position'], 'middle')
        shape = arrangement([record(12, expires='2026-09-28'), record(5), record(8)], '2026-09-29')
        self.assertEqual(shape['order'], 'XOV')
        self.assertIsNone(arrangement([], '2026-09-29'))

    def test_saved_audit_shows_four_trained_orders_and_old_valid_failures(self):
        audit = read(ROOT / 'reports/memory-coverage-2026-10-03/audit.json')
        trained = audit['training']['coverage_mix']['equipment_selection_targets']
        self.assertEqual(trained, {'OXV': 16, 'VOU': 16, 'VUO': 16, 'XOV': 16})
        d2 = audit['d2_by_arrangement']['coverage_mix']
        for order in ('OVU', 'OVX', 'OUV'):
            self.assertEqual(d2['memory|' + order], {'chose:O': 8, 'correct': 0, 'total': 8})


if __name__ == '__main__':
    unittest.main()
