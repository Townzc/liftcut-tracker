"""Pinned historical inputs and exactly one bounded candidate dispatch; no model calls."""
import copy, hashlib, io, json, os, sys, tarfile, time, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import run_v7 as runner
import test_v6_runner as fixtures

class RunnerTest(unittest.TestCase):
    jsonl = fixtures.V6RunnerTest.jsonl
    predictions = fixtures.V6RunnerTest.predictions
    audit = fixtures.V6RunnerTest.audit
    summary = staticmethod(fixtures.V6RunnerTest.summary)
    def setUp(self):
        fixtures.V6RunnerTest.setUp(self)
        self.manifests['v7'] = copy.deepcopy(self.manifests['v6'])
        (self.data/'v7').mkdir()
        for name in self.manifests['v7']['files']:
            (self.data/'v7'/name).write_bytes((self.data/'v6'/name).read_bytes())
        runner.write_json(self.m4/'data/v7-manifest.json',self.manifests['v7'])
        for arm in ('H','T'):
            self.jsonl(self.baseline/(arm+'.jsonl'),self.predictions())
            runner.write_json(self.baseline/(arm+'.jsonl.audit.json'),self.audit(arm))
        (self.baseline/'T/model').mkdir(parents=True)
        runner.write_json(self.baseline/'T/model/train_metrics.json',{'steps':800})
        runner.write_json(self.baseline/'run.json',{'commit':'archived','steps':[{'name':n,'exit':0} for n in ('train-T','T')]})
        self.protocol.update(trainingRuns=1, maximumModelPredictions=9, newStreamOrder=list(runner.NEW),requiredFreeDiskGiB=10)
        self.protocol['dataManifestCanonicalSha256']['v7']=runner.manifest_digest(self.m4/'data/v7-manifest.json')
        self.protocol['baselineFiles']={p.relative_to(self.baseline).as_posix():runner.digest(p) for p in self.baseline.rglob('*') if p.is_file()}
        runner.write_json(self.m4/'train/protocol-v7.json',self.protocol)

    def test_control_hashes_tokens_ids_and_training_are_required_before_copy(self):
        for mode in ('hash','ids','tokens','steps','metrics'):
            with self.subTest(mode=mode):
                out=self.root/mode;out.mkdir(); protocol=copy.deepcopy(self.protocol)
                name={'hash':'T.jsonl','ids':'T.jsonl','tokens':'T.jsonl.audit.json','steps':'run.json','metrics':'T/model/train_metrics.json'}[mode]
                p=self.baseline/name; original=p.read_bytes()
                if mode=='hash':p.write_bytes(original+b' ')
                elif mode=='ids':self.jsonl(p,[{'id':'wrong'}])
                else:
                    value=runner.load(p)
                    if mode=='tokens':value['tokenIdsSha256']='wrong'
                    elif mode=='steps':value['steps']=[]
                    else:value['steps']=2
                    runner.write_json(p,value)
                if mode!='hash':protocol['baselineFiles'][name]=runner.digest(p)
                with self.assertRaises(ValueError):runner.prepare(self.data,self.manifests,out,self.baseline,protocol)
                self.assertFalse((out/'T.jsonl').exists());p.write_bytes(original)
        self.out.mkdir();runner.prepare(self.data,self.manifests,self.out,self.baseline,self.protocol)
        self.assertEqual((self.out/'T.jsonl').read_bytes(),(self.baseline/'T.jsonl').read_bytes())
        self.assertTrue(runner.load(self.out/'cached-control-verification.json')['verified'])

    def test_protocol_keeps_gates_inputs_training_and_frozen_sources(self):
        actual=runner.load(runner.M4/'train/protocol-v7.json');old=runner.load(runner.M4/'train/protocol-v6.json')
        for key in ('trainingArgs','trainingMetrics','gates','focusGates','input'):
            self.assertEqual(actual[key],old[key],key)
        self.assertEqual((actual['trainingRuns'],actual['maximumModelPredictions'],actual['cachedPredictions']),(1,3120,2080))
        self.assertEqual(actual['requiredFreeDiskGiB'],10)
        self.assertLessEqual(sum(actual['storagePlanningBytes'].values()),10*1024**3)
        manifest=json.loads((runner.M4/'data/v7-manifest.json').read_text(encoding='utf8'))
        self.assertEqual(actual['dataManifestCanonicalSha256']['v7'],hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest())
        self.assertEqual(actual['promptContract'],{k:manifest[k] for k in ('controlSystem','alignedSystem')})
        cpu=json.loads((runner.M4/'results/prompt-v7-20261022/cpu-smoke.json').read_text(encoding='utf8'))
        self.assertEqual(actual['trainingInputAudit'],cpu['trainingInputAudit'])
        self.assertIs(runner.assess, fixtures.runner.assess)
        for name,expected in actual['sourceLfSha256'].items():
            self.assertEqual(hashlib.sha256((runner.ROOT/name).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),expected,name)
        self.assertFalse(actual['releaseReady'])

    @unittest.skipUnless(os.name=='posix','requires real GNU timeout/Linux')
    def test_one_training_three_streams_and_no_retry_after_deadline_or_low_space(self):
        (self.cache/'base/weights').write_bytes(b'base')
        (self.m4/'train/base-model.sha256').write_text(runner.digest(self.cache/'base/weights')+' weights\n')
        archive=self.cache/'src/llama_cpp_python-0.3.36.tar.gz'
        with tarfile.open(archive,'w:gz') as tar:
            info=tarfile.TarInfo('llama_cpp_python-0.3.36/vendor/llama.cpp/fixture');info.size=1;tar.addfile(info,io.BytesIO(b'x'))
        (self.m4/'train/llama-cpp-python.sha256').write_text(runner.digest(archive))
        calls=[]
        def step(instance,name,args,allowed=(0,)):
            args=list(map(str,args));calls.append((name,args))
        argv=['v7','--cache',str(self.cache),'--out',str(self.out),'--baseline',str(self.baseline),'--commit','reviewed','--stop-at',str(time.time()+60)]
        with patch.object(runner,'ROOT',self.repo),patch.object(runner,'M4',self.m4),patch.object(sys,'argv',argv),\
             patch.object(runner.Budget,'step',step),patch.object(runner,'partition'),\
             patch.object(runner,'assess',return_value={'developmentGatePassed':False,'releaseReady':False}),\
             patch.object(runner.subprocess,'check_output',side_effect=lambda a,**kw:b'' if 'status' in a else 'reviewed\n'),\
             patch.object(runner.shutil,'disk_usage',return_value=SimpleNamespace(free=100*1024**3)):
            self.assertEqual(runner.main(),3)
            trains=[(n,a) for n,a in calls if n.startswith('train-')]
            self.assertEqual([n for n,_ in trains],['train-S'])
            self.assertTrue(trains[0][1][trains[0][1].index('--train')+1].endswith('v7/S-train.jsonl'))
            self.assertTrue(trains[0][1][1].endswith('train/sft.py'))
            self.assertEqual([n for n,_ in calls if n in runner.NEW],list(runner.NEW))
            for mode in ('deadline','space'):
                out=self.root/mode;args=list(argv);args[args.index('--out')+1]=str(out);seen=[]
                def stop(instance,name,args,allowed=(0,)):
                    seen.append(name)
                    if name=='S-F16':raise TimeoutError('original deadline')
                free=100*1024**3 if mode=='deadline' else 10*1024**3-1
                with patch.object(sys,'argv',args),patch.object(runner.Budget,'step',stop),\
                     patch.object(runner.shutil,'disk_usage',return_value=SimpleNamespace(free=free)):
                    with self.assertRaises((TimeoutError,ValueError)):runner.main()
                self.assertEqual(runner.load(out/'run.json')['state'],'stopped')
                self.assertTrue((out/'sha256.json').exists())
                if mode=='space':self.assertEqual(seen,[])
                else:self.assertNotIn('S',seen)

if __name__=='__main__':unittest.main()
