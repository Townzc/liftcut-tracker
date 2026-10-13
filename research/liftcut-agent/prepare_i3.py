"""Freeze I3 from actual I2 evidence, or rehearse scripted delta recovery offline."""
import argparse
from copy import deepcopy
from pathlib import Path
import shutil

from audit_i3 import audit
from d2_execution import read
from i3_protocol import ROOT,REFERENCE,EXECUTION,BUDGET,ARMS,prepare_reference,execution_plan,verify_plan,binding,prepared_cases
from i3_probe import evaluate
from i2_oracle import ScriptedNative
from liftcut_agent.interactive import digest
from prepare_counterfactual_diagnostics import load_tokenizer
from recovery_dataset import write_rows
from run_controlled_window import evidence_backup
from restore_i3 import assemble
from server_workspace import dump_new,sha256


def prepare(public,restored,diagnostic,d2,tokenizer):
    reference=prepare_reference(public,restored,diagnostic,d2,tokenizer)
    plan=execution_plan(reference)
    dump_new(REFERENCE,reference);dump_new(EXECUTION,plan)
    return {'source_files':len(plan['source_sha256']),'episodes':64,'parent_candidate_passed':True,'new_model_calls':0}


def drill(output,d2,tokenizer_dir,parent=None,receipt=None,index=None):
    if output.exists():raise ValueError('new CPU rehearsal output required')
    plan=verify_plan();cases=prepared_cases(d2,plan)
    tokenizer,_=load_tokenizer(tokenizer_dir)
    lease=read(ROOT/'reports/i2-overnight-preflight-2026-10-13/lease.json')
    # A clearly scripted clock, not a machine opening or an actual study start.
    start='2026-10-13T07:00:00+00:00';b=binding(plan,'0'*40,lease,start)
    run=output/'SCRIPTED-I3-ONLY';run.mkdir(parents=True)
    dump_new(run/'opening.json',{'binding':b,'at_utc':start,'evidence_kind':'scripted_contract','budget':BUDGET})
    dump_new(run/'reference.json',plan['reference']);write_rows(run/'cases.jsonl',cases)
    for arm in ARMS:
        folder=run/'evaluation'/arm
        dump_new(folder/'manifest.json',{'binding':b,'arm':arm,'config':plan['config']})
        dump_new(folder/'load.json',{'binding':b,'arm':arm,'runtime':{'scripted_contract':True},'at_utc':start,'seconds':0})
        evaluate(folder/'decisions',cases,lambda callback:ScriptedNative('d2',cases,tokenizer,callback,arm),arm)
        dump_new(folder/'finished.json',{'binding':b,'arm':arm,'at_utc':start,'inference_wall_seconds':0,
                                       'total_wall_seconds_including_load':0,'new_training':False})
    result=audit(run,d2,tokenizer_dir,parent,receipt,index,scripted=True,plan=plan,metadata_only=parent is None)
    dump_new(run/'comparison.json',result)
    complete=parent is not None
    dump_new(run/'window-status.json',{'binding':b,'status':'complete' if complete else 'partial',
                                    'archive_is_self_contained':False,'failures':[]})
    item=evidence_backup(run)
    backup={'version':'i3-delta-index-v1','binding':b,'status':'complete' if complete else 'partial',
            'evidence_kind':'scripted_contract','archive_is_self_contained':False,'archives':[{'path':item['archive'],**item}]}
    archives=output/'downloads';archives.mkdir()
    shutil.copyfile(run/item['archive'],archives/item['archive']);dump_new(archives/'backup-index.json',backup)
    restored=assemble(archives,output/'restored',d2,tokenizer_dir,parent,receipt,index,
                      allow_partial=True,scripted=True,plan=plan)
    if restored['model_result'] or restored['complete_study_replayed']!=complete:
        raise ValueError('scripted or partial evidence was incorrectly promoted')
    report={'version':'i3-readiness-v1','evidence_kind':'scripted_contract','model_result':False,
        'new_model_calls':0,'reserved_test_reads':0,'scripted_decisions_replayed':64,
        'actual_parent_weight_verified':complete,'complete_scripted_delta_restore':complete,
        'archive_is_self_contained':False,'delta_archive_bytes':item['bytes'],
        'source_sha256':plan['source_sha256'],
        'arms':{a:{k:result['arms'][a][k] for k in ('correct','unique_projected_inputs','identity_score_flip_groups')} for a in ARMS},
        'scripted_gates':result['comparison']['gates']}
    dump_new(output/'readiness.json',report)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--prepare',action='store_true');mode.add_argument('--drill',action='store_true')
    for n in ('public-dir','i2-restored','diagnostic-dir','d2-dir','tokenizer-dir','output-dir','parent-run','parent-receipt','parent-index'):
        p.add_argument('--'+n,type=Path)
    a=p.parse_args()
    if a.prepare:print(prepare(a.public_dir,a.i2_restored,a.diagnostic_dir,a.d2_dir,a.tokenizer_dir))
    else:
        value=drill(a.output_dir,a.d2_dir,a.tokenizer_dir,a.parent_run,a.parent_receipt,a.parent_index)
        print({k:v for k,v in value.items() if k!='source_sha256'})
