"""Draw complete D2 development results and paired gains/losses from replay."""
import argparse
import json
from pathlib import Path


def save(fig, output, name):
    for ext in ('png', 'svg'):
        fig.savefig(output / f'{name}.{ext}', dpi=180, facecolor='white')
    svg = output / f'{name}.svg'
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n',
                   encoding='utf-8', newline='\n')


def plot(source, output):
    report = json.loads(source.read_text(encoding='utf-8'))
    if report['episodes_replayed'] != 320 or report['unrun_cases'] != 0 or not report['model_result']:
        raise ValueError('complete independently replayed model evidence required')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                         'axes.spines.top': False, 'axes.spines.right': False, 'svg.hashsalt': 'liftcut-d2-v2'})
    output.mkdir(parents=True, exist_ok=True)
    arms = ('s0', 't', 'm', 'tm')
    panels = ('memory', 'identity', 'consent', 'repair', 'infeasible')
    colors = ('#748D9E', '#336D99', '#D4AB58', '#488C79')
    fig, axes = plt.subplots(1, 2, figsize=(12, 5.2), gridspec_kw={'width_ratios': [1, 1.4]})
    fig.suptitle('D2: fixed seed42, four training conditions', x=.07, ha='left', fontsize=16)
    positions = ('first', 'middle', 'last')
    for i, (arm, color) in enumerate(zip(arms, colors)):
        counts = [report['arms'][arm]['memory_by_factor']['position'][p]['correct'] for p in positions]
        x = np.arange(3) + (i - 1.5) * .19
        axes[0].bar(x, counts, .18, color=color, label=arm.upper())
        for a, b in zip(x, counts):
            axes[0].text(a, b + .2, str(b), ha='center', fontsize=8)
    axes[0].set_xticks(range(3), positions)
    axes[0].set_ylim(0, 18)
    axes[0].set_yticks([0, 4, 8, 12, 16])
    axes[0].set_ylabel('Correct first responses / 16')
    axes[0].set_title('Latest valid memory: position sensitivity', loc='left', fontsize=11, pad=16)
    axes[0].set_xlabel('Position in presented memory list')
    axes[0].legend(ncol=4, loc='upper center', bbox_to_anchor=(.5, -.17), frameon=False, fontsize=9)
    values = [[report['arms'][a]['panels'][p]['correct'] / report['arms'][a]['panels'][p]['total'] for p in panels] for a in arms]
    axes[1].imshow(values, vmin=0, vmax=1, cmap='Blues', aspect='auto')
    for i, arm in enumerate(arms):
        for j, panel in enumerate(panels):
            item = report['arms'][arm]['panels'][panel]
            label = f"{item['correct']}/{item['total']}"
            if item['defer']:
                label += f"\nD={item['defer']}"
            axes[1].text(j, i, label, ha='center', va='center', color='white' if values[i][j] > .6 else '#172B3A')
    axes[1].set_xticks(range(5), ['Memory', 'ID rename', 'Consent', 'Repair', 'Infeasible'])
    axes[1].set_yticks(range(4), [a.upper() for a in arms])
    axes[1].set_title('Correct / total in each panel; D = defer', loc='left', fontsize=11, pad=16)
    axes[1].set_xlabel('First response: first three panels | Full continuation: last two', fontsize=9)
    fig.text(.07, .025, '320 cases, one fixed training seed; reused development states. Panel units differ. No held-out/generalization claim.', fontsize=9, color='#4B5563')
    fig.subplots_adjust(left=.07, right=.96, top=.80, bottom=.23, wspace=.28)
    save(fig, output, 'd2-four-arm-panels')
    plt.close(fig)

    fig, axes = plt.subplots(1, 5, figsize=(13, 5.4))
    pairs = ('s0->t', 's0->m', 'm->tm', 't->tm')
    for ax, panel in zip(axes, panels):
        gain = [len(report['paired'][pair][panel]['gains']) for pair in pairs]
        loss = [len(report['paired'][pair][panel]['losses']) for pair in pairs]
        ax.barh(range(4), gain, color='#336D99', label='Gained cases')
        ax.barh(range(4), [-n for n in loss], color='#B15B3A', label='Lost cases')
        limit = max(1, *gain, *loss) * 1.5 + 2
        ax.set_xlim(-limit, limit)
        ax.axvline(0, color='#64748B', lw=.8)
        ax.set_yticks(range(4), [p.upper().replace('->', ' → ') for p in pairs])
        ax.invert_yaxis()
        ax.set_title(panel.capitalize())
        for i, (g, l) in enumerate(zip(gain, loss)):
            ax.text(g + .25, i, '+' + str(g) if g else '0', va='center', fontsize=9)
            if l:
                ax.text(-l - .25, i, '-' + str(l), va='center', ha='right', fontsize=9)
        ax.set_xlabel('Case count')
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc='lower center', bbox_to_anchor=(.5, .09), ncol=2, frameon=False)
    fig.suptitle('Paired gains and regressions: net scores do not show all changes', x=.05, ha='left', fontsize=15)
    fig.text(.05, .025, 'Each pair uses identical case IDs. Axes are scaled per panel; compare case counts within a panel. Fixed seed42 development diagnosis.', fontsize=9, color='#4B5563')
    fig.subplots_adjust(left=.07, right=.98, top=.82, bottom=.27, wspace=.7)
    save(fig, output, 'd2-paired-gains-losses')
    plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    plot(args.review, args.output_dir)
