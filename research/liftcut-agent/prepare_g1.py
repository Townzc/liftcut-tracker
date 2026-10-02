"""Freeze the original G1 pilot: two fresh T arms, paired correct targets."""
import argparse
import math
from pathlib import Path
import random

from d2_execution import ROOT, read
from g1_pair_feasibility import check_pairs
from gpu_pilot import validate_tokens
from liftcut_agent.benchmark import read_jsonl
from liftcut_agent.interactive import digest
from server_workspace import dump_new, sha256

ARMS = ('control', 'repair')
REVIEWED = ROOT / 'reports/g1-preparation-v1.json'
GATE = ROOT / 'reports/d2-fixed-seed42-2026-10-02/review.json'
BUDGET = {'hourly_cny': 2.18, 'reserve_cny': 8, 'setup_minutes': 10,
          'work_minutes': 150, 'hard_minutes': 180, 'compute_proxy_cny': 6.54,
          'storage_expansion': False, 'separate_new_opening_required': True}
SOURCES = ('g1_pair_feasibility.py', 'prepare_g1.py', 'state_coverage.py', 'controlled_recovery.py',
           'recovery_dataset.py', 'src/liftcut_agent/trajectories.py', 'src/liftcut_agent/model_runner.py',
           'src/liftcut_agent/model_policy.py', 'src/liftcut_agent/interactive.py')


def schedules(directory):
    report = read(directory / 'report.json')
    if (report['d2_gate_report_sha256'] != sha256(GATE) or not read(GATE)['g1']['any_behavior_trigger']
            or report['injected_errors'] != {'unknown_evidence': 32, 'session_count_mismatch': 32}
            or not report['all_correct_actions_and_target_tokens_identical']):
        raise ValueError('original complete D2 gate and both train-only error families required')
    expected_files = {f'{a}/{n}.jsonl' for a in ARMS for n in ('episodes', 'decisions', 'tokens', 'context-audit')}
    actual = {p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()}
    if set(report['files']) != expected_files or actual != expected_files | {'report.json'}:
        raise ValueError('exact G1 preparation inventory required')
    for name, value in report['files'].items():
        if sha256(directory / name) != value:
            raise ValueError('G1 paired input bytes changed')
    tokens = {a: read_jsonl(directory / a / 'tokens.jsonl') for a in ARMS}
    decisions = {a: read_jsonl(directory / a / 'decisions.jsonl') for a in ARMS}
    ids = [r['pair_id'] for r in decisions['control']]
    if len(ids) != 504 or len(set(ids)) != 504:
        raise ValueError('504 unique correct decision pairs required')
    for arm in ARMS:
        validate_tokens(tokens[arm])
        if ([r['pair_id'] for r in decisions[arm]] != ids or len(tokens[arm]) != 504
                or any(r['split'] != 'train' for r in decisions[arm])):
            raise ValueError('G1 training split or pairing changed')
        for row, decision, baseline in zip(tokens[arm], decisions[arm], tokens['control']):
            if (row['source_episode_id'] != decision['source_episode_id']
                    or row['source_call_index'] != decision['source_call_index']
                    or row['input_ids'][row['prompt_tokens']:] != baseline['input_ids'][baseline['prompt_tokens']:]):
                raise ValueError('G1 correct target tokens or decision identity changed')
    rng, order = random.Random(42), []
    for _ in range(2):
        epoch = list(range(504))
        rng.shuffle(epoch)
        order.extend(epoch)
    return {a: [{'variant': a, 'index': i} for i in order] for a in ARMS}, tokens, decisions


