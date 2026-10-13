"""Actual I3 delta recovery; refusing a missing/corrupt original I2 weight dependency."""
import argparse
from pathlib import Path
from audit_i3 import audit
from d2_execution import read
from i3_receipt import validate_index,fields
from restore_recovery import restore
from server_workspace import dump_new


def assemble(archives,output,d2,tokenizer,parent,receipt,index_path,*,allow_partial=False,scripted=False,plan=None):
    if output.exists():raise ValueError('new I3 recovery directory required')
    index=read(archives/'backup-index.json');validate_index(index,index['binding'],scripted=scripted)
    if index['status']!='complete' and not allow_partial:raise ValueError('explicit partial recovery required')
    item=index['archives'][0];path=archives/item['path']
    if path.stat().st_size!=item['bytes']:raise ValueError('I3 archive size differs')
    recovered=restore(path,output/'parts',item['sha256']);run=output/'parts/evidence'
    if Path(recovered['run_directory']).resolve()!=run.resolve():raise ValueError('I3 archive root differs')
    status=read(run/'window-status.json')
    if status['binding']!=index['binding'] or status['status']!=index['status']:raise ValueError('I3 restored status differs')
    if index['status']=='complete':
        result=audit(run,d2,tokenizer,parent,receipt,index_path,scripted=scripted,plan=plan)
        if not result['actual_external_weight_verified'] or result!=read(run/'comparison.json'):
            raise ValueError('I3 actual parent weight or trace reconstruction differs')
        dump_new(output/'independent-audit.json',result)
    actual={**fields(index,index['binding'],scripted=scripted),'verified_files':recovered['verified_files']}
    dump_new(output/'restore-receipt.json',recovered)
    dump_new(output/'off-instance-backup.json',actual)
    return actual


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('archive-dir','output-dir','d2-dir','tokenizer-dir','parent-run','parent-receipt','parent-index'):
        p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--allow-partial',action='store_true');a=p.parse_args()
    print(assemble(a.archive_dir,a.output_dir,a.d2_dir,a.tokenizer_dir,a.parent_run,a.parent_receipt,a.parent_index,allow_partial=a.allow_partial))
