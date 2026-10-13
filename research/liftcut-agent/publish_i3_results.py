"""Publish genuine I3 delta evidence; keep its actual I2 weight dependency explicit."""
import argparse
from copy import deepcopy
from pathlib import Path,PurePosixPath
import shutil
from audit_i3 import audit
from d2_execution import read,aware
from i3_protocol import ROOT,verify_plan
from i3_receipt import validate_index,validate_receipt
from liftcut_agent.benchmark import read_jsonl
from server_workspace import dump_new,sha256

EXECUTION='2576cd3c0913fbdac122c0b216830c16ec80c5c1'
CAPTURES=('opening.json','launch.json','backup-copy-status.json','window-close.json','server-events-latest.jsonl')


def inventory(run):
    files={}
    for row in read(run/'backup-inventory.json')['files']:
        name=row['path'];p=PurePosixPath(name)
        if (not p.parts or p.is_absolute() or '..' in p.parts or ':' in name or '\\' in name
                or str(p)!=name or name=='backup-inventory.json' or name in files or name.endswith('.safetensors')):
            raise ValueError('unsafe, duplicate or unexpected private I3 file')
        files[name]={k:row[k] for k in ('bytes','sha256')}
    actual=set()
    for p in run.rglob('*'):
        if p.is_symlink():raise ValueError('symlink in published I3 evidence')
        if p.is_file():actual.add(p.relative_to(run).as_posix())
    if actual!=set(files)|{'backup-inventory.json'}:raise ValueError('I3 inventory differs')
    for name,row in files.items():
        p=run/name
        if p.stat().st_size!=row['bytes'] or sha256(p)!=row['sha256']:raise ValueError('I3 raw bytes differ')
    return files


def verify_complete(run,index_path,receipt_path,d2,tokenizer,parent=None,parent_receipt=None,parent_index=None,*,metadata_only=False):
    index=read(index_path);b=index['binding'];validate_index(index,b)
    if index['status']!='complete' or b['code_commit']!=EXECUTION:raise ValueError('exact complete actual I3 required')
    receipt=validate_receipt(receipt_path.read_bytes(),index,b);files=inventory(run)
    if len(files)!=receipt['verified_files']:raise ValueError('I3 receipt inventory count differs')
    status=read(run/'window-status.json')
    if status['binding']!=b or status['status']!='complete' or status['failures']:raise ValueError('incomplete I3 window')
    result=audit(run,d2,tokenizer,parent,parent_receipt,parent_index,metadata_only=metadata_only)
    expected=deepcopy(read(run/'comparison.json'))
    if metadata_only:expected.update(actual_external_weight_verified=False,external_weights=None)
    if result!=expected or not result['model_result']:raise ValueError('independent I3 reconstruction differs')
    return result


def verify_handoff(public):
    events=read_jsonl(public/'operations.jsonl');server=read_jsonl(public/'server-events-latest.jsonl')
    index=read(public/'backup-index.json');b=index['binding'];h=sha256(public/'restore-receipt.json')
    last=events[-1];status=read(public/'backup-copy-status.json');close=read(public/'window-close.json')
    if (last['event']!='collector_finished' or last['result']['server_consumed'] is not True
            or status['off_instance_acknowledged'] is not True or close['off_instance_acknowledged'] is not True
            or close['power_action']!='retain_under_original_overnight_guard'
            or close['shutdown_at_utc']!=b['power_lease']['shutdown_at_utc']):
        raise ValueError('original I3 server consumption not observed')
    checked=[e for e in events if e['event']=='off_instance_verified']
    published=[e for e in events if e['event'] in ('receipt_atomic_published','receipt_final_observed')]
    consumed=[e for e in server if e['event']=='server_receipt_consumed']
    if (len(checked)!=1 or checked[0]['receipt']!=read(public/'restore-receipt.json')
            or len(published)!=1 or published[0]['receipt_sha256']!=h
            or len(consumed)!=1 or consumed[0]['receipt_sha256']!=h or consumed[0]['status']!='complete'
            or last['result']['receipt_transfer']['receipt_sha256']!=h
            or last['result']['window_close']!=close
            or not aware(b['trial_started_at_utc'])<=aware(checked[0]['at_utc'])<=aware(published[0]['at_utc'])<=aware(last['at_utc'])<=aware(b['collection_cutoff'])
            or not aware(b['trial_started_at_utc'])<=aware(consumed[0]['at_utc'])<=aware(close['at_utc'])<=aware(b['collection_cutoff'])):
        raise ValueError('I3 genuine publication/consumption chain differs')
    return {'original_server_consumed':True,'receipt_sha256':h,'published_at_utc':published[0]['at_utc'],
            'server_consumed_at_utc':consumed[0]['at_utc'],'collector_finished_at_utc':last['at_utc'],
            'power_action':close['power_action'],'provider_billing_stopped':False}


