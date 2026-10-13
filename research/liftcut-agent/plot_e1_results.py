"""Render E1 complete-task and actually observed resource results."""
import argparse
from pathlib import Path
from d2_execution import read, aware
from liftcut_agent.benchmark import read_jsonl


def plot(public):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    r = read(public / 'review.json'); folder = public / 'figures'; folder.mkdir(exist_ok=True)
    colors = {'A': '#7d8ba5', 'D': '#147e78'}
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.8), gridspec_kw={'width_ratios': [1, 2.7]})
    for i, a in enumerate(('A', 'D')):
        n = r['arms'][a]['passed']; axes[0].bar(i, n, color=colors[a], width=.6)
        axes[0].text(i, n+.7, f'{n}/48', ha='center')
    axes[0].axhline(44, color='#b36139', linestyle='--', linewidth=1, label='D gate: 44')
    axes[0].set(xticks=[0, 1], xticklabels=['A: memory\nview', 'D: memory\n+ source + IDs'], ylim=(0, 54), ylabel='Passed full tasks', title='Fresh fixed-weight comparison')
    axes[0].legend(frameon=False, fontsize=9)
    cats = list(r['arms']['A']['strata']['category'])
    for j, a in enumerate(('A', 'D')):
        axes[1].bar([i+(j-.5)*.36 for i in range(len(cats))], [r['arms'][a]['strata']['category'][c]['passed'] for c in cats], width=.36, color=colors[a], label=a)
    axes[1].axhline(3, color='#b36139', linestyle='--', linewidth=1)
    axes[1].set(xticks=range(len(cats)), xticklabels=cats, ylim=(0, 4.7), ylabel='Passed / 4', title='All preregistered categories; D gate >= 3 in each')
    axes[1].tick_params(axis='x', rotation=55); axes[1].legend(frameon=False)
    for ax in axes:
        ax.spines[['top', 'right']].set_visible(False); ax.set_axisbelow(True); ax.grid(axis='y', alpha=.2)
    fig.suptitle('E1 complete-task transfer — fixed D ' + ('PASS' if r['decision']['candidate_passed'] else 'FAIL'), fontsize=15)
    fig.text(.5, .025, 'Both arms filter latest valid memories. 48 shared-template tasks; prior structural access, no independent generalization claim.', ha='center', fontsize=9)
    fig.tight_layout(rect=(0, .07, 1, .94)); save(fig, folder / 'e1-full-task-results')
    rows = [s for s in read_jsonl(public / 'resources/server-stream.jsonl') if s['kind'] == 'actual_nvidia_smi_observation']
    boot = aware(r['binding']['booted_at_proxy']); x = [(aware(s['at_utc'])-boot).total_seconds()/60 for s in rows]
    fig, axes = plt.subplots(2, 1, figsize=(11.5, 6), sharex=True)
    for ax, key, label, color in zip(axes, ('utilization.gpu', 'memory.used'), ('GPU utilization (%)', 'VRAM used (MiB)'), ('#147e78', '#667ca6')):
        y = [s['gpus'][0][key] if s['status'] == 'observed' and len(s['gpus']) == 1 else None for s in rows]
        ax.scatter(x, y, s=6, color=color); ax.set_ylabel(label); ax.spines[['top', 'right']].set_visible(False); ax.grid(alpha=.2)
    axes[0].set_ylim(0, 105); axes[1].set_xlabel('Minutes since original opening proxy')
    fig.suptitle('E1 RTX 4090 — actual 5-second samples (missing intervals stay unknown)', fontsize=13)
    fig.text(.5, .02, 'Whole-card snapshots; sampled maxima are not true peaks. Early A samples are missing. No TTFT or faster-card benchmark.', ha='center', fontsize=9)
    fig.tight_layout(rect=(0, .045, 1, .94)); save(fig, folder / 'e1-observed-resources')


def save(fig, path):
    import matplotlib.pyplot as plt
    for ext in ('png', 'svg'):
        fig.savefig(path.with_suffix('.' + ext), dpi=170)
    svg = path.with_suffix('.svg')
    svg.write_text('\n'.join(s.rstrip() for s in svg.read_text(encoding='utf-8').splitlines())+'\n', encoding='utf-8', newline='\n')
    plt.close(fig)


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--public-dir', type=Path, required=True)
    plot(p.parse_args().public_dir)
