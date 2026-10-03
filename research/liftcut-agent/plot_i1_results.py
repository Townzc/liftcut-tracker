"""Scientific I1 figures: fresh raw/view system outcomes and actual resource totals."""
import argparse
import json
from pathlib import Path
from plot_d2_results import save
from plot_g4_results import LABELS


def plot(source,output):
    r=json.loads(source.read_text(encoding='utf-8'))
    if (r['version']!='i1-results-review-v1' or not r['model_result'] or r['new_training']
            or not r['system_intervention'] or r['episodes_replayed']!=222):
        raise ValueError('complete real fixed-weight system comparison required')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    output.mkdir(parents=True,exist_ok=True)
    arms=('raw','view');colors=('#336D99','#27866F');x=np.arange(len(LABELS))
    fig,axes=plt.subplots(1,2,figsize=(14,6),gridspec_kw={'width_ratios':[2.3,1]})
    for arm,offset,color in zip(arms,(-.18,.18),colors):
        counts=r['arms'][arm]['gate_counts'];values=[counts[p]['correct']/counts[p]['total']*100 for p in LABELS]
        axes[0].bar(x+offset,values,.34,color=color,label=arm)
        for xx,p,v in zip(x+offset,LABELS,values):axes[0].text(xx,v+1,f"{counts[p]['correct']}/{counts[p]['total']}",ha='center',fontsize=8,rotation=90)
    axes[0].set_xticks(x,list(LABELS.values()),rotation=30,ha='right');axes[0].set_ylim(0,128)
    axes[0].set_ylabel('Correct (%)');axes[0].legend(frameon=False)
    paired=r['paired_all111'];counts=[len(paired['gained']),len(paired['lost'])]
    axes[1].bar(['Gained','Lost'],counts,color=['#27866F','#BB4855'])
    for i,n in enumerate(counts):axes[1].text(i,n+.2,str(n),ha='center')
    axes[1].set_ylim(0,max(4,max(counts)+3));axes[1].set_ylabel('Cases /111')
    axes[1].set_title(f"All cases: {paired['before_correct']} -> {paired['after_correct']}",loc='left')
    fig.suptitle('I1 seed42 | fixed weights, raw vs latest-valid memory view',x=.055,ha='left',fontsize=16)
    fig.text(.055,.025,'System intervention;222 evaluations on111 reused dev states. No new training or independent generalization.',fontsize=10)
    fig.subplots_adjust(left=.065,right=.97,top=.85,bottom=.23,wspace=.35)
    save(fig,output,'i1-panels-and-paired-cases');plt.close(fig)
    fig,axes=plt.subplots(1,2,figsize=(12,5.5))
    for arm,offset,color in zip(arms,(-.18,.18),colors):
        positions=('first','middle','last');values=[r['arms'][arm]['memory_by_factor']['position'][p]['correct'] for p in positions]
        axes[0].bar(np.arange(3)+offset,values,.34,label=arm,color=color)
        for i,v in enumerate(values):axes[0].text(i+offset,v+.2,str(v),ha='center')
    axes[0].set_xticks(range(3),positions);axes[0].set_ylim(0,18);axes[0].set_yticks([0,4,8,12,16]);axes[0].legend(frameon=False)
    axes[0].set_xlabel('Latest valid record position in the ORIGINAL list');axes[0].set_ylabel('Correct /16')
    values=[r['input_costs']['actual_generated_prompt_tokens'][a]/1000 for a in arms]
    axes[1].bar(arms,values,color=colors)
    for i,v in enumerate(values):axes[1].text(i,v+2,f'{v:.1f}k',ha='center')
    axes[1].set_ylim(0,max(values)*1.2);axes[1].set_ylabel('Actual prompt tokens (thousands)')
    fig.suptitle('I1 memory position and fresh-arm input totals',x=.065,ha='left',fontsize=16)
    fig.text(.065,.025,'Rule-based input projection uses public tool data. Fewer tokens alone do not establish lower end-to-end latency.',fontsize=9)
    fig.subplots_adjust(left=.075,right=.98,top=.83,bottom=.2,wspace=.35)
    save(fig,output,'i1-memory-and-input-tokens');plt.close(fig)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--review',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True)
    a=p.parse_args();plot(a.review,a.output_dir)
