"""Publish complete I2 model evidence; CPU replays never claim to reload weights."""
import argparse
from copy import deepcopy
from pathlib import Path, PurePosixPath
import shutil
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))
from audit_i2 import audit, signatures
from audit_g2 import baseline
from d2_execution import read, aware, expected_runtime
from i2_gates import ARMS, evaluate
from i2_protocol import validate_opening, manifest_for, verify_plan
from i2_receipt_transfer import validate_index, validate_receipt
from i2_rollout import audit_projected_panels
from liftcut_agent.benchmark import read_jsonl
from prepare_counterfactual_diagnostics import load_tokenizer, verify_prepared as verify_d2
from prepare_state_diagnostics import verify_prepared as verify_diagnostic
from server_workspace import sha256, dump_new

EXECUTION = 'acbba44cb16dce519823f2277206a8cdf3fcfca6'
WEIGHT = 'reference/final/adapter_model.safetensors'
CAPTURES = ('backup-copy-status.json', 'opening.json', 'launch.json', 'window-close.json')
INSPECTION_FILES = ('inspection-source.py', 'request.json', 'stdout.json', 'stderr.txt', 'return.json', 'verified.json')


def verify_handoff(public):
    """Do not rewrite a missed automatic ACK as original controller consumption."""
    events=read_jsonl(public/'operations.jsonl');status=read(public/'backup-copy-status.json')
    result=events[-1]
    if result['event']!='collector_finished' or result['result']['server_consumed'] is not status['off_instance_acknowledged']:
        raise ValueError('original collector and server status differ')
    sent=result['result']['receipt_transfer'];receipt=read(public/'restore-receipt.json')
    if sent['status'] not in ('published','already_present') or sent['receipt_sha256']!=sha256(public/'restore-receipt.json'):
        raise ValueError('genuine receipt publication missing')
    if status['off_instance_acknowledged']:
        return {'original_controller_consumed':True,'separate_server_verification':None}
    folder=public/'receipt-inspection';value=read(folder/'verified.json')
    index=read(public/'backup-index.json');binding=index['binding'];request=read(folder/'request.json')
    returned=read(folder/'return.json')
    from inspect_i2_receipt import inspection_source
    run=sent['remote_final'].removesuffix('/off-instance-backup.json')
    expected_source=inspection_source({'remote_run':run},sha256(public/'restore-receipt.json'),binding)
    if (value!=read(folder/'stdout.json') or returned['returncode']!=0
            or (folder/'inspection-source.py').read_text(encoding='utf-8')!=expected_source
            or request['source_sha256']!=sha256(folder/'inspection-source.py')
            or request['binding']!=binding or request['receipt_sha256']!=sha256(public/'restore-receipt.json')
            or not aware(result['at_utc'])<=aware(request['at_utc'])<=aware(value['at_utc'])<=aware(returned['observed_at_utc'])<=aware(binding['collection_cutoff'])
            or value['version']!='i2-separate-receipt-verification-v1' or value['binding']!=binding
            or value['receipt']!=receipt or value['receipt_sha256']!=sha256(public/'restore-receipt.json') or value['index']!=index
            or value['original_server_status']!=status or value['original_window_close']!=read(public/'window-close.json')
            or value['original_controller_consumption'] is not False or not value['actual_remote_weights_verified']
            or value['separate_read_only_validator'] is not True or value['new_receipts_created']!=0
            or value['remote_files_modified']!=0 or value['new_model_calls']!=0 or value['deadline_extended'] is not False):
        raise ValueError('separate real server verification chain differs')
    original=[__import__('json').loads(line) for line in value['original_server_events'].splitlines() if line.strip()]
    if (any(e['event']=='server_receipt_consumed' for e in original)
            or not any(e['event']=='experiment_closed_instance_retained' and e['acknowledged'] is False for e in original)):
        raise ValueError('original missed consumption evidence differs')
    return {'original_controller_consumed':False,'separate_server_verification':value}


