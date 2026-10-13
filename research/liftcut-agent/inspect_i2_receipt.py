"""One read-only server verification of an already published genuine I2 receipt.

This cannot create receipts, change the old controller's status or extend a lease.
It records a separate verification when collection outlasts the old ACK wait.
"""
import argparse
import getpass
import json
from pathlib import Path
import shlex
import threading
from d2_execution import read, utcnow, aware
from i2_receipt_transfer import validate_receipt
from liftcut_agent.benchmark import read_jsonl
from server_workspace import dump_new, sha256

EXECUTION = 'acbba44cb16dce519823f2277206a8cdf3fcfca6'


def inspection_source(cfg, receipt_hash, binding):
    root = '/root/autodl-tmp/liftcut/code/' + EXECUTION + '/research/liftcut-agent'
    # Only reads existing bytes and process identity. No remote filesystem writes.
    return '\n'.join([
        'import sys,json;from pathlib import Path',
        'sys.dont_write_bytecode=True',
        'sys.path[:0]=' + repr([root, root + '/src']),
        'from i2_protocol import verify_plan,validate_opening,verify_adapter',
        'from i2_receipt_transfer import validate_receipt',
        'from server_workspace import sha256',
        'from d2_execution import read,utcnow,aware',
        'from research_lease import verify_live',
        'run=Path(' + repr(cfg['remote_run']) + ')',
        'plan=verify_plan();opening=read(run/"opening.json")',
        'binding=validate_opening(opening,plan)',
        'assert binding==' + repr(binding),
        'assert utcnow()<aware(binding["collection_cutoff"]),"original collection deadline"',
        'lease=verify_live(Path("/root/autodl-tmp/liftcut/ops/overnight-20261013-042700/lease.json"))',
        'assert lease==binding["power_lease"]',
        'index=read(run/"backup-index.json");path=run/"off-instance-backup.json"',
        'assert sha256(path)==' + repr(receipt_hash),
        'receipt=validate_receipt(path.read_bytes(),index,binding)',
        'assert receipt["complete_study_replayed"] and receipt["model_result"]',
        'weight=verify_adapter(run/"reference/final",plan["reference"]["checkpoint"])',
        'status=read(run/"backup-copy-status.json");close=read(run/"window-close.json")',
        'events=(run/"events.jsonl").read_text()',
        'assert utcnow()<aware(binding["collection_cutoff"]),"original collection deadline"',
        'value={"version":"i2-separate-receipt-verification-v1","at_utc":utcnow().isoformat(),',
        '"binding":binding,"receipt_sha256":sha256(path),"receipt":receipt,',
        '"index":index,"actual_remote_weights_verified":True,"original_server_status":status,',
        '"original_window_close":close,"original_server_events":events,',
        '"original_controller_consumption":status["off_instance_acknowledged"],',
        '"separate_read_only_validator":True,"new_receipts_created":0,"remote_files_modified":0,',
        '"new_model_calls":0,"deadline_extended":False}',
        'print(json.dumps(value))',
    ])


def inspect(operations, restored, output):
    if output.exists():
        raise ValueError('new inspection evidence directory required; no automatic retry')
    cfg=read(operations/'config.json')
    events=read_jsonl(operations/'events.jsonl')
    if events[-1]['event']!='collector_finished':
        raise ValueError('original collector must finish before a separate inspection')
    receipt=restored/'off-instance-backup.json'
    index=read(Path(cfg['downloads'])/'backup-index.json');bind=index['binding']
    actual=validate_receipt(receipt.read_bytes(),index,bind)
    if (not actual['model_result'] or bind['code_commit']!=EXECUTION
            or utcnow()>=aware(bind['collection_cutoff'])):
        raise ValueError('original complete I2 and unextended collection window required')
    sent=events[-1]['result']['receipt_transfer']
    if sent['status'] not in ('published','already_present') or sent['receipt_sha256']!=sha256(receipt):
        raise ValueError('must inspect the existing actual published receipt')
    source=inspection_source(cfg,sha256(receipt),bind)
    compile(source,'<read-only-remote-inspection>','exec')
    output.mkdir(parents=True,exist_ok=False)
    (output/'inspection-source.py').write_text(source,encoding='utf-8')
    dump_new(output/'request.json',{'at_utc':utcnow().isoformat(),'receipt_sha256':sha256(receipt),
                                  'source_sha256':sha256(output/'inspection-source.py'),'binding':bind})
    import paramiko
    client=paramiko.SSHClient();client.load_host_keys(cfg['known_hosts'])
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    password=getpass.getpass('Read-only I2 receipt inspection password (not stored): ')
    remaining=(aware(bind['collection_cutoff'])-utcnow()).total_seconds()
    if remaining<45:raise TimeoutError('insufficient original collection time')
    timer=threading.Timer(min(60,remaining),client.close);timer.daemon=True;timer.start()
    try:
        client.connect(cfg['ssh_host'],port=cfg['ssh_port'],username=cfg['ssh_user'],password=password,
                       allow_agent=False,look_for_keys=False,timeout=10,auth_timeout=10,banner_timeout=10)
        password=None
        command=shlex.join([cfg['remote_python'],'-B','-c',source])
        _,stdout,stderr=client.exec_command(command,timeout=min(40,remaining))
        raw=stdout.read();err=stderr.read();code=stdout.channel.recv_exit_status()
        (output/'stdout.json').write_bytes(raw);(output/'stderr.txt').write_bytes(err)
        dump_new(output/'return.json',{'returncode':code,'observed_at_utc':utcnow().isoformat()})
        if code:raise RuntimeError('read-only server receipt inspection failed; evidence preserved')
        value=json.loads(raw)
        if value['receipt']!=actual or value['index']!=index or value['receipt_sha256']!=sha256(receipt):
            raise ValueError('remote existing receipt differs from real local recovery')
        dump_new(output/'verified.json',value)
        print({'separate_server_verification':True,'original_controller_consumption':value['original_controller_consumption'],
               'new_receipts_created':0,'new_model_calls':0})
    finally:
        password=None;client.close();timer.cancel()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for name in ('operations','restored-dir','output-dir'):p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();inspect(a.operations,a.restored_dir,a.output_dir)
