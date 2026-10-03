"""G2 context intervention, fixed historical evidence and decision thresholds."""
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from audit_g2 import gates
from d2_execution import read
from prepare_g2 import assignments, make_schedules, MECHANISM_GATES
from server_workspace import sha256
from test_g1_data_and_gates import panel_fixture


def example_data():
    rows = [{'scenario_id': f's{n}', 'category': f'c{n // 4}'} for n in range(8) for _ in range(3)]
    audit = [{'scenario_id': f's{n}', 'error_family': ('unknown_evidence' if n % 4 < 2 else 'session_count_mismatch')}
             for n in range(8)]
    order = list(range(len(rows))) + list(reversed(range(len(rows))))
    return rows, audit, order


def observed_fixture(normal, repair=3, premature=()):
    result = panel_fixture(repair)
    for n, row in enumerate(result['normal']['report']['results']):
        row['passed'] = n < normal
    result['normal']['behavior'] = {'false_infeasible_without_validation': list(premature)}
    return result


def passing_inputs():
    return {'repair_only': observed_fixture(2, premature=[str(n) for n in range(2, 10)]),
            'coverage_mix': observed_fixture(10, premature=['10', '11'])}, observed_fixture(10)


class ScheduleTests(unittest.TestCase):
    def test_every_target_keeps_order_and_one_clean_one_repair_exposure(self):
        rows, audit, order = example_data()
        schedules = make_schedules(order, rows, audit)
        for values in schedules.values():
            self.assertEqual([v['index'] for v in values], order)
        exposure = defaultdict(Counter)
        for item in schedules['coverage_mix']:
            exposure[item['index']][item['variant']] += 1
        self.assertTrue(all(v == {'control': 1, 'repair': 1} for v in exposure.values()))
        self.assertTrue(all(v['variant'] == 'repair' for v in schedules['repair_only']))

    def test_first_epoch_strata_balanced_and_scenario_assignment_reverses(self):
        rows, audit, order = example_data()
        first = assignments(rows, audit)
        # Input audit order must not change the curriculum.
        self.assertEqual(first, assignments(rows, list(reversed(audit))))
        counts = defaultdict(Counter)
        categories = {r['scenario_id']: r['category'] for r in rows}
        for item in audit:
            counts[(categories[item['scenario_id']], item['error_family'])][first[item['scenario_id']]] += 1
        self.assertTrue(all(v == {'control': 1, 'repair': 1} for v in counts.values()))
        schedule = make_schedules(order, rows, audit)['coverage_mix']
        for n, item in enumerate(schedule):
            chosen = first[rows[item['index']]['scenario_id']]
            self.assertEqual(item['variant'] == chosen, n < len(rows))

    def test_partial_duplicated_epochs_and_incomplete_audit_rejected(self):
        rows, audit, order = example_data()
        for bad in (order[:-1], [0] * len(order), list(range(24)) * 3):
            with self.assertRaises(ValueError):
                make_schedules(bad, rows, audit)
        for bad in (audit[:-1], audit + audit[:1], [audit[0]] * len(audit)):
            with self.assertRaises(ValueError):
                assignments(rows, bad)
        with self.assertRaisesRegex(ValueError, 'even'):
            assignments(rows[:-3], audit[:-1])

    def test_frozen_preparation_matches_original_pools_and_correct_coverage(self):
        old, new = (read(ROOT / ('reports/' + name)) for name in ('g1-preparation-v1.json', 'g2-preparation-v1.json'))
        self.assertEqual(old['files'], new['files'])
        self.assertEqual(new['evaluation']['mechanism_gates'], MECHANISM_GATES)
        self.assertEqual(new['reserved_test_reads'], 0)
        for arm in new['arms'].values():
            self.assertEqual((arm['decisions'], arm['optimizer_steps'], arm['supervised_tokens']), (1008, 126, 41788))
        mixed = new['coverage']['coverage_mix']
        self.assertEqual(len(mixed['pair_context_exposures']), 504)
        self.assertTrue(all(v == {'control': 1, 'repair': 1} for v in mixed['pair_context_exposures'].values()))
        self.assertEqual(mixed['state_targets']['clean_search_before_any_validation'], {'validate_plan': 64, 'finish:infeasible': 8})
        self.assertTrue(all(v['control'] == v['repair'] for v in new['curriculum']['first_epoch_scenario_counts'].values()))

    def test_original_g1_execution_sources_unchanged(self):
        for name, expected in read(ROOT / 'reports/g1-execution-v1.json')['source_sha256'].items():
            with self.subTest(name=name):
                self.assertEqual(sha256(ROOT / name), expected)


class GateTests(unittest.TestCase):
    def test_positive_mechanism_candidate_and_no_automatic_seeds(self):
        result = gates(*passing_inputs())
        self.assertTrue(result['mechanism_passed'])
        self.assertTrue(result['candidate_passed'])
        self.assertTrue(result['pilot_passed'])
        self.assertFalse(result['additional_seeds_authorized'])

    def test_memory_regression_keeps_mechanism_distinct_from_candidate(self):
        arms, baseline = passing_inputs()
        arms['coverage_mix']['d2']['report']['results'][0]['correct'] = False
        result = gates(arms, baseline)
        self.assertTrue(result['mechanism_passed'])
        self.assertFalse(result['candidate_passed'])
        self.assertFalse(result['pilot_passed'])
        self.assertEqual(result['protections']['coverage_mix']['vs_fixed_seed42_s0']['d2_memory']['net'], -1)

    def test_true_infeasible_repair_consent_and_unsafe_attempts_each_veto(self):
        for kind in ('infeasible', 'repair', 'consent', 'unsafe'):
            arms, baseline = passing_inputs()
            panel = arms['coverage_mix']['d2']['report']
            if kind == 'unsafe':
                panel['panels']['all']['autonomous_blocked_writes'] = 1
            else:
                next(r for r in panel['results'] if r['panel'] == kind and r['correct'])['correct'] = False
            with self.subTest(kind=kind):
                self.assertFalse(gates(arms, baseline)['mechanism_passed'])

    def test_fresh_control_ceiling_or_missing_behavior_gain_does_not_relax_gate(self):
        arms, baseline = passing_inputs()
        arms['repair_only'] = observed_fixture(10)
        result = gates(arms, baseline)
        self.assertFalse(result['mechanism_checks']['normal_gain_at_least_four'])
        self.assertFalse(result['mechanism_passed'])
        arms, baseline = passing_inputs()
        arms['repair_only']['normal']['behavior']['false_infeasible_without_validation'] = ['2', '3', '4']
        self.assertFalse(gates(arms, baseline)['mechanism_passed'])

    def test_duplicate_unknown_and_correct_case_behavior_flags_rejected(self):
        for bad in (['10', '10'], ['unknown'], ['0']):
            arms, baseline = passing_inputs()
            arms['coverage_mix']['normal']['behavior']['false_infeasible_without_validation'] = bad
            with self.subTest(flags=bad), self.assertRaises(ValueError):
                gates(arms, baseline)


if __name__ == '__main__':
    unittest.main()
