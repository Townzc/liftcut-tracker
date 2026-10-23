"""Perfect structure, safety or agreement cannot conceal lost semantics/usefulness."""
import copy,json,tempfile,unittest
from pathlib import Path
from run_v2 import write_json
from run_v4 import FOCUS_GATES
from train.acceptance_v2 import GATES
from v8_acceptance import assess_hf,assess_quant

class AcceptanceTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.protocol={'evaluationItems':3,'inputs':{n:{'sha256':n,'tokenIdsSha256':n+'-tokens'} for n in ('enum','contract')},
            'trainingInputAudit':{},'trainingMetrics':{'steps':800},'gates':GATES,'focusGates':FOCUS_GATES}
        self.rows=[{'id':str(i),'output':'{}','finishReason':'stop'} for i in range(3)]
        for n in ('enum','contract'):self.save_lines('all-eval-'+n+'.jsonl',[{'id':r['id']} for r in self.rows])
        for arm in ('A','B','C','D','D-F16','D-Q8'):
            self.save_lines(arm+'.jsonl',self.rows);variant='enum' if arm in ('A','C') else 'contract';hf=arm not in ('D-F16','D-Q8')
            self.save(arm+'.jsonl.audit.json',{'inputSha256':variant,'tokenIdsSha256':variant+'-tokens','items':3,
                'greedy':True,'repetitionPenalty':1,'maxNewTokens':256,'engine':'hf' if hf else 'gguf',
                'threads':None if hf else 4,'prefillThreads':None if hf else 4,'resetBetweenItems':not hf})
        self.save('input-audit.json',{'training':{},'inputs':self.protocol['inputs']})
        self.save('D/model/train_metrics.json',{'steps':800})
        for split in ('dev-eval','challenge','handwritten'):
            self.save_lines(split+'.gold.jsonl',[{'id':split,'label':{'intent':'record'}}])
            for arm in ('D','D-Q8'):self.save(f'ground-{arm}-{split}.json',{'accepted':1,'unsafeAccepted':0,'guarded':{'total':1,'invented':0}})
        for arm in ('D','D-Q8'):self.save(f'metrics-{arm}-challenge.json',{'total':240,'exactRate':1,'schemaValidRate':1,'invented':0})
        self.focus={'focus':{n:{'negativeTotal':15,'correctReason':15,'positiveTotal':15,'positiveExact':15}
            for n in ('missing_unit','rpe_scope','unknown_exercise')},'challengePositive':{'total':120,'exact':120},'invalidClarificationReasons':0}
        self.save('hf-summary.json',{'arms':{'D':self.focus}});self.save('quant-summary.json',{'arms':{'D-Q8':self.focus}})
        for arm in ('D','D-F16'):self.save('agreement-'+arm+'.json',{'items':3,'missing':0,'sameParsed':3})
    def save(self,name,value):
        path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);write_json(path,value)
    def save_lines(self,name,rows):
        (self.root/name).write_text(''.join(json.dumps(r)+'\n' for r in rows))
    def test_semantic_rejection_marks_quantization_unmeasured_and_cannot_be_bypassed(self):
        for reason in self.focus['focus']:
            f=copy.deepcopy(self.focus);f['focus'][reason]['correctReason']=13;self.save('hf-summary.json',{'arms':{'D':f}})
            result=assess_hf(self.root,self.protocol)
            self.assertFalse(result['hfGatePassed']);self.assertEqual(result['quantization'],'not-run-semantic-rejection')
            self.assertIsNone(result['rawAgreement']);self.save('hf-acceptance.json',result)
            with self.assertRaisesRegex(ValueError,'bypass'):assess_quant(self.root,self.protocol)
    def test_perfect_safety_with_blanket_refusal_still_fails_usefulness(self):
        self.save('ground-D-challenge.json',{'accepted':0,'unsafeAccepted':0,'guarded':{'total':1,'invented':0}})
        f=copy.deepcopy(self.focus);f['challengePositive']['exact']=0;self.save('hf-summary.json',{'arms':{'D':f}})
        r=assess_hf(self.root,self.protocol)
        self.assertTrue(r['checks']['guardedSafety']);self.assertFalse(r['checks']['challengeCoverage'])
        self.assertFalse(r['checks']['challengePositiveUseful']);self.assertFalse(r['hfGatePassed'])
    def test_input_drift_in_a_control_invalidates_factorial_even_when_candidate_passes(self):
        p=self.root/'B.jsonl.audit.json';v=json.loads(p.read_text());v['tokenIdsSha256']='wrong';self.save(p.name,v)
        r=assess_hf(self.root,self.protocol);self.assertTrue(r['checks']['challengeExact'])
        self.assertFalse(r['checks']['allFactorialInputs']);self.assertFalse(r['hfGatePassed'])
    def test_quantization_agreement_does_not_override_new_semantic_error(self):
        self.save('hf-acceptance.json',assess_hf(self.root,self.protocol))
        self.save('metrics-D-Q8-challenge.json',{'total':240,'exactRate':1,'schemaValidRate':1,'invented':1})
        r=assess_quant(self.root,self.protocol);self.assertTrue(r['checks']['rawAgreement'])
        self.assertFalse(r['developmentGatePassed']);self.assertFalse(r['releaseReady'])
    def test_f16_truncation_and_quantizer_input_drift_reject(self):
        self.save('hf-acceptance.json',assess_hf(self.root,self.protocol))
        rows=copy.deepcopy(self.rows);rows[0]['finishReason']='length';self.save_lines('D-F16.jsonl',rows)
        self.assertFalse(assess_quant(self.root,self.protocol)['checks']['noTruncation'])
        p=self.root/'D-F16.jsonl.audit.json';v=json.loads(p.read_text());v['inputSha256']='wrong';self.save(p.name,v)
        self.assertFalse(assess_quant(self.root,self.protocol)['checks']['sameInputs'])
    def test_development_pass_never_grants_native_release(self):
        hf=assess_hf(self.root,self.protocol);self.assertTrue(hf['hfGatePassed']);self.assertFalse(hf['developmentGatePassed'])
        self.save('hf-acceptance.json',hf);result=assess_quant(self.root,self.protocol)
        self.assertTrue(result['developmentGatePassed']);self.assertFalse(result['releaseReady'])
        self.assertIn('physical-device acceptance',result['pending'])

if __name__=='__main__':unittest.main()
