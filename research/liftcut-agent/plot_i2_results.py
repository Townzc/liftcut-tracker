"""Figures from verified I2 results only; no synthetic result plots."""
import argparse
import json
from pathlib import Path
from plot_d2_results import save
from plot_g4_results import LABELS


def plot(source,output):
    r=json.loads(source.read_text(encoding='utf-8'))
    if (r['version']!='i2-results-review-v1' or not r['model_result'] or r['new_training']
            or not r['system_intervention'] or r['episodes_replayed']!=444):
        raise ValueError('complete real I2 system evidence required')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    output.mkdir(parents=True,exist_ok=True)
    arms=('A','B','C','D');colors=('#61768C','#4A89BB','#A67943','#27866F')
    labels=('A: latest-valid view','B: +stable IDs','C: +source resolution','D: both')
    x=np.arange(len(LABELS));width=.19
    fig,ax=plt.subplots(figsize=(15,7))
    for i,(arm,color,label) in enumerate(zip(arms,colors,labels)):
        counts=r['arms'][arm]['gate_counts'];ys=[counts[p]['correct']/counts[p]['total']*100 for p in LABELS]
        positions=x+(i-1.5)*width
        ax.bar(positions,ys,width,color=color,label=label)
        for xx,p,y in zip(positions,LABELS,ys):
            ax.text(xx,y+1,f"{counts[p]['correct']}/{counts[p]['total']}",ha='center',fontsize=7,rotation=90)
    ax.set_xticks(x,list(LABELS.values()),rotation=25,ha='right');ax.set_ylim(0,131)
    ax.set_ylabel('Correct (%)');ax.legend(frameon=False,ncol=2,loc='upper left')
    fig.suptitle('I2 | fixed weights, stable IDs x public source resolution',x=.07,ha='left',fontsize=16)
    fig.text(.07,.025,'444 evaluations /111 repeated development states, including first decisions. D selected before observing outcomes.',fontsize=10)
    fig.subplots_adjust(left=.07,right=.985,top=.9,bottom=.2)
    save(fig,output,'i2-four-arm-panels');plt.close(fig)
    fig,axes=plt.subplots(1,2,figsize=(13,6))
    edges=('N_without_R','N_with_R','R_without_N','R_with_N','candidate_D_vs_A')
    for i,edge in enumerate(edges):
        paired=r['paired_all111'][edge];gain=len(paired['gained']);loss=len(paired['lost'])
        axes[0].barh(i-.16,gain,.3,color='#27866F',label='Gained' if i==0 else None)
        axes[0].barh(i+.16,-loss,.3,color='#B24F59',label='Lost' if i==0 else None)
        axes[0].text(gain+.15,i-.16,str(gain),va='center',fontsize=9)
        axes[0].text(-loss-.15,i+.16,str(loss),va='center',ha='right',fontsize=9)
    axes[0].set_yticks(range(5),('IDs: B vs A','IDs: D vs C','Source: C vs A','Source: D vs B','Candidate: D vs A'))
    axes[0].axvline(0,color='#555',lw=.8);axes[0].set_xlabel('Cases /111');axes[0].legend(frameon=False)
    positions=('first','middle','last')
    for i,(arm,color) in enumerate(zip(arms,colors)):
        ys=[r['arms'][arm]['memory_by_factor']['position'][p]['correct'] for p in positions]
        axes[1].bar(np.arange(3)+(i-1.5)*width,ys,width,color=color,label=arm)
    axes[1].set_xticks(range(3),positions);axes[1].set_ylim(0,18);axes[1].set_yticks([0,4,8,12,16])
    axes[1].set_ylabel('Correct /16');axes[1].set_xlabel('Latest valid memory position in original list');axes[1].legend(frameon=False,ncol=4)
    fig.suptitle('Paired factorial gains, regressions and memory position',x=.055,ha='left',fontsize=16)
    fig.text(.055,.025,'System interventions with unchanged weights; descriptive development evidence, not independent generalization.',fontsize=10)
    fig.subplots_adjust(left=.17,right=.975,top=.86,bottom=.2,wspace=.3)
    save(fig,output,'i2-factorial-and-memory');plt.close(fig)


if __name__=='__main__':
    p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('--review',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True)
    a=p.parse_args();plot(a.review,a.output_dir)
