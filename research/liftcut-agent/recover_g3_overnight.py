"""One inspected G3 collection recovery and explicitly authorized overnight power handoff.

Never launches training. Preserves original partial bytes, validates remote prefixes,
and uses the unchanged G3 restorer to produce the only complete backup receipt.
"""
import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import sys
import threading
import time
import uuid

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'src'))
from d2_execution import event_file, read
from g3_execution import aware
from g3_receipt_transfer import validate_index
from launch_g3_remote import local_preflight, prefix_hash
from monitor_g3 import validate_remote, restore_and_publish
from monitor_coverage_replication import TimeBudget, io_budget, remote_bytes, json_lines, persist_json
from overnight_lease import COMMIT, DEADLINE, ORIGINAL_HARD, RUN, validate_lease
from server_workspace import dump_new, sha256

PYTHON='/root/autodl-tmp/liftcut/envs/qwen-pilot-py312/bin/python'
LEASE_DIR='/root/autodl-tmp/liftcut/ops/overnight-20261003'


def assert_no_collector():
    import psutil
    found=[]
    for process in psutil.process_iter(['pid','cmdline']):
        if process.info['pid']==os.getpid():
            continue
        argv=process.info['cmdline'] or []
        scripts={Path(x).name for x in argv}
        if (('launch_g3_remote.py' in scripts and '--execute' in argv)
                or ('monitor_g3.py' in scripts and '--connect' in argv)
                or 'recover_g3_overnight.py' in scripts):
            found.append(process.info['pid'])
    if found:
        raise ValueError('an existing G3 collector is still present: '+str(found))


def remote_python(client, code, *, timeout=45):
    _,stdout,stderr=client.exec_command(shlex.join([PYTHON,'-c',code]),timeout=timeout)
    data=stdout.read()
    if stdout.channel.recv_exit_status()!=0:
        # Only controlled operation diagnostics; never /usr/bin/shutdown response bodies.
        raise RuntimeError('remote maintenance failed: '+stderr.read(4000).decode(errors='replace'))
    return json.loads(data)


def install_lease(client,sftp,emit,operations):
    local=ROOT/'overnight_lease.py'
    try:
        sftp.stat('/root/autodl-tmp/liftcut/ops')
    except FileNotFoundError:
        sftp.mkdir('/root/autodl-tmp/liftcut/ops')
    sftp.mkdir(LEASE_DIR)
    remote=LEASE_DIR+'/overnight_lease.py'
    with local.open('rb') as source,sftp.open(remote,'wx') as target:
        target.write(source.read())
    cfg={'version':'liftcut-overnight-lease-v1','deadline':DEADLINE,'reserve_cny':20,'hourly_cny':2.18,
         'execution_commit':COMMIT,'g3_run':RUN,'original_hard_cutoff':ORIGINAL_HARD,
         'authorization':'explicit_user_20261003_overnight_0700_Los_Angeles_CNY20',
         'booted_at_proxy':'2026-10-03T05:35:00.409447+00:00',
         'earlier_failed_opening_cny':0.3630052281944445,
         'code_root':f'/root/autodl-tmp/liftcut/code/{COMMIT}/research/liftcut-agent'}
    validate_lease(cfg,datetime.now(timezone.utc))
    code='CFG='+repr(cfg)+'\nSCRIPT='+repr(remote)+'\nSHA='+repr(sha256(local))+'''\n
import hashlib,json,subprocess,time,runpy
from pathlib import Path
script=Path(SCRIPT)
assert hashlib.sha256(script.read_bytes()).hexdigest()==SHA
module=runpy.run_path(str(script))
folder=script.parent
identities=[module['process'](pid) for pid in (1325,1229,1334)]
controller,*guards=identities
assert controller['argv'][1]==CFG['code_root']+'/run_g3_window.py'
assert controller['argv'][controller['argv'].index('--output-dir')+1]==CFG['g3_run']
assert all(g['argv'][1].endswith('/shutdown_guard.py') and g['argv'][g['argv'].index('--deadline')+1]==CFG['original_hard_cutoff'] for g in guards)
assert guards[0]['argv'][guards[0]['argv'].index('--receipt')+1]=='/root/autodl-tmp/liftcut/runs/g3-ops-20261003-053547/setup-guard.jsonl'
assert guards[1]['argv'][guards[1]['argv'].index('--receipt')+1]==CFG['g3_run']+'/deadline-guard.jsonl'
CFG.update(controller_identity=controller,original_guard_identities=guards)
lease=folder/'lease.json'
module['exclusive'](lease,CFG)
with (folder/'guard.log').open('x') as log:
    guard=subprocess.Popen([controller['argv'][0],str(script),'--lease',str(lease),'--mode','guard'],stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
for _ in range(100):
    if (folder/'guard-armed.json').exists(): break
    if guard.poll() is not None: raise RuntimeError('replacement guard exited')
    time.sleep(.1)
module['guard_alive'](folder,CFG)
with (folder/'handoff.log').open('x') as log:
    watcher=subprocess.Popen([controller['argv'][0],str(script),'--lease',str(lease),'--mode','handoff'],stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
time.sleep(.5)
assert watcher.poll() is None
print(json.dumps({'script_sha256':SHA,'lease':CFG,'guard_pid':guard.pid,'watcher_pid':watcher.pid,'guard':module['read'](folder/'guard-armed.json')}))
'''
    result=remote_python(client,code)
    dump_new(operations/'overnight-lease-install.json',result)
    emit('new_user_overnight_lease_armed',deadline=DEADLINE,reserve_cny=20,
         guard_pid=result['guard_pid'],watcher_pid=result['watcher_pid'],training_conditions_changed=False)
    return result


