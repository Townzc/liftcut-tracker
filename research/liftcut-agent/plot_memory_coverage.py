"""Figure for the memory-arrangement audit; reads only the saved JSON evidence."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ORDERS = ('VOU', 'VOX', 'OVU', 'OVX', 'OUV', 'OXV')
ROWS = (('d2_s0', 'S0 (D2 run)'), ('d2_t', 'T (D2 run)'), ('repair_only', 'G2 repair_only'), ('coverage_mix', 'G2 coverage_mix'))
RAMP = ('#f0efec', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#104281', '#0d366b')


def main(audit, output):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    data = json.loads(audit.read_text(encoding='utf-8'))
    trained = data['training']['coverage_mix']['equipment_selection_targets']
    fig, (top, grid) = plt.subplots(2, 1, figsize=(8.6, 4.6), gridspec_kw={'height_ratios': [1, 4.2], 'hspace': .08})
    top.bar(range(6), [trained.get(o, 0) for o in ORDERS], width=.55, color='#3987e5')
    for i, o in enumerate(ORDERS):
        top.text(i, trained.get(o, 0) + 1, str(trained.get(o, 0)), ha='center', va='bottom', fontsize=8, color='#52514e')
    top.set_ylim(0, 24)
    top.set_xlim(-.5, 5.5)
    top.axis('off')
    top.set_title('Training selection targets per arrangement (top, same in S0/T/G2) vs D2 memory correct of 8', fontsize=10, loc='left', color='#0b0b0b')
    values = [[data['d2_by_arrangement'][key].get('memory|' + o, {}).get('correct', 0) for o in ORDERS] for key, _ in ROWS]
    grid.imshow(values, cmap=ListedColormap(RAMP), vmin=0, vmax=8, aspect='auto')
    for r, row in enumerate(values):
        for c, value in enumerate(row):
            grid.text(c, r, f'{value}/8', ha='center', va='center', fontsize=9,
                      color='#ffffff' if value >= 5 else '#0b0b0b')
    grid.set_xticks(range(6), [o + ('\n(seen)' if trained.get(o) else '\n(unseen)') for o in ORDERS], fontsize=8.5)
    grid.set_yticks(range(len(ROWS)), [label for _, label in ROWS], fontsize=9)
    grid.tick_params(length=0)
    for spine in grid.spines.values():
        spine.set_visible(False)
    grid.tick_params(which='minor', length=0)
    grid.set_xticks([x + .5 for x in range(5)], minor=True)
    grid.set_yticks([y + .5 for y in range(len(ROWS) - 1)], minor=True)
    grid.grid(which='minor', color='#fcfcfb', linewidth=2)
    fig.text(.01, .01, 'Record order returned by get_memories. V latest valid, O older valid, U unconfirmed, X expired. '
             'Training has VUO/XOV too (not in D2).', fontsize=7.5, color='#52514e')
    fig.patch.set_facecolor('#fcfcfb')
    output.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ('.png', '.svg'):
        fig.savefig(output.with_suffix(suffix), dpi=160, bbox_inches='tight', facecolor='#fcfcfb',
                    **({'metadata': {'Date': None}} if suffix == '.svg' else {}))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--audit', type=Path, default=ROOT / 'reports/memory-coverage-2026-10-03/audit.json')
    p.add_argument('--output', type=Path, default=ROOT / 'reports/memory-coverage-2026-10-03/memory-arrangement-coverage')
    a = p.parse_args()
    main(a.audit, a.output)