def publication_integrity(public):
    manifest=read(public/'publication-manifest.json')
    if (manifest['version']!='i3-publication-v1' or manifest['execution_commit']!=EXECUTION
            or manifest['archive_is_self_contained'] is not False or manifest['actual_parent_weight_verified_at_publication'] is not True
            or manifest['model_result'] is not True or manifest['episodes_replayed']!=64
            or manifest['business_anchors']!=8 or manifest['heldout_tasks']!=0
            or manifest['independent_generalization'] is not False):
        raise ValueError('I3 external-dependency publication binding differs')
    expected={'run/'+name for name in set(inventory(public/'run'))|{'backup-inventory.json'}}
    expected.update({'backup-index.json','restore-receipt.json','independent-audit.json','operations.jsonl',*CAPTURES})
    if set(manifest['raw_sha256'])!=expected:
        raise ValueError('I3 publication manifest omits or adds raw evidence')
    for name,h in manifest['raw_sha256'].items():
        p=PurePosixPath(name)
        if (p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name
                or (public/name).is_symlink() or sha256(public/name)!=h):
            raise ValueError('I3 publication raw file changed')
    return manifest


def publish(restored,index,operations,output,d2,tokenizer,parent,parent_receipt,parent_index):
    if output.exists():raise ValueError('new I3 publication directory required')
    run=restored/'parts/evidence';receipt=restored/'off-instance-backup.json'
    if Path(read(restored/'restore-receipt.json')['run_directory']).resolve()!=run.resolve():
        raise ValueError('restored I3 directory binding differs')
    result=verify_complete(run,index,receipt,d2,tokenizer,parent,parent_receipt,parent_index)
    if result!=read(restored/'independent-audit.json'):raise ValueError('independent actual-parent audit differs')
    output.mkdir(parents=True)
    for n in sorted(set(inventory(run))|{'backup-inventory.json'}):
        p=output/'run'/n;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(run/n,p)
    for src,name in ((index,'backup-index.json'),(receipt,'restore-receipt.json'),
                     (restored/'independent-audit.json','independent-audit.json'),(operations/'events.jsonl','operations.jsonl')):
        shutil.copyfile(src,output/name)
    for n in CAPTURES:shutil.copyfile(operations/n,output/n)
    handoff=verify_handoff(output)
    raw={p.relative_to(output).as_posix():sha256(p) for p in sorted(output.rglob('*')) if p.is_file()}
    value={'version':'i3-publication-v1','execution_commit':EXECUTION,'raw_sha256':raw,'handoff':handoff,
           'actual_parent_weight_verified_at_publication':True,'archive_is_self_contained':False,
           'parent_reference':verify_plan()['reference'],'model_result':True,'episodes_replayed':64,
           'business_anchors':8,'independent_generalization':False,'heldout_tasks':0}
    dump_new(output/'publication-manifest.json',value);return value


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('restored','backup-index','operations','output-dir','d2-dir','tokenizer-dir','parent-run','parent-receipt','parent-index'):
        p.add_argument('--'+n,type=Path,required=True)
    a=p.parse_args();result=publish(a.restored,a.backup_index,a.operations,a.output_dir,a.d2_dir,a.tokenizer_dir,a.parent_run,a.parent_receipt,a.parent_index)
    print({'raw_files':len(result['raw_sha256']),'episodes':64,'archive_is_self_contained':False})
