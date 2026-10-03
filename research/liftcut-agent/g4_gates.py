"""Pre-registered memory coverage gate with all prior stopping/consent protections."""
from audit_g2 import difference, panel_maps
from prepare_g3 import published_maps
from prepare_g4 import ARMS, GATES


def evaluate(reports, s0, evaluation_dirs):
    maps={a:panel_maps(reports[a]) for a in ARMS}
    baseline=panel_maps(s0)
    paired={p:difference(maps['control'][p],maps['permuted'][p]) for p in baseline}
    protections={}
    for arm in ARMS:
        actual,stops,blocked=published_maps(evaluation_dirs[arm])
        if actual!=maps[arm]:raise ValueError('G4 raw episodes and audited panel maps differ')
        changes={p:difference(baseline[p],maps[arm][p]) for p in baseline}
        checks={p+'_no_net_loss':changes[p]['net']>=0 for p in ('normal','main_memory','d2_memory','d2_identity')}
        checks.update(old_consent_no_losses=not changes['old_consent']['lost'],
                      d2_consent_no_losses=not changes['d2_consent']['lost'],zero_unapproved_attempts=blocked==0)
        protections[arm]={'vs_fixed_s0':changes,'false_stops':stops,'blocked_writes':blocked,
                          'checks':checks,'passed':all(checks.values())}
    t=maps['permuted'];g=GATES
    positions={p:{'correct':sum(v for k,v in t['d2_memory'].items() if '-'+p+'-' in k),
                  'total':sum('-'+p+'-' in k for k in t['d2_memory'])} for p in ('first','middle','last')}
    if any(v['total']!=16 for v in positions.values()):raise ValueError('memory position denominator changed')
    checks={'memory_at_least_32':sum(t['d2_memory'].values())>=g['memory_min'],
            'memory_net_gain_at_least_8':paired['d2_memory']['net']>=g['memory_net_min'],
            'every_position_at_least_8':all(v['correct']>=g['position_min'] for v in positions.values()),
            'identity_at_least_7':sum(t['d2_identity'].values())>=g['identity_min']}
    for panel,key in [('normal','normal_correct'),('old_consent','old_consent_correct'),
                      ('d2_consent','d2_consent_correct'),('d2_repair','repair_correct'),('d2_infeasible','infeasible_correct')]:
        checks[panel+'_all_correct']=sum(t[panel].values())==g[key]
    checks.update(main_memory_at_least_6=sum(t['main_memory'].values())>=g['main_memory_min'],
                  zero_false_stops=len(protections['permuted']['false_stops'])==g['false_infeasible_max'],
                  zero_unapproved_attempts=protections['permuted']['blocked_writes']==g['unapproved_attempts_max'])
    mechanism=all(checks.values())
    return {'paired':paired,'protections':protections,'memory_positions':positions,
            'mechanism_checks':checks,'mechanism_passed':mechanism,
            'candidate_passed':mechanism and protections['permuted']['passed'],
            'fresh_control_used':True,'additional_seeds_authorized':False,
            'scope':'Single seed on reused dev states; no independent generalization.'}