def inventory(run, *, metadata_only=False):
    files = {}
    for row in read(run / 'backup-inventory.json')['files']:
        name = row['path']; path = PurePosixPath(name)
        if (not path.parts or path.is_absolute() or '..' in path.parts or ':' in name
                or '\\' in name or str(path) != name or name == 'backup-inventory.json' or name in files):
            raise ValueError('unsafe or duplicate I2 inventory')
        files[name] = {k: row[k] for k in ('bytes', 'sha256')}
    if WEIGHT not in files:
        raise ValueError('fixed actual weight must be inventoried')
    actual = set()
    for p in run.rglob('*'):
        if p.is_symlink(): raise ValueError('symlinks cannot be published')
        if p.is_file(): actual.add(p.relative_to(run).as_posix())
    omitted = {WEIGHT} if metadata_only else set()
    if actual != (set(files)-omitted) | {'backup-inventory.json'}:
        raise ValueError('only the one private weight may be omitted')
    for name, value in files.items():
        if name not in omitted and (sha256(run/name) != value['sha256'] or (run/name).stat().st_size != value['bytes']):
            raise ValueError('original I2 bytes differ')
    return files


def metadata_replay(run, diagnostic, d2, tokenizer):
    """Independent published trace audit, explicitly without private weight access."""
    plan = verify_plan(); bind = validate_opening(read(run/'opening.json'), plan)
    verify_diagnostic(diagnostic); verify_d2(d2)
    tokenizer, _ = load_tokenizer(tokenizer)
    reference = plan['reference']
    if read(run/'reference/manifest.json') != reference:
        raise ValueError('reference selection changed')
    for name, value in reference['i1_view_sha256'].items():
        if sha256(run/'reference/i1-view'/name) != value:
            raise ValueError('original I1 view reference changed')
    if sha256(run/'reference/final/adapter_config.json') != reference['checkpoint']['adapter_sha256']['adapter_config.json']:
        raise ValueError('adapter metadata differs')
    reports = {}
    for arm in ARMS:
        path = run/'evaluation'/arm
        if read(path/'manifest.json') != manifest_for(bind, plan, arm):
            raise ValueError('I2 arm binding/configuration differs')
        load, finish = read(path/'load.json'), read(path/'finished.json')
        if (load['binding'] != bind or finish['binding'] != bind or load['arm'] != arm or finish['arm'] != arm
                or finish['new_training'] is not False or load['runtime'] != expected_runtime()
                or not aware(bind['trial_started_at_utc']) <= aware(load['at_utc']) <= aware(finish['finished_at_utc']) <= aware(bind['work_cutoff'])
                or not 0 <= finish['inference_wall_seconds'] <= finish['total_wall_seconds_including_load']):
            raise ValueError('I2 runtime/timing differs')
        reports[arm] = audit_projected_panels(path, diagnostic, d2, tokenizer, arm)
    old, raw = signatures(run/'reference/i1-view'), signatures(run/'evaluation/A')
    changed = [k for k in sorted(set(old)|set(raw)) if old.get(k) != raw.get(k)]
    return {'version':'i2-audit-v1','binding':bind,'evidence_kind':'model','model_result':True,
            'adapter_files_verified':False,'weights':None,'new_training':False,
            'episodes_replayed':444,'token_ids_verified':True,'projection_inputs_verified':True,'inverse_evidence_mapping_verified':True,
            'test_episodes':0,'arms':reports,
            'gates':evaluate(reports,baseline(diagnostic,d2),{a:run/'evaluation'/a for a in ARMS}),
            'historical_I1_view_repeat':{'all_native_requests_and_outputs_match':not changed,'changed_cases':changed,'historical_replaces_new_A':False},
            'scope':'Fixed-weight 2x2 system comparison on repeated development states, no independent generalization'}


def verify_complete(run, index_path, receipt_path, diagnostic, d2, tokenizer, *, metadata_only=False):
    index=read(index_path); bind=index['binding']
    validate_index(index,bind)
    if index['status']!='complete' or bind['code_commit']!=EXECUTION:
        raise ValueError('only frozen complete actual I2 evidence may be published')
    receipt=validate_receipt(receipt_path.read_bytes(),index,bind)
    files=inventory(run,metadata_only=metadata_only)
    if len(files)!=receipt['verified_files']:
        raise ValueError('receipt inventory count differs')
    status=read(run/'window-status.json')
    if status['status']!='complete' or status['binding']!=bind or status['failures']:
        raise ValueError('not a complete I2 window')
    reference=verify_plan()['reference']
    if files[WEIGHT]!={k:reference['checkpoint']['adapter_bytes'][k] for k in ('bytes','sha256')}:
        raise ValueError('archived weight is not the preselected control')
    result=metadata_replay(run,diagnostic,d2,tokenizer) if metadata_only else audit(run,diagnostic,d2,tokenizer)
    expected=deepcopy(read(run/'comparison.json'))
    if metadata_only: expected.update(adapter_files_verified=False,weights=None)
    if result!=expected or result['binding']!=bind:
        raise ValueError('independent I2 replay differs')
    return result


