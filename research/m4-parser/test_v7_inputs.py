import copy, json, tempfile, unittest
from pathlib import Path
from train.audit_v7_inputs import audit

class Tokenizer:
    def apply_chat_template(self, messages, **kwargs): return json.dumps(messages)
    def __call__(self, text, **kwargs): return {"input_ids": self.encode(text)}
    def encode(self, text, **kwargs): return list(text.encode())

class InputAuditTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name)
        self.systems = {"controlSystem": "control", "alignedSystem": "aligned enum"}
        self.row = {"id": "synthetic", "messages": [{"role": "system", "content": "control"},
            {"role": "user", "content": json.dumps({"exercises": ["A", "B"], "sentence": "fixture"})},
            {"role": "assistant", "content": '{"intent":"end"}'}]}
        for name in ("T-train", "S-train", "dev-control", "dev"):
            row = copy.deepcopy(self.row)
            if name in ("S-train", "dev"): row["messages"][0]["content"] = "aligned enum"
            self.save(name, [row])
    def save(self, name, rows):
        (self.root/(name+'.jsonl')).write_text(''.join(json.dumps(r)+'\n' for r in rows))
    def test_only_system_changes_and_answer_mask_is_audited(self):
        r = audit(self.root, Tokenizer(), self.systems)
        self.assertEqual(r['T-train']['answerTokens'], r['S-train']['answerTokens'])
        self.assertNotEqual(r['T-train']['maskSha256'], r['S-train']['maskSha256'])
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
                self.save('S-train', [row, row] if mode == 'duplicate' else [row])
                with self.assertRaises(ValueError): audit(self.root, Tokenizer(), self.systems)
    def test_truncation_and_token_path_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, 'truncate'): audit(self.root, Tokenizer(), self.systems, 3)
        class Broken(Tokenizer):
            def __call__(self, text, **kwargs): return {"input_ids": [9]}
        with self.assertRaisesRegex(ValueError, 'token IDs'): audit(self.root, Broken(), self.systems)

if __name__ == '__main__': unittest.main()
