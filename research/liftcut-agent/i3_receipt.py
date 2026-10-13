"""Genuine I3 receipts attest a delta archive PLUS actual verified parent weights."""
import json
import re
import hashlib
from pathlib import Path
from contextlib import closing
import uuid
from d2_execution import utcnow
from replication_receipt_transfer import _before_deadline, _remote_run, _verified_remote_bytes
from liftcut_agent.interactive import digest


def validate_index(index,bind,*,scripted=False):
    kind='scripted_contract' if scripted else 'model'
    if (set(index)!={'version','binding','status','evidence_kind','archive_is_self_contained','archives'}
            or index['version']!='i3-delta-index-v1' or index['binding']!=bind
            or index['status'] not in ('complete','partial') or index['evidence_kind']!=kind
            or index['archive_is_self_contained'] is not False or len(index['archives'])!=1):
        raise ValueError('I3 complete/partial delta binding differs')
    row=index['archives'][0]
    if (set(row)!={'path','archive','bytes','sha256'} or row['path']!='evidence.tar.gz'
            or row['archive']!='evidence.tar.gz' or type(row['bytes']) is not int
            or not 0<row['bytes']<=20_000_000 or not re.fullmatch('[0-9a-f]{64}',row['sha256'])):
        raise ValueError('bounded I3 evidence-only archive required')
    return index


def fields(index,bind,*,scripted=False):
    validate_index(index,bind,scripted=scripted);complete=index['status']=='complete'
    return {'version':'i3-delta-receipt-v1','binding':bind,'index_digest':digest(index),'run_status':index['status'],
        'evidence_kind':'scripted_contract' if scripted else 'model','model_result':complete and not scripted,
        'all_inventory_files_verified':True,'complete_study_replayed':complete,'episodes_replayed':64 if complete else 0,
        'actual_external_weight_verified':complete,'archive_is_self_contained':False,
        'token_ids_verified':complete,'projection_inputs_verified':complete,'inverse_mapping_verified':complete,
        'external_reference_digest':bind['reference_digest'],'new_training':False,'test_episodes':0}


def validate_receipt(content,index,bind,*,scripted=False):
    value=json.loads(content);expected=fields(index,bind,scripted=scripted)
    if (set(value)!=set(expected)|{'verified_files'} or type(value['verified_files']) is not int
            or value['verified_files']<1 or any(type(value[k]) is not type(v) or value[k]!=v for k,v in expected.items())):
        raise ValueError('not a complete real I3 delta-plus-parent receipt')
    return value


def transfer_receipt(sftp,path,remote_run,index,bind,deadline,*,now=utcnow,emit=None,scripted=False):
    """Transmit only bytes produced by the successful frozen I3 restorer."""
    emit=emit or (lambda *_a,**_k:None);path=Path(path)
    if path.is_symlink() or not path.is_file() or not 0<path.stat().st_size<65536:
        raise ValueError('bounded regular genuine I3 receipt required')
    content=path.read_bytes();validate_receipt(content,index,bind,scripted=scripted)
    remote=_remote_run(remote_run);final=str(remote/'off-instance-backup.json')
    temp=str(remote/('.off-instance-backup.'+uuid.uuid4().hex+'.tmp'))
    base={'receipt_sha256':hashlib.sha256(content).hexdigest(),'remote_final':final,
          'server_acceptance':'unknown','temp_path':temp}
    issued=False;stage='existing_final'
    try:
        _before_deadline(deadline,now)
        if _verified_remote_bytes(sftp,final,content,deadline,now,absent_allowed=True):
            result={**base,'status':'already_present'};emit('receipt_final_observed',**result);return result
        stage='write';_before_deadline(deadline,now)
        with closing(sftp.open(temp,'wx',bufsize=0)) as stream:
            written=stream.write(content)
            if written is not None and written!=len(content):raise ValueError('short I3 receipt write')
        stage='readback';_verified_remote_bytes(sftp,temp,content,deadline,now)
        emit('receipt_temporary_verified',**base)
        if _verified_remote_bytes(sftp,final,content,deadline,now,absent_allowed=True):
            result={**base,'status':'already_present'};emit('receipt_final_observed',**result);return result
        stage='rename';_before_deadline(deadline,now);issued=True;sftp.rename(temp,final)
        result={**base,'status':'published'};emit('receipt_atomic_published',**result);return result
    except Exception as error:
        result={**base,'status':'unknown' if issued else 'failed','stage':stage,'error_type':type(error).__name__}
        emit('receipt_publish_'+result['status'],**result);return result
