"""Render actual I3 ID-codebook results with repeated-input limits visible."""
import argparse
import json
from pathlib import Path


def plot(public):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    r=json.loads((public/'review.json').read_text(encoding='utf-8'));fig,axes=plt.subplots(1,2,figsize=(11,4.8))
    colors={'C':'#7589a7','D':'#157b72'}
    for i,arm in enumerate(('C','D')):
        ax=axes[0];ax.bar(i,r['arms'][arm]['correct'],color=colors[arm],width=.55)
        ax.text(i,r['arms'][arm]['correct']+.45,f"{r['arms'][arm]['correct']}/32",ha='center')
    axes[0].set(xticks=[0,1],xticklabels=['C: source resolution','D: source + stable IDs'],ylim=(0,36),ylabel='Correct first decisions',title='Same fixed adapter, 32 decisions per arm')
    books=list(r['arms']['C']['strata']['codebook'])
    for j,arm in enumerate(('C','D')):
        values=[r['arms'][arm]['strata']['codebook'][b]['correct'] for b in books]
        axes[1].bar([i+(j-.5)*.34 for i in range(len(books))],values,width=.34,label=arm,color=colors[arm])
    axes[1].set(xticks=list(range(len(books))),xticklabels=books,ylim=(0,9),ylabel='Correct / 8 anchors',title='All four preregistered ID codebooks')
    axes[1].legend(frameon=False,loc='upper center',ncol=2)
    for ax in axes:
        ax.spines[['top','right']].set_visible(False);ax.grid(axis='y',alpha=.2);ax.set_axisbelow(True)
    passed=r['paired']['diagnostic_passed'];fig.suptitle('I3 development ID diagnostic — preselected D '+('PASS' if passed else 'FAIL'),fontsize=14)
    fig.text(.5,.02,'8 reused business anchors; D: 8 unique inputs × 4 repeats. No held-out tasks or independent generalization.',ha='center',fontsize=9)
    fig.tight_layout(rect=(0,.065,1,.94));folder=public/'figures';folder.mkdir(exist_ok=True)
    for ext in ('png','svg'):fig.savefig(folder/('i3-id-results.'+ext),dpi=170)
    svg=folder/'i3-id-results.svg'
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines())+'\n',encoding='utf-8',newline='\n')
    plt.close(fig)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--public-dir',type=Path,required=True);plot(p.parse_args().public_dir)
