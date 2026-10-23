"""Contract provenance and the real runner's dispatch branches; no model calls."""
import copy, hashlib, io, json, os, sys, tarfile, time, unittest
from types import SimpleNamespace
from unittest.mock import patch
import run_v8 as runner
from run_v8_control import assemble_inputs
import test_v7_runner as fixtures


class RunnerTest(fixtures.RunnerTest):
    # Reuse only fixture setup, not inherited v7 behavioral tests.
    test_control_hashes_tokens_ids_and_training_are_required_before_copy = None
    test_protocol_keeps_gates_inputs_training_and_frozen_sources = None
    test_one_training_three_streams_and_no_retry_after_deadline_or_low_space = None

    def setUp(self):
        super().setUp()
        self.manifests['v8'] = copy.deepcopy(self.manifests['v7'])
        (self.data/'v8').mkdir()
        for name in self.manifests['v8']['files']:
            (self.data/'v8'/name).write_bytes((self.data/'v7'/name).read_bytes())
        runner.write_json(self.m4/'data/v8-manifest.json',self.manifests['v8'])
        self.protocol.update(candidate='D',maximumModelPredictions=5200,hfModelPredictions=3120,cachedPredictions=1040,
            requiredFreeDiskGiB=6,requiredStagedWeightBackup=True,storagePlanningBytes={'fixture':1},
            newHFOrder=list(runner.HF),conditionalQuantOrder=list(runner.QUANT),
            promptContract={'enumSystem':'fixture enum','contractSystem':'fixture contract'})
        source=self.root/'input-source';source.mkdir()
        assemble_inputs(self.data,self.manifests,source,self.protocol['promptContract'])
        self.protocol['inputs']={n:{'sha256':runner.digest(source/f'all-eval-{n}.jsonl'),
            'tokenIdsSha256':n+'-tokens'} for n in ('enum','contract')}
        self.jsonl(self.baseline/'S-HF.jsonl',self.predictions())
        audit=self.audit('S-HF');audit.update(inputSha256=self.protocol['inputs']['enum']['sha256'])
        runner.write_json(self.baseline/'S-HF.jsonl.audit.json',audit)
        (self.baseline/'S/model').mkdir(parents=True)
        runner.write_json(self.baseline/'S/model/train_metrics.json',{'steps':800})
        runner.write_json(self.baseline/'run.json',{'commit':'archived','steps':[{'name':n,'exit':0} for n in ('train-S','S-HF')]})
        self.protocol['baselineFiles']={p.relative_to(self.baseline).as_posix():runner.digest(p) for p in self.baseline.rglob('*') if p.is_file()}
        self.protocol['dataManifestCanonicalSha256']['v8']=runner.manifest_digest(self.m4/'data/v8-manifest.json')
        runner.write_json(self.m4/'train/protocol-v8.json',self.protocol)

    def test_cached_model_input_and_training_tampering_stops_before_control_copy(self):
        for mode in ('hash','ids','tokens','engine','steps','metrics'):
            with self.subTest(mode=mode):
                out=self.root/mode;out.mkdir();p=copy.deepcopy(self.protocol)
                name={'hash':'S-HF.jsonl','ids':'S-HF.jsonl','tokens':'S-HF.jsonl.audit.json','engine':'S-HF.jsonl.audit.json',
                      'steps':'run.json','metrics':'S/model/train_metrics.json'}[mode]
                path=self.baseline/name;original=path.read_bytes()
                if mode=='hash':path.write_bytes(original+b' ')
                elif mode=='ids':self.jsonl(path,[{'id':'wrong'}])
                else:
                    value=runner.load(path)
                    if mode=='tokens':value['tokenIdsSha256']='wrong'
                    elif mode=='engine':value['engine']='gguf'
                    elif mode=='steps':value['steps']=[]
                    else:value['steps']=2
                    runner.write_json(path,value)
                if mode!='hash':p['baselineFiles'][name]=runner.digest(path)
                with self.assertRaises(ValueError):runner.prepare(self.data,self.manifests,out,self.baseline,p)
                self.assertFalse((out/'A.jsonl').exists());path.write_bytes(original)
        self.out.mkdir();runner.prepare(self.data,self.manifests,self.out,self.baseline,self.protocol)
        self.assertEqual((self.out/'A.jsonl').read_bytes(),(self.baseline/'S-HF.jsonl').read_bytes())

    def test_actual_protocol_preserves_gates_training_old_sources_and_no_switch(self):
        actual=runner.load(runner.M4/'train/protocol-v8.json');old=runner.load(runner.M4/'train/protocol-v7.json')
        runner.validate_protocol(actual)
        for key in ('trainingArgs','trainingMetrics','gates','focusGates'):self.assertEqual(actual[key],old[key])
        for key in ('sha256','tokenIdsSha256'):self.assertEqual(actual['inputs']['enum'][key],old['input'][key])
        for name,expected in actual['sourceLfSha256'].items():
            self.assertEqual(hashlib.sha256((runner.ROOT/name).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),expected,name)
        self.assertTrue(old['sourceLfSha256'].items()<=actual['sourceLfSha256'].items())
        for key,value in [('candidate','B'),('trainingRuns',2),('maximumModelPredictions',5201),('newHFOrder',['D','C','B'])]:
            changed={**actual,key:value}
            with self.assertRaises(ValueError):runner.validate_protocol(changed)

    @unittest.skipUnless(os.name=='posix','requires real GNU timeout/Linux')
    def test_one_training_factorial_hf_then_conditional_quantization_and_no_retry(self):
        (self.cache/'base/weights').write_bytes(b'base')
        (self.m4/'train/base-model.sha256').write_text(runner.digest(self.cache/'base/weights')+' weights\n')
        archive=self.cache/'src/llama_cpp_python-0.3.36.tar.gz'
        with tarfile.open(archive,'w:gz') as tar:
            info=tarfile.TarInfo('llama_cpp_python-0.3.36/vendor/llama.cpp/fixture');info.size=1;tar.addfile(info,io.BytesIO(b'x'))
        (self.m4/'train/llama-cpp-python.sha256').write_text(runner.digest(archive))
        self.protocol['evaluationItems']=1040;runner.write_json(self.m4/'train/protocol-v8.json',self.protocol)
        for mode in ('semantic-rejected','quantization-rejected','development-passed-not-release','timeout','space'):
            out=self.root/mode;calls=[]
            def step(instance,name,args,allowed=(0,)):
                calls.append((name,list(map(str,args))))
                if mode=='timeout' and name=='C':raise TimeoutError('original deadline')
            argv=['v8','--cache',str(self.cache),'--out',str(out),'--baseline',str(self.baseline),'--commit','reviewed','--stop-at',str(time.time()+60)]
            with patch.object(runner,'ROOT',self.repo),patch.object(runner,'M4',self.m4),patch.object(sys,'argv',argv),\
                 patch.object(runner.Budget,'step',step),patch.object(runner,'prepare'),patch.object(runner,'partition'),\
                 patch.object(runner,'assess_hf',return_value={'hfGatePassed':mode!='semantic-rejected','developmentGatePassed':False}),\
                 patch.object(runner,'assess_quant',return_value={'developmentGatePassed':mode=='development-passed-not-release'}),\
                 patch.object(runner.subprocess,'check_output',side_effect=lambda a,**kw:b'' if 'status' in a else 'reviewed\n'),\
                 patch.object(runner.shutil,'disk_usage',return_value=SimpleNamespace(free=1 if mode=='space' else 100*1024**3)):
                if mode in ('timeout','space'):
                    with self.assertRaises((TimeoutError,ValueError)):runner.main()
                else:self.assertEqual(runner.main(),0 if mode=='development-passed-not-release' else 3)
            names=[n for n,_ in calls]
            self.assertEqual(runner.load(out/'run.json')['state'],'stopped' if mode in ('timeout','space') else mode)
            self.assertTrue((out/'sha256.json').exists())
            if mode=='space':self.assertEqual(names,[]);continue
            self.assertEqual([n for n in names if n.startswith('train-')],['train-D'])
            train=next(a for n,a in calls if n=='train-D');self.assertTrue(train[train.index('--train')+1].endswith('v8/D-train.jsonl'))
            if mode=='timeout':self.assertNotIn('D',names)
            elif mode=='semantic-rejected':
                self.assertNotIn('export-D',names);self.assertFalse((out/'src').exists())
                self.assertEqual([n for n in names if n in runner.HF],list(runner.HF))
            else:
                self.assertEqual([n for n in names if n in (*runner.HF,*runner.QUANT)],[*runner.HF,*runner.QUANT])
                self.assertGreater(names.index('export-D'),names.index('hf-summary'))
            if mode in ('timeout','semantic-rejected'):self.assertNotIn('D-Q8',names)

if __name__=='__main__':unittest.main()
