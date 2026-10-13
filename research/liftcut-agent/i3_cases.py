"""Registered I3 ID variants from existing development states; no held-out reads."""
from copy import deepcopy
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from counterfactual_diagnostics import case_from,projection,load_prepared
from state_diagnostics import expected_rule
from liftcut_agent.interactive import digest

CODEBOOKS=('hex-719','hex-727','uuid-733','uuid-739')
ORDERS=('original',)


def fixtures(d2,catalog):
    source=load_prepared(d2)
    anchors=[c for c in source if c['panel']=='memory' and c['factors']['position']=='first'
             and c['factors']['invalid']=='unconfirmed']
    if len(anchors)!=8:raise ValueError('eight structural anchors required')
    cases=[]
    for index,anchor in enumerate(anchors):
        for book in CODEBOOKS:
            for order in ORDERS:
                scenario=deepcopy(anchor['scenario'])
                scenario['id']=f'i3-a{index:02d}-{book}-{order}'
                ids=[r['id'] for r in scenario['input']['records']+scenario['memories']]
                if len(ids)!=len(set(ids)):raise ValueError('source IDs ambiguous')
                table={}
                for old in ids:
                    h=digest(['i3-evidence-codebook-v1',book,index,old])
                    table[old]='src_'+h[:12] if book.startswith('hex') else '-'.join((h[:8],h[8:12],h[12:16],h[16:20],h[20:32]))
                if len(set(table.values()))!=len(table):raise ValueError('new IDs collide')
                for row in scenario['input']['records']+scenario['memories']:row['id']=table[row['id']]
                actions=[e['action'] for e in anchor['prefix']['trace']['events'] if e['actor']=='agent']
                factors={**anchor['factors'],'anchor_index':index,'codebook':book,'record_order':order}
                case=case_from(scenario,'memory',factors,actions,catalog)
                case.update(anchor_case_id=anchor['id'],identity_bijection=table)
                case['expected']=expected_rule(case,catalog)
                case['contract']={'max_requests':1,'mode':'first_response',
                    'state_sha256':digest(case['prefix']['snapshot']),'projection_sha256':digest(projection(case))}
                if projection(case)!=projection(anchor):raise ValueError('business state changed')
                reverse={v:k for k,v in table.items()}
                original=deepcopy(scenario)
                original['id']=anchor['scenario']['id']
                for row in original['input']['records']+original['memories']:row['id']=reverse[row['id']]
                if original!=anchor['scenario']:raise ValueError('non-nuisance content changed')
                cases.append(case)
    if len(cases)!=32 or len({c['id'] for c in cases})!=32:raise ValueError('I3 denominator mismatch')
    return cases
