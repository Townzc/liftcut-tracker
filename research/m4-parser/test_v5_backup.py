"""CPU backup fault tests using byte fixtures, never real model weights."""
import hashlib,io,json,shutil,tarfile,unittest,uuid
from pathlib import Path
from train import backup_v5 as backup
backup.configure('m4-v5-20000101T000000Z','a'*40,12345)

class BackupTest(unittest.TestCase):
    def fixture(self, complete=False, external=False, omit=None):
        root=Path(__file__).parent/'data/generated/v5-backup-fixtures'/str(uuid.uuid4());root.mkdir(parents=True)
        state=json.dumps({'state':'below-threshold' if complete else 'stopped','commit':backup.COMMIT,'stopAt':backup.STOP}).encode()
        files={'run/run.json':state}
        if complete:
            for name in backup.WEIGHTS:files[name]=name.encode()
            for arm in backup.STREAMS:
                files['run/'+arm+'.jsonl']=''.join(json.dumps({'id':str(i)})+'\n' for i in range(1040)).encode()
        if omit:files.pop(omit)
        manifest={name[4:]:hashlib.sha256(value).hexdigest() for name,value in files.items()}
        files['run/sha256.json']=json.dumps(manifest).encode()
        staged={}
        if external:
            for i,name in enumerate(backup.WEIGHTS):
                staged[name]=f'staged-{i}.bin';(root/staged[name]).write_bytes(files[name])
        part=root/'archive.part-0000'
        with tarfile.open(part,'w') as tar:
            for name,data in files.items():
                if name in staged:continue
                info=tarfile.TarInfo(name);info.size=len(data);tar.addfile(info,io.BytesIO(data))
        report={'windowId':backup.WINDOW,'commit':backup.COMMIT,'archiveSha256':backup.sha(part),
            'runManifestSha256':hashlib.sha256(files['run/sha256.json']).hexdigest(),
            'files':{n:{'sha256':hashlib.sha256(d).hexdigest(),'bytes':len(d)} for n,d in files.items()},
            'externalFiles':staged,'parts':[{'name':part.name,'bytes':part.stat().st_size,'sha256':backup.sha(part)}]}
        (root/'manifest.json').write_text(json.dumps(report))
        return root

    def test_complete_eight_staged_weights_and_five_streams(self):
        root=self.fixture(True,True);receipt=backup.restore(root,backup.sha(root/'manifest.json'))
        self.assertTrue(receipt['verified']);self.assertEqual(receipt['predictionRows'],{s:1040 for s in backup.STREAMS})
        for name in backup.WEIGHTS:self.assertTrue((root/'restored'/name).is_file())

    def test_partial_preserves_partial_state(self):
        root=self.fixture();self.assertEqual(backup.restore(root,backup.sha(root/'manifest.json'))['state'],'stopped')

    def test_corrupted_part_and_staged_weight_rejected(self):
        for mode in ('part','weight'):
            root=self.fixture(True,True)
            target=root/('archive.part-0000' if mode=='part' else 'staged-7.bin')
            target.write_bytes(b'changed')
            with self.assertRaises(AssertionError):backup.restore(root,backup.sha(root/'manifest.json'))

    def test_completed_run_cannot_omit_a_weight_or_a_stream(self):
        for missing in (backup.WEIGHTS[-1],'run/S-F16.jsonl'):
            root=self.fixture(True,False,missing)
            with self.assertRaises(AssertionError):backup.restore(root,backup.sha(root/'manifest.json'))

    def test_wrong_window_and_deadline_rejected(self):
        root=self.fixture();path=root/'manifest.json';value=json.loads(path.read_text());value['windowId']='wrong';path.write_text(json.dumps(value))
        with self.assertRaises(AssertionError):backup.restore(root,backup.sha(path))
        root=self.fixture();backup.STOP+=1
        try:
            with self.assertRaises(AssertionError):backup.restore(root,backup.sha(root/'manifest.json'))
        finally:backup.STOP-=1

    def test_path_traversal_and_symlink_tar_members_rejected(self):
        for name,link in [('../escape',False),('run/link',True)]:
            root=self.fixture();part=root/'archive.part-0000';path=root/'manifest.json';report=json.loads(path.read_text())
            with tarfile.open(part,'a') as tar:
                info=tarfile.TarInfo(name)
                if link:info.type=tarfile.SYMTYPE;info.linkname='/tmp/outside'
                else:info.size=1
                tar.addfile(info,None if link else io.BytesIO(b'x'))
            report['parts'][0].update(bytes=part.stat().st_size,sha256=backup.sha(part));report['archiveSha256']=backup.sha(part)
            path.write_text(json.dumps(report))
            with self.assertRaises((ValueError,AssertionError)):backup.restore(root,backup.sha(path))

    def test_fresh_binding_required(self):
        with self.assertRaises(ValueError):backup.configure('UNBOUND','a'*40,12345)
        with self.assertRaises(ValueError):backup.configure('m4-v5-20000101T000000Z','old',12345)

    @unittest.skipUnless(shutil.which('tar'), 'pack requires tar')
    def test_actual_pack_and_restore_both_weight_sets(self):
        seed=self.fixture(True,True)
        backup.restore(seed,backup.sha(seed/'manifest.json'))
        remote=seed/'remote';remote.mkdir()
        shutil.copytree(seed/'restored/run',remote/'run')
        for name in ['window.json','launch.json','exit.json','driver.py','driver.log','source.bundle',
                     'backup_v5.py','observe.py','resources.jsonl','observer.log','status.py']:
            (remote/name).write_bytes(b'fixture')
        staged={name:f'weight-{i}.bin' for i,name in enumerate(backup.WEIGHTS)}
        staging=seed/'staged.json';staging.write_text(json.dumps(staged))
        backup.pack(remote,staging)
        received=seed/'received';shutil.copytree(remote/'backup',received)
        for name,local in staged.items():shutil.copyfile(remote/name,received/local)
        receipt=backup.restore(received,backup.sha(received/'manifest.json'))
        self.assertTrue(receipt['verified'])
        self.assertEqual(receipt['predictionRows'],{s:1040 for s in backup.STREAMS})
        for name in backup.WEIGHTS:
            self.assertEqual(backup.sha(remote/name),backup.sha(received/'restored'/name))

if __name__=='__main__':unittest.main()