def publish(restored,index,operations,output,diagnostic,d2,tokenizer,inspection=None):
    if output.exists(): raise ValueError('new publication directory required')
    run=restored/'parts/evidence'
    if Path(read(restored/'restore-receipt.json')['run_directory']).resolve()!=run.resolve():
        raise ValueError('actual restored directory differs')
    receipt=restored/'off-instance-backup.json'
    result=verify_complete(run,index,receipt,diagnostic,d2,tokenizer)
    if result!=read(restored/'independent-audit.json'): raise ValueError('restored audit differs')
    events=read_jsonl(operations/'events.jsonl')
    if events[-1]['event']!='collector_finished':
        raise ValueError('original collector completion required')
    verified=[e for e in events if e['event']=='off_instance_verified']
    if len(verified)!=1 or verified[0]['receipt']!=read(receipt): raise ValueError('actual restoration missing')
    files=inventory(run); output.mkdir(parents=True)
    for name in sorted((set(files)-{WEIGHT})|{'backup-inventory.json'}):
        dest=output/'run'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(run/name,dest)
    for source,name in [(index,'backup-index.json'),(receipt,'restore-receipt.json'),
                        (operations/'events.jsonl','operations.jsonl'),(operations/'server-events-latest.jsonl','server-events.jsonl')]:
        shutil.copyfile(source,output/name)
    for name in CAPTURES: shutil.copyfile(operations/name,output/name)
    if inspection is not None:
        for name in INSPECTION_FILES:
            dest=output/'receipt-inspection'/name;dest.parent.mkdir(exist_ok=True)
            shutil.copyfile(inspection/name,dest)
    verify_handoff(output)
    inventory(output/'run',metadata_only=True)
    record={'version':'i2-publication-v1','binding':result['binding'],
            'original_receipt_sha256':sha256(receipt),'omitted_weight_file':{WEIGHT:files[WEIGHT]},
            'public_files_sha256':{p.relative_to(output).as_posix():sha256(p) for p in sorted(output.rglob('*')) if p.is_file()},
            'episodes_replayed':444,'actual_weights_checked_before_publication':True,
            'projection_inputs_verified':True,'inverse_evidence_mapping_verified':True,'new_receipts_created':0,'new_model_calls':0,'test_episodes':0}
    dump_new(output/'publication.json',record)
    return {'episodes_replayed':444,'new_receipts_created':0,'new_model_calls':0}


def publication_integrity(public):
    record=read(public/'publication.json')
    if (record['version']!='i2-publication-v1' or record['episodes_replayed']!=444
            or not record['actual_weights_checked_before_publication'] or not record['projection_inputs_verified']
            or not record['inverse_evidence_mapping_verified']
            or record['new_model_calls']!=0 or record['new_receipts_created']!=0 or record['test_episodes']!=0):
        raise ValueError('not complete actual I2 evidence')
    for name,value in record['public_files_sha256'].items():
        path=public/name
        if not path.resolve().is_relative_to(public.resolve()) or path.is_symlink() or sha256(path)!=value:
            raise ValueError('public bytes changed')
    files=inventory(public/'run',metadata_only=True)
    required={'run/'+n for n in (set(files)-{WEIGHT})|{'backup-inventory.json'}}
    required|={'backup-index.json','restore-receipt.json','operations.jsonl','server-events.jsonl',*CAPTURES}
    if (public/'receipt-inspection').exists():required|={'receipt-inspection/'+n for n in INSPECTION_FILES}
    if (set(record['public_files_sha256'])!=required or record['omitted_weight_file']!={WEIGHT:files[WEIGHT]}
            or record['original_receipt_sha256']!=sha256(public/'restore-receipt.json')
            or record['binding']!=read(public/'backup-index.json')['binding']):
        raise ValueError('complete provenance differs')
    verify_handoff(public)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('restored-dir','index','operations','output-dir','diagnostic-dir','d2-dir','tokenizer-dir'):p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--receipt-inspection',type=Path)
    a=p.parse_args();print(publish(a.restored_dir,a.index,a.operations,a.output_dir,a.diagnostic_dir,a.d2_dir,a.tokenizer_dir,a.receipt_inspection))
