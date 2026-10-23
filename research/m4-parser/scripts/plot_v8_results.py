"""Render actual public aggregate counts; this never evaluates or trains a model."""
import argparse,json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
matplotlib.rcParams['svg.hashsalt']='liftcut-m4-v8'
import matplotlib.pyplot as plt
import numpy as np

def render(summary, output):
 arms=['A','B','C','D']; colors=['#d8d8d8','#adadad','#747474','#191919']
 exact=[summary['raw'][a]['challenge']['exact'] for a in arms]
 assert all(summary['raw'][a]['challenge']['total']==240 for a in arms)
 fig,(top,bottom)=plt.subplots(2,1,figsize=(10.2,7.4),gridspec_kw={'height_ratios':[1,1.1]})
 fig.subplots_adjust(top=.88,bottom=.14,left=.09,right=.97,hspace=.55)
 fig.suptitle('M4 v8: separate training and inference instructions',x=.09,ha='left',fontsize=17,fontweight='bold')
 top.set_title('Challenge exact match · 240 observed development cases · HF models',loc='left',fontsize=11,pad=13)
 top.bar(arms,[n/240*100 for n in exact],color=colors,width=.52,zorder=3)
 for i,n in enumerate(exact):top.text(i,n/240*100+2,f'{n}/240',ha='center',fontsize=11)
 top.axhline(90,color='#111',linestyle='--',linewidth=1)
 top.text(.015,94,'90% gate',transform=top.get_yaxis_transform(),ha='left',fontsize=9)
 top.set_ylim(0,108);top.set_ylabel('Exact (%)');top.set_yticks([0,25,50,75,100])
 labels=['A\nEnum train\nEnum infer · cached','B\nEnum train\nContract infer','C\nContract train\nEnum infer','D · sole candidate\nContract train\nContract infer']
 top.set_xticks(range(4),labels,fontsize=10)
 reasons=['missing_unit','rpe_scope','unknown_exercise']; x=np.arange(3);width=.18
 for j,a in enumerate(arms):
  values=[summary['strictReasons'][a]['focus'][r]['correctReason'] for r in reasons]
  bars=bottom.bar(x+(j-1.5)*width,values,width,color=colors[j],label=a,zorder=3)
  bottom.bar_label(bars,padding=3,fontsize=9)
 bottom.axhline(14,color='#111',linestyle='--',linewidth=1)
 bottom.set_ylim(0,18);bottom.set_yticks([0,5,10,15]);bottom.set_ylabel('Correct / 15')
 bottom.set_xticks(x,['Missing weight unit','Ambiguous RPE set scope','Unknown exercise'])
 bottom.set_title('Correct clarification reasons · each group needs at least 14/15',loc='left',fontsize=11,pad=13)
 bottom.legend(ncols=4,frameon=False,loc='upper right')
 for ax in [top,bottom]:
  ax.spines[['top','right']].set_visible(False);ax.spines[['left','bottom']].set_color('#ccc')
  ax.grid(axis='y',color='#eee',zorder=0);ax.tick_params(axis='both',length=0,pad=6)
 fig.text(.09,.055,'One fixed training run, one seed; A is cached. These are observed development sets.\nSemantic safety, useful records and device acceptance are separate gates. No model activation.',fontsize=9,color='#555')
 for ext in ['png','svg']:
  fig.savefig(output.with_suffix('.'+ext),dpi=180,facecolor='white',metadata={'Date':None} if ext=='svg' else None)
  if ext=='svg':
   path=output.with_suffix('.svg')
   path.write_text('\n'.join(line.rstrip() for line in path.read_text(encoding='utf8').splitlines())+'\n',encoding='utf8')
 plt.close(fig)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--summary',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 render(json.loads(a.summary.read_text(encoding='utf8')),a.out)