def resume_archive(client,sftp,item,cfg,budget,emit,original_downloads):
    target=cfg['downloads']/item['archive']
    if target.exists():
        if target.stat().st_size!=item['bytes'] or sha256(target)!=item['sha256']:
            raise ValueError('different existing full archive')
        return
    remote=cfg['remote_run']+'/'+item['path']
    io_budget(sftp,budget)
    st=sftp.lstat(remote)
    import stat
    if not stat.S_ISREG(st.st_mode) or st.st_size!=item['bytes'] or not 0<item['bytes']<=512_000_000:
        raise ValueError('unexpected remote archive')
    originals=list(original_downloads.glob(item['archive']+'.*.partial'))
    if (original_downloads/item['archive']).exists():
        originals.append(original_downloads/item['archive'])
    originals.sort(key=lambda p:p.stat().st_size,reverse=True)
    original=originals[0] if originals else None
    count=original.stat().st_size if original else 0
    if count>item['bytes'] or (original and original.is_symlink()):
        raise ValueError('invalid retained partial')
    if count:
        code='P='+repr(remote)+'\nN='+str(count)+'''\n
import hashlib,json
from pathlib import Path
h=hashlib.sha256()
with Path(P).open('rb') as stream:
    left=N
    while left:
        block=stream.read(min(left,1048576))
        if not block: raise ValueError('short remote prefix')
        h.update(block);left-=len(block)
print(json.dumps({'bytes':N,'sha256':h.hexdigest()}))
'''
        remote_prefix=remote_python(client,code)
        if remote_prefix['sha256']!=prefix_hash(original,count):
            raise ValueError('retained partial does not match remote prefix')
    temp=target.with_name(target.name+'.'+uuid.uuid4().hex+'.partial')
    if original:
        shutil.copyfile(original,temp)
    else:
        temp.touch(exist_ok=False)
    emit('archive_prefix_verified_for_recovery',archive=target.name,preserved_source=str(original) if original else None,
         verified_prefix_bytes=count,remaining_bytes=item['bytes']-count)
    io_budget(sftp,budget)
    offset,last=count,time.monotonic()
    with sftp.open(remote,'rb') as source,temp.open('ab') as sink:
        source.seek(count)
        while offset<item['bytes']:
            io_budget(sftp,budget)
            chunk=source.read(min(65536,item['bytes']-offset))
            if not chunk or len(chunk)>item['bytes']-offset:
                raise ValueError('short or oversized recovery stream')
            sink.write(chunk);offset+=len(chunk)
            if time.monotonic()-last>=30:
                sink.flush()
                emit('recovery_download_progress',archive=target.name,received_bytes=offset,total_bytes=item['bytes'])
                last=time.monotonic()
        if source.read(1):
            raise ValueError('remote archive grew')
    budget.check()
    if sha256(temp)!=item['sha256']:
        raise ValueError('recovered archive hash differs')
    temp.rename(target)
    emit('archive_bytes_verified',archive=target.name,bytes=item['bytes'],sha256=item['sha256'])


