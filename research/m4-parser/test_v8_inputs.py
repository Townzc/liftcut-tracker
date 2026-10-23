import copy, json, tempfile, unittest
from pathlib import Path
from train.audit_v8_inputs import audit, audit_evaluation

class Tokenizer:
    def apply_chat_template(self, messages, **kwargs): return json.dumps(messages)
    def __call__(self, text, **kwargs): return {"input_ids": self.encode(text)}
    def encode(self, text, **kwargs): return list(text.encode())

class InputAuditTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name)
        self.systems = {"enumSystem": "control", "contractSystem": "aligned enum"}
        self.row = {"id": "synthetic", "messages": [{"role": "system", "content": "control"},
            {"role": "user", "content": json.dumps({"exercises": ["A", "B"], "sentence": "fixture"})},
            {"role": "assistant", "content": '{"intent":"end"}'}]}
        for name in ("A-train", "D-train", "A-dev", "D-dev"):
            row = copy.deepcopy(self.row)
            if name in ("D-train", "D-dev"): row["messages"][0]["content"] = "aligned enum"
            self.save(name, [row])
    def save(self, name, rows):
        (self.root/(name+'.jsonl')).write_text(''.join(json.dumps(r)+'\n' for r in rows))
    def test_only_system_changes_and_answer_mask_is_audited(self):
        r = audit(self.root, Tokenizer(), self.systems)
        self.assertEqual(r['A-train']['answerTokens'], r['D-train']['answerTokens'])
        self.assertNotEqual(r['A-train']['maskSha256'], r['D-train']['maskSha256'])
    def test_changes_outside_system_and_leaking_fields_rejected(self):
        for mode in ('catalog', 'sentence', 'target', 'system', 'role', 'id', 'history', 'duplicate'):
            with self.subTest(mode=mode):
                row = copy.deepcopy(self.row); row['messages'][0]['content'] = 'aligned enum'
                if mode == 'target': row['messages'][2]['content'] = '{}'
                elif mode == 'system': row['messages'][0]['content'] = 'unreviewed'
                elif mode == 'role': row['messages'][1]['role'] = 'assistant'
                elif mode == 'id': row['id'] = 'different'
                elif mode in ('catalog', 'sentence', 'history'):
                    u = json.loads(row['messages'][1]['content'])
                    u[{'catalog':'exercises', 'sentence':'sentence', 'history':'history'}[mode]] = 'changed'
                    row['messages'][1]['content'] = json.dumps(u)
                self.save('D-train', [row, row] if mode == 'duplicate' else [row])
                with self.assertRaises(ValueError): audit(self.root, Tokenizer(), self.systems)
    def test_truncation_and_token_path_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, 'truncate'): audit(self.root, Tokenizer(), self.systems, 3)
        class Broken(Tokenizer):
            def __call__(self, text, **kwargs): return {"input_ids": [9]}
        with self.assertRaisesRegex(ValueError, 'token IDs'): audit(self.root, Broken(), self.systems)

    def test_inference_inputs_exclude_answers_and_match_payloads(self):
        paths={n:self.root/(n+'.jsonl') for n in ('enum','contract')}
        for n,system in [('enum','control'),('contract','aligned enum')]:
            row=copy.deepcopy(self.row);row['messages']=row['messages'][:2];row['messages'][0]['content']=system
            paths[n].write_text(json.dumps(row)+'\n')
        systems={'enum':'control','contract':'aligned enum'}
        actual=audit_evaluation(paths,Tokenizer(),systems)
        self.assertNotEqual(actual['enum']['tokenIdsSha256'],actual['contract']['tokenIdsSha256'])
        for mode in ('answer','history','sentence','id','system','too-long'):
            row=copy.deepcopy(self.row);row['messages']=row['messages'][:2];row['messages'][0]['content']='aligned enum'
            if mode=='answer':row['messages'].append({'role':'assistant','content':'{}'})
            elif mode=='history':row['answer']='{}'
            elif mode=='id':row['id']='other'
            elif mode=='system':row['messages'][0]['content']='wrong'
            elif mode=='too-long':row['messages'][1]['content']=json.dumps({'exercises':['A'],'sentence':'z'*2000})
            else:row['messages'][1]['content']=json.dumps({'exercises':['A'],'sentence':'changed'})
            paths['contract'].write_text(json.dumps(row)+'\n')
            with self.subTest(mode=mode),self.assertRaises(ValueError):audit_evaluation(paths,Tokenizer(),systems)

if __name__=='__main__':unittest.main()
