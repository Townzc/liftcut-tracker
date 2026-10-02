"""Plot the already replayed partial S0 report; no new model/evaluation call."""
import argparse
import json
from pathlib import Path


def plot(source, output):
    report=json.loads(source.read_text(encoding='utf-8'))
    if (report['run_status']!='partial' or report['episodes_replayed']!=80 or report['unrun_cases']!=240
            or report['g1']['evaluated'] or report['paired_treatment_effects'] is not None):
        raise ValueError('only the audited partial S0 scope can be plotted')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
    output.mkdir(parents=True,exist_ok=True)
    fig,axes=plt.subplots(1,2,figsize=(11,4.8),gridspec_kw={'width_ratios':[1,1.25]})
    fig.suptitle('S0 partial D2 diagnosis: memory position and incomplete recovery',fontsize=14,x=.07,ha='left')
    positions=('first','middle','last')
    counts=[report['memory_by_factor']['position'][p]['correct'] for p in positions]
    totals=[report['memory_by_factor']['position'][p]['total'] for p in positions]
    if totals!=[16,16,16]:
        raise ValueError('position denominators differ')
    ax=axes[0]
    ax.bar(positions,counts,color=['#336D99','#B15B3A','#748D9E'],width=.6)
    for x,y,n in zip(positions,counts,totals):
        ax.text(x,y+.4,f'{y}/{n}',ha='center',fontsize=11)
    ax.set_ylim(0,18)
    ax.set_yticks([0,4,8,12,16])
    ax.set_ylabel('Correct first responses')
    ax.set_xlabel('Position of the latest valid memory')
    ax.set_title('Same value-role design, different positions',loc='left',fontsize=10,pad=15)
    ax.grid(axis='y',alpha=.2)
    ax.set_axisbelow(True)
    ax=axes[1]
    panels=['memory','identity','consent','repair','infeasible']
    totals=[report['panels'][p]['total'] for p in panels]
    correct=[report['panels'][p]['correct']/n*100 for p,n in zip(panels,totals)]
    deferred=[report['panels'][p]['defer']/n*100 for p,n in zip(panels,totals)]
    failed=[100-a-b for a,b in zip(correct,deferred)]
    y=list(range(5))
    ax.barh(y,correct,color='#336D99',label='Correct')
    ax.barh(y,deferred,left=correct,color='#D4AB58',label='Defer')
    ax.barh(y,failed,left=[a+b for a,b in zip(correct,deferred)],color='#D7DFE4',label='Other incorrect')
    for i,p,n in zip(y,panels,totals):
        ax.text(102,i,f"{report['panels'][p]['correct']}/{n}",va='center')
    ax.set_yticks(y,['Memory (first response)','ID rename (first response)','Consent (first response)','Repair (continuation)','Infeasible (continuation)'])
    ax.invert_yaxis()
    ax.set_xlim(0,116)
    ax.set_xticks([0,25,50,75,100],['0%','25%','50%','75%','100%'])
    ax.set_title('Panels use different units; do not pool accuracy',loc='left',fontsize=10,pad=15)
    ax.legend(loc='upper center',bbox_to_anchor=(.5,-.16),ncol=3,frameon=False,fontsize=8)
    fig.text(.07,.025,'Only S0 ran: 80/320 cases, 84 real generations. T/M/TM absent; G1 not evaluated. Reused development states.',fontsize=9,color='#4B5563')
    fig.subplots_adjust(left=.07,right=.94,bottom=.23,top=.79,wspace=.68)
    for ext in ('png','svg'):
        fig.savefig(output/f'd2-partial-s0.{ext}',dpi=180,facecolor='white')
    svg=output/'d2-partial-s0.svg'
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines())+'\n',
                   encoding='utf-8',newline='\n')
    plt.close(fig)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args()
    plot(args.review,args.output_dir)
