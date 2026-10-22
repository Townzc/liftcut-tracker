import copy, json, tempfile, unittest
from pathlib import Path
from train.audit_v6_inputs import audit

class Tokenizer:
    def apply_chat_template(self, messages, **kwargs): return json.dumps(messages)
    def __call__(self, text, **kwargs): return {"input_ids": list(text.encode())}

class InputAuditTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name)
        self.row = {"id": "synthetic", "messages": [{"role": "system", "content": "fixture"},
            {"role": "user", "content": json.dumps({"exercises": ["A", "B"], "sentence": "fixture"})},
            {"role": "assistant", "content": '{"intent":"end"}'}]}
        for name in ("T-train", "S-train", "dev"): self.save(name, [self.row])
    def save(self, name, rows): (self.root/(name+'.jsonl')).write_text(''.join(json.dumps(r)+'\n' for r in rows))
    def test_catalog_order_is_the_only_allowed_pair_difference(self):
        row = copy.deepcopy(self.row); row['messages'][1]['content'] = json.dumps({'exercises':['B','A'],'sentence':'fixture'})
        self.save('S-train',[row]); result = audit(self.root,Tokenizer())
        self.assertEqual(result['T-train']['answerTokens'],result['S-train']['answerTokens'])
        self.assertNotEqual(result['T-train']['tokenIdsSha256'],result['S-train']['tokenIdsSha256'])
    def test_pair_and_allowlist_mutations_rejected(self):
        for mode in ('sentence','answer','system','id','selection','history','duplicate'):
            with self.subTest(mode=mode):
                row=copy.deepcopy(self.row)
                if mode=='answer': row['messages'][2]['content']='different'
                elif mode=='system': row['messages'][0]['content']='different'
                elif mode=='id': row['id']='different'
                elif mode=='history': row['messages'].append(row['messages'][-1])
                elif mode in ('sentence','selection'):
                    value=json.loads(row['messages'][1]['content']); value['selected' if mode=='selection' else 'sentence']='different'
                    row['messages'][1]['content']=json.dumps(value)
                self.save('S-train',[row,row] if mode=='duplicate' else [row])
                with self.assertRaises(ValueError): audit(self.root,Tokenizer())
    def test_supervised_tokens_are_never_truncated(self):
        with self.assertRaisesRegex(ValueError,'truncate'): audit(self.root,Tokenizer(),5)

if __name__=='__main__': unittest.main()