def collect(client,sftp,cfg,plan,budget,emit,original_downloads):
    required=lambda path: remote_bytes(sftp,path,budget)
    opening=json.loads(required(cfg['remote_run']+'/opening.json'))
    launch=json.loads(required(cfg['remote_ops']+'/controller-launch.json'))
    setup=json_lines(required(cfg['remote_ops']+'/setup-guard.jsonl'))
    guard=json_lines(required(cfg['remote_run']+'/deadline-guard.jsonl'))
    bind=validate_remote(cfg,plan,opening,launch,setup,guard)
    emit('monitor_ready',binding=bind,recovery_only=True,original_g3_deadlines_unchanged=True,
         power_deadline_superseded_by_new_user_lease=DEADLINE)
    seen,last={},None
    while budget.remaining()>60:
        data=remote_bytes(sftp,cfg['remote_run']+'/events.jsonl',budget,tail=True) or b''
        (cfg['operations']/'server-events-latest.jsonl').write_bytes(data)
        rows=json_lines(data)
        if rows and rows[-1]!=last:
            last=rows[-1];emit('server_event',record=last)
        for row in json_lines(remote_bytes(sftp,cfg['remote_run']+'/early-index.jsonl',budget)):
            arm=row['arm']
            if arm not in ('stop_half','stop_all') or row['binding']!=bind or row['path']!='training/'+arm+'.tar.gz':
                raise ValueError('unexpected early archive identity')
            if arm in seen and seen[arm]!=row:
                raise ValueError('early archive identity changed')
            if arm not in seen:
                resume_archive(client,sftp,row,cfg,budget,emit,original_downloads)
                seen[arm]=row
        raw=remote_bytes(sftp,cfg['remote_run']+'/backup-index.json',budget)
        if raw:
            index=json.loads(raw);validate_index(index,bind)
            persist_json(cfg['downloads']/'backup-index.json',index)
            for item in index['archives']:
                if item['part'] in seen and any(item[k]!=seen[item['part']][k] for k in ('path','archive','bytes','sha256')):
                    raise ValueError('final archive differs from early record')
                resume_archive(client,sftp,item,cfg,budget,emit,original_downloads)
            # Require the real supervisor handoff before publishing any receipt that would trigger old shutdown.
            handoff=remote_bytes(sftp,LEASE_DIR+'/handoff-complete.json',budget)
            if not handoff or json.loads(handoff)['index']!=index:
                raise ValueError('overnight handoff has not safely retired the backup-wait controller')
            (cfg['operations']/'overnight-handoff.json').write_bytes(handoff)
            result=restore_and_publish(sftp,index,cfg,bind,budget,emit)
            if result['status'] not in ('published','already_present'):
                return result
            code='CODE='+repr(f'/root/autodl-tmp/liftcut/code/{COMMIT}/research/liftcut-agent')+'\nRUN='+repr(cfg['remote_run'])+'\nLEASE='+repr(LEASE_DIR)+'''\n
import sys,json,hashlib,runpy
from pathlib import Path
sys.path[:0]=[CODE,CODE+'/src']
from g3_receipt_transfer import validate_receipt
run=Path(RUN);folder=Path(LEASE)
module=runpy.run_path(str(folder/'overnight_lease.py'))
module['guard_alive'](folder,module['read'](folder/'lease.json'))
index=module['read'](run/'backup-index.json')
content=(run/'off-instance-backup.json').read_bytes()
receipt=validate_receipt(content,index,index['binding'])
result={'consumer':'explicit_overnight_handoff','receipt_sha256':hashlib.sha256(content).hexdigest(),'receipt':receipt,'original_controller_consumption':'unobserved','shutdown_deferred_until':module['read'](folder/'lease.json')['deadline'],'new_receipts_created':0}
module['exclusive'](folder/'g3-receipt-consumption.json',result)
module['log'](folder,'real_g3_receipt_validated_by_overnight_handoff',receipt_sha256=result['receipt_sha256'])
print(json.dumps(result))
'''
            consumed=remote_python(client,code)
            dump_new(cfg['operations']/'overnight-receipt-consumption.json',consumed)
            emit('real_receipt_consumed_by_overnight_handoff',**consumed)
            return {'status':'g3_collected_shutdown_deferred_by_explicit_new_lease','receipt_transfer':result,
                    'provider_billing_stopped':False,'power_deadline':DEADLINE}
        time.sleep(min(10,budget.remaining()))
    raise TimeoutError('original G3 collection deadline reached; never reset it')


def main(config_file,original_downloads):
    assert_no_collector()
    cfg,preflight=local_preflight(config_file)
    if cfg['remote_run']!=RUN or cfg['execution_commit']!=COMMIT:
        raise ValueError('only the inspected original G3 window can be recovered')
    budget=TimeBudget(aware(ORIGINAL_HARD));budget.check()
    for key in ('downloads','restored','operations'):
        cfg[key].mkdir(parents=True,exist_ok=False)
    emit=lambda event,**fields:event_file(cfg['operations']/'events.jsonl',event,**fields)
    dump_new(cfg['operations']/'config.json',read(config_file))
    dump_new(cfg['operations']/'offline-preflight.json',preflight)
    dump_new(cfg['operations']/'monitor.lock',{'pid':os.getpid(),'recovery_only':True})
    emit('inspected_recovery_started',old_collector_absent=True,old_session_id=8131,training_relaunched=False)
    import paramiko
    client=paramiko.SSHClient();client.load_host_keys(str(cfg['known_hosts']))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    password=getpass.getpass('G3 recovery / authorized overnight lease password (not stored): ')
    timer=threading.Timer(budget.remaining(),client.close);timer.daemon=True;timer.start()
    try:
        client.connect(cfg['ssh_host'],port=cfg['ssh_port'],username=cfg['ssh_user'],password=password,
                       look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15,banner_timeout=15)
        password=None
        with client.open_sftp() as sftp:
            install_lease(client,sftp,emit,cfg['operations'])
            plan=read(ROOT/'reports/g3-execution-v1.json')
            result=collect(client,sftp,cfg,plan,budget,emit,original_downloads)
            emit('monitor_finished',result=result)
    except BaseException as error:
        emit('monitor_stopped',error_type=type(error).__name__,no_automatic_reconnect=True,
             new_lease_may_be_armed=True,training_relaunched=False)
        raise
    finally:
        password=None;client.close();timer.cancel()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--config',required=True,type=Path)
    p.add_argument('--original-downloads',required=True,type=Path)
    a=p.parse_args()
    main(a.config,a.original_downloads)
