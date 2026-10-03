"""Plot a completed G2 pilot with original panel units and both paired directions."""
import argparse
import json
from pathlib import Path

from plot_d2_results import save


def plot(source, output):
    report = json.loads(source.read_text(encoding='utf-8'))
    if (report['version'] != 'g2-results-review-v1' or not report['model_result']
            or report['episodes_replayed'] != 222 or report['unrun_cases'] != 0):
        raise ValueError('complete independently replayed G2 model evidence required')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                         'axes.spines.top': False, 'axes.spines.right': False, 'svg.hashsalt': 'liftcut-g2-seed42'})
    output.mkdir(parents=True, exist_ok=True)
    colors = {'repair_only': '#336D99', 'coverage_mix': '#D18A32'}
    arm_labels = {'repair_only': 'Repair only', 'coverage_mix': 'Coverage mix'}
    labels = {'normal': 'Full tasks', 'main_memory': 'Old memory', 'old_consent': 'Old consent',
              'd2_memory': 'D2 memory', 'd2_identity': 'ID rename', 'd2_consent': 'D2 consent',
              'd2_repair': 'Repair', 'd2_infeasible': 'Infeasible'}
    pairs = report['gates']['paired']
    panels = list(labels)
    fig, axes = plt.subplots(1, 2, figsize=(13, 6), gridspec_kw={'width_ratios': [1.5, 1]})
    values = [[pairs[p][key] / pairs[p]['total'] for p in panels] for key in ('before_correct', 'after_correct')]
    axes[0].imshow(values, vmin=0, vmax=1, cmap='Blues', aspect='auto')
    for i, key in enumerate(('before_correct', 'after_correct')):
        for j, p in enumerate(panels):
            row = pairs[p]
            axes[0].text(j, i, f"{row[key]}/{row['total']}", ha='center', va='center',
                         color='white' if values[i][j] > .6 else '#172B3A')
    axes[0].set_xticks(range(len(panels)), [labels[p] for p in panels], rotation=35, ha='right')
    axes[0].set_yticks([0, 1], ['Repair only', 'Coverage mix'])
    axes[0].set_title('Correct / total; units differ across panels', loc='left', fontsize=11, pad=15)
    y = np.arange(len(panels))
    gain, loss = [len(pairs[p]['gained']) for p in panels], [len(pairs[p]['lost']) for p in panels]
    axes[1].barh(y, gain, color='#488C79', label='Gained')
    axes[1].barh(y, [-x for x in loss], color='#B15B3A', label='Lost')
    limit = max(1, *gain, *loss) + 2
    axes[1].set_xlim(-limit, limit)
    axes[1].axvline(0, lw=.8, color='#64748B')
    axes[1].set_yticks(y, [labels[p] for p in panels])
    axes[1].invert_yaxis()
    for i, (g, l) in enumerate(zip(gain, loss)):
        axes[1].text(g + .15, i, str(g), va='center')
        if l:
            axes[1].text(-l - .15, i, '-' + str(l), ha='right', va='center')
    axes[1].set_title('Paired repair-only → coverage-mix case changes', loc='left', fontsize=11, pad=15)
    axes[1].legend(frameon=False, ncol=2, loc='lower center', bbox_to_anchor=(.5, -.2))
    verdict = 'PASS' if report['gates']['pilot_passed'] else 'FAIL'
    mechanism = 'PASS' if report['gates']['mechanism_passed'] else 'FAIL'
    fig.suptitle(f'G2 seed42 | mechanism: {mechanism} | candidate: {verdict}', x=.06, ha='left', fontsize=16)
    fig.text(.06, .03, '222 evaluations on 111 reused development cases; one training seed. No independent generalization claim.', fontsize=9, color='#4B5563')
    fig.subplots_adjust(left=.115, right=.98, top=.84, bottom=.27, wspace=.44)
    save(fig, output, 'g2-panels-and-paired-changes')
    plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(12, 5.5))
    for arm in ('repair_only', 'coverage_mix'):
        training = report['arms'][arm]['training']
        curve = training['step_curve']
        axes[0].plot([r['step'] for r in curve], [r['loss'] for r in curve], color=colors[arm], label=arm_labels[arm], alpha=.85)
        positions = ('first', 'middle', 'last')
        counts = [report['arms'][arm]['memory_by_factor']['position'][p]['correct'] for p in positions]
        x = np.arange(3) + (-.18 if arm == 'repair_only' else .18)
        axes[1].bar(x, counts, .34, color=colors[arm], label=arm_labels[arm])
        for px, count in zip(x, counts):
            axes[1].text(px, count + .25, str(count), ha='center')
    axes[0].set_xlabel('Optimizer step')
    axes[0].set_ylabel('Target-token-weighted training loss')
    axes[0].set_title('Matched targets; different conditioning contexts', fontsize=11, loc='left')
    axes[0].legend(frameon=False)
    axes[1].set_xticks(range(3), positions)
    axes[1].set_ylim(0, 18)
    axes[1].set_yticks([0, 4, 8, 12, 16])
    axes[1].set_xlabel('Latest valid memory position')
    axes[1].set_ylabel('Correct first responses / 16')
    axes[1].set_title('Memory protection after coverage mixing', fontsize=11, loc='left')
    axes[1].legend(frameon=False)
    fig.suptitle('Training behavior and memory regression check', x=.07, ha='left', fontsize=16)
    fig.text(.07, .035, 'Both arms: 126 steps and 41,788 target tokens. Mixed input tokens are about 1.41% lower; loss is not repair success.', fontsize=9, color='#4B5563')
    fig.subplots_adjust(left=.08, right=.97, top=.8, bottom=.19, wspace=.3)
    save(fig, output, 'g2-training-and-memory')
    plt.close(fig)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--review', required=True, type=Path)
    p.add_argument('--output-dir', required=True, type=Path)
    a = p.parse_args()
    plot(a.review, a.output_dir)
