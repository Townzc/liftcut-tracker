"""Plot two completed G3 arms and explicitly historical G2, preserving denominators."""
import argparse
import json
from pathlib import Path

from plot_d2_results import save

ARMS = ('stop_half', 'stop_all')
LABELS = {'normal': 'Full tasks', 'main_memory': 'Old memory', 'old_consent': 'Old consent',
          'd2_memory': 'D2 memory', 'd2_identity': 'ID rename', 'd2_consent': 'D2 consent',
          'd2_repair': 'Repair', 'd2_infeasible': 'Infeasible'}


def plot(source, output):
    report = json.loads(source.read_text(encoding='utf-8'))
    if (report['version'] != 'g3-results-review-v1' or not report['model_result']
            or report['episodes_replayed'] != 222 or report['unrun_cases'] != 0):
        raise ValueError('complete independently replayed G3 model evidence required')
    if report['control']['retrained_in_this_window'] is not False:
        raise ValueError('G3 reused historical control must remain explicit')
    pairs = {a: report['gates'][a]['paired_vs_control'] for a in ARMS}
    if any((pairs['stop_half'][p]['before_correct'], pairs['stop_half'][p]['total'])
           != (pairs['stop_all'][p]['before_correct'], pairs['stop_all'][p]['total']) for p in LABELS):
        raise ValueError('both arms must compare the same historical cases')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                         'axes.spines.top': False, 'axes.spines.right': False, 'svg.hashsalt': 'liftcut-g3-seed42'})
    output.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(1, 3, figsize=(16, 6), gridspec_kw={'width_ratios': [1.65, 1, 1]})
    counts = [[pairs['stop_half'][p]['before_correct'] for p in LABELS]]
    counts += [[pairs[a][p]['after_correct'] for p in LABELS] for a in ARMS]
    totals = [pairs['stop_half'][p]['total'] for p in LABELS]
    values = [[n / d for n, d in zip(row, totals)] for row in counts]
    axes[0].imshow(values, vmin=0, vmax=1, cmap='Blues', aspect='auto')
    for i, row in enumerate(counts):
        for j, value in enumerate(row):
            axes[0].text(j, i, f'{value}/{totals[j]}', ha='center', va='center',
                         color='white' if values[i][j] > .6 else '#172B3A')
    axes[0].set_xticks(range(len(LABELS)), list(LABELS.values()), rotation=40, ha='right')
    axes[0].set_yticks([0, 1, 2], ['G2 historical', 'Stop half', 'Stop all'])
    axes[0].set_title('Correct / total; units differ across panels', loc='left', fontsize=11, pad=16)
    for ax, arm in zip(axes[1:], ARMS):
        y = np.arange(len(LABELS))
        gain, loss = [[len(pairs[arm][p][k]) for p in LABELS] for k in ('gained', 'lost')]
        limit = max(1, *gain, *loss) + 2
        ax.barh(y, gain, color='#488C79', label='Gained')
        ax.barh(y, [-x for x in loss], color='#B15B3A', label='Lost')
        ax.axvline(0, lw=.8, color='#64748B')
        ax.set_xlim(-limit, limit)
        ax.set_yticks(y, list(LABELS.values()))
        ax.invert_yaxis()
        for i, (g, l) in enumerate(zip(gain, loss)):
            ax.text(g + .15, i, str(g), va='center')
            if l:
                ax.text(-l - .15, i, '-' + str(l), ha='right', va='center')
        gate = report['gates'][arm]
        status = '/'.join('PASS' if gate[k] else 'FAIL' for k in ('mechanism_passed', 'candidate_passed'))
        ax.set_title(f'{arm}: mechanism/candidate\n{status}', fontsize=11, loc='left')
        ax.legend(frameon=False, ncol=2, loc='lower center', bbox_to_anchor=(.5, -.24))
    fig.suptitle('G3 seed42 | stopping-context screen vs historical G2', x=.04, ha='left', fontsize=16)
    fig.text(.04, .035, '222 new evaluations on111 reused cases. G2 control was not retrained; shared12-step checks are prefix checks only.', fontsize=9)
    fig.subplots_adjust(left=.09, right=.98, top=.8, bottom=.28, wspace=.55)
    save(fig, output, 'g3-panels-and-case-changes')
    plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(12, 5.5))
    for arm, offset, color in zip(ARMS, (-.18, .18), ('#336D99', '#D18A32')):
        curve = report['arms'][arm]['training']['step_curve']
        axes[0].plot([r['step'] for r in curve], [r['loss'] for r in curve], color=color, label=arm, alpha=.85)
        positions = ('first', 'middle', 'last')
        counts = [report['arms'][arm]['memory_by_factor']['position'][p]['correct'] for p in positions]
        x = np.arange(3) + offset
        axes[1].bar(x, counts, .34, color=color, label=arm)
        for px, count in zip(x, counts):
            axes[1].text(px, count + .25, str(count), ha='center')
    axes[0].axvline(12, color='#64748B', linestyle=':', label='Shared prefix ends')
    axes[0].set_xlabel('Optimizer step')
    axes[0].set_ylabel('Target-token-weighted loss')
    axes[0].set_title('126 steps, 41,788 supervised tokens per arm', loc='left', fontsize=11)
    axes[0].legend(frameon=False)
    axes[1].set_xticks(range(3), positions)
    axes[1].set_ylim(0, 18)
    axes[1].set_yticks([0, 4, 8, 12, 16])
    axes[1].set_xlabel('Latest valid memory position')
    axes[1].set_ylabel('Correct first responses /16')
    axes[1].set_title('Memory protection check', loc='left', fontsize=11)
    axes[1].legend(frameon=False)
    fig.suptitle('G3 training and remaining memory shortfalls', x=.07, ha='left', fontsize=16)
    fig.text(.07, .035, 'No independent generalization claim. Training loss alone does not establish correct stopping behavior.', fontsize=9)
    fig.subplots_adjust(left=.08, right=.97, top=.8, bottom=.19, wspace=.3)
    save(fig, output, 'g3-training-and-memory')
    plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--review', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    plot(args.review, args.output_dir)