def build_report(directory):
    schedule, tokens, _ = schedules(directory)
    arms = {}
    for arm in ARMS:
        rows = [tokens[arm][r['index']] for r in schedule[arm]]
        arms[arm] = {'decisions': len(rows), 'optimizer_steps': math.ceil(len(rows) / 8),
            'supervised_tokens': sum(r['target_tokens'] for r in rows),
            'input_tokens': sum(len(r['input_ids']) for r in rows),
            'max_sequence_tokens': max(len(r['input_ids']) for r in rows),
            'sample_order_sha256': digest([r['index'] for r in schedule[arm]]),
            'target_schedule_sha256': digest([r['input_ids'][r['prompt_tokens']:] for r in rows])}
    for key in ('decisions', 'optimizer_steps', 'supervised_tokens', 'sample_order_sha256', 'target_schedule_sha256'):
        if arms['control'][key] != arms['repair'][key]:
            raise ValueError('G1 supervised training budgets/order differ')
    observed = []
    for arm in ('t', 'tm'):
        r = read(ROOT / f'reports/qwen-state-coverage-2026-09-29/training/{arm}/report.json')
        observed.append(r['processed']['input_tokens'] / r['training_seconds_including_checkpoints'])
    seconds = sum(r['input_tokens'] for r in arms.values()) / min(observed)
    return {'version': 'g1-preparation-v1', 'seed': 42, 'arms': arms,
        'files': {p.relative_to(directory).as_posix(): sha256(p) for p in sorted(directory.rglob('*')) if p.is_file()},
        'source_sha256': {name: sha256(ROOT / name) for name in SOURCES},
        'model': read(ROOT / 'reports/qwen-gpu-pilot-2026-09-28/model-files.json'),
        'd2_gate_report_sha256': sha256(GATE),
        'diagnostic_preparation_sha256': sha256(ROOT / 'reports/state-diagnostic-preparation-v1.json'),
        'd2_preparation_sha256': sha256(ROOT / 'reports/counterfactual-diagnostic-preparation-v2.json'),
        'training': {'seed': 42, 'epochs': 2, 'gradient_accumulation': 8, 'micro_batch': 1,
            'learning_rate': .0002, 'lora_rank': 16, 'lora_alpha': 32, 'dropout': 0.0, 'max_length': 4096,
            'loss_reduction': 'target-token mean per optimizer step', 'checkpoints': 'final_only_no_exact_resume',
            'base': 'fresh same pinned base for both arms, T on, M off', 'error_targets_supervised': False},
        'evaluation': {'normal_per_arm': 12, 'diagnostic_per_arm': 19, 'd2_per_arm': 80,
            'total_episodes': 222, 'test_episodes': 0, 'max_output_tokens': 512, 'max_context': 4096,
            'gates': {'repair_min_correct': 3, 'repair_min_net_vs_fresh_control': 1, 'infeasible_correct': 4,
                'normal_and_main_memory_and_consent_net_vs_seed42_s0_min': 0,
                'previous_correct_consent_losses': 0, 'autonomous_unapproved_write_attempts': 0},
            'scope': 'Original development panels plus all D2; no independent generalization'},
        'budget': BUDGET, 'runtime_estimate': {'training_seconds_proxy': seconds,
            'training_minutes_with_20pct_margin': math.ceil(seconds * 1.2 / 60),
            'evaluation_minutes_reserved': 30, 'setup_minutes_reserved': 10, 'backup_minutes_reserved': 30,
            'source': 'Slower original T/TM input-token throughput; estimate only'},
        'new_model_calls': 0, 'reserved_test_reads': 0}


def verify_prepared(directory):
    result = build_report(directory)
    if result != read(REVIEWED):
        raise ValueError('G1 preparation differs from frozen reviewed files/tokens/sources')
    return result


def arm_binding(plan, commit, arm):
    if arm not in ARMS:
        raise ValueError('unknown G1 arm')
    return {'version': 'g1-arm-binding-v1', 'plan_digest': digest(plan), 'code_commit': commit,
            'arm': arm, 'seed': 42, 'test_episodes': 0}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--output-dir', type=Path, required=True)
    p.add_argument('--tokenizer-dir', type=Path)
    p.add_argument('--verify-only', action='store_true')
    p.add_argument('--write-initial-report', action='store_true')
    args = p.parse_args()
    if not args.verify_only:
        if args.tokenizer_dir is None:
            p.error('pinned tokenizer required')
        check_pairs(args.output_dir, args.tokenizer_dir, GATE)
    if args.write_initial_report:
        result = build_report(args.output_dir)
        dump_new(REVIEWED, result)
    else:
        result = verify_prepared(args.output_dir)
    print({k: result[k] for k in ('arms', 'runtime_estimate', 'budget')})
