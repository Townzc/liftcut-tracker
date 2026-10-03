"""Scientific G4 figures from verified paired results; every denominator stays visible."""
import argparse
import json
from pathlib import Path
from plot_d2_results import save

ARMS=('control','permuted')
LABELS={'normal':'Full tasks','main_memory':'Old memory','old_consent':'Old consent',
        'd2_memory':'D2 memory','d2_identity':'ID rename','d2_consent':'D2 consent',
        'd2_repair':'Repair','d2_infeasible':'Infeasible'}


def plot(source,output):
    r=json.loads(source.read_text(encoding='utf-8'))
    if (r['version']!='g4-results-review-v1' or not r['model_result'] or r['episodes_replayed']!=222
            or not r['gates']['fresh_control_used']):raise ValueError('complete fresh paired G4 evidence required')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    output.mkdir(parents=True,exist_ok=True)
    colors=('#336D99','#D18A32');x=np.arange(len(LABELS))
    fig,axes=plt.subplots(1,2,figsize=(14,6),gridspec_kw={'width_ratios':[2.3,1]})
    for arm,offset,color in zip(ARMS,(-.18,.18),colors):
        counts=r['arms'][arm]['gate_counts']
        values=[counts[p]['correct']/counts[p]['total']*100 for p in LABELS]
        axes[0].bar(x+offset,values,.34,color=color,label=arm)
        for xx,p,v in zip(x+offset,LABELS,values):
            axes[0].text(xx,v+1,f"{counts[p]['correct']}/{counts[p]['total']}",ha='center',fontsize=8,rotation=90)
    axes[0].set_xticks(x,list(LABELS.values()),rotation=30,ha='right');axes[0].set_ylim(0,128)
    axes[0].set_ylabel('Correct (%)');axes[0].legend(frameon=False)
    pairs=r['paired_all111'];values=[len(pairs['gained']),len(pairs['lost'])]
    axes[1].bar(['Gained','Lost'],values,color=['#27866F','#BB4855'])
    for i,v in enumerate(values):axes[1].text(i,v+.2,str(v),ha='center')
    axes[1].set_ylim(0,max(4,max(values)+3));axes[1].set_ylabel('Cases /111')
    axes[1].set_title(f"All cases: {pairs['before_correct']} -> {pairs['after_correct']}",loc='left')
    fig.suptitle('G4 seed42 | new control vs memory-order coverage',x=.055,ha='left',fontsize=17)
    fig.text(.055,.025,'222 evaluations on111 reused development cases. No reserved-task evaluation or independent generalization claim.',fontsize=10)
    fig.subplots_adjust(left=.065,right=.97,top=.85,bottom=.23,wspace=.35)
    save(fig,output,'g4-panels-and-paired-cases');plt.close(fig)
    fig,axes=plt.subplots(1,2,figsize=(12,5.5))
    for arm,offset,color in zip(ARMS,(-.18,.18),colors):
        curve=r['arms'][arm]['training']['step_curve']
        axes[0].plot([v['step'] for v in curve],[v['loss'] for v in curve],label=arm,color=color,alpha=.85)
        positions=('first','middle','last');counts=r['arms'][arm]['memory_by_factor']['position']
        values=[counts[p]['correct'] for p in positions]
        axes[1].bar(np.arange(3)+offset,values,.34,label=arm,color=color)
        for i,v in enumerate(values):axes[1].text(i+offset,v+.25,str(v),ha='center')
    axes[0].set_xlabel('Optimizer step');axes[0].set_ylabel('Target-token-weighted loss');axes[0].legend(frameon=False)
    axes[0].set_title('126 updates, 41,788 supervised tokens each',loc='left',fontsize=11)
    axes[1].set_xticks(range(3),positions);axes[1].set_ylim(0,18);axes[1].set_yticks([0,4,8,12,16])
    axes[1].axhline(8,color='#64748B',linestyle=':',label='Pre-registered per-position floor')
    axes[1].set_xlabel('Latest valid record position');axes[1].set_ylabel('Correct /16');axes[1].legend(frameon=False,fontsize=9)
    fig.suptitle('G4 training and memory position checks',x=.065,ha='left',fontsize=17)
    fig.text(.065,.025,'Loss is not task success. Gates also protect identity, stopping, repair, authorization and fixed S0 performance.',fontsize=9)
    fig.subplots_adjust(left=.075,right=.98,top=.81,bottom=.2,wspace=.3)
    save(fig,output,'g4-training-and-memory');plt.close(fig)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--review',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True)
    a=p.parse_args();plot(a.review,a.output_dir)
