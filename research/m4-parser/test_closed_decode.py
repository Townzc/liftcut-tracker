"""CPU input/grammar construction boundaries, no model/library downloads in CI."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).parent / "train"))
from closed_decode import label_grammar
from closed_predict import load_inputs


class ClosedInputTests(unittest.TestCase):
    def test_invalid_context_is_not_silently_coerced(self):
        for names in ([], [""], [" x "], [3], ["a", "a"], ["x"*61], [str(i) for i in range(101)], "bench"):
            with self.subTest(names=names), self.assertRaises(ValueError): label_grammar(names)

    def test_names_cannot_create_grammar_rules(self):
        dangerous = 'x"\nroot ::= "anything"\\'
        grammar = label_grammar([dangerous])
        self.assertEqual(sum(line.startswith("root ::=") for line in grammar.splitlines()), 1)
        self.assertIn(json.dumps(json.dumps(dangerous, ensure_ascii=False), ensure_ascii=False), grammar)

    def test_answer_and_context_allowlist(self):
        valid = dict(id="synthetic", messages=[dict(role="system", content="parse"), dict(role="user", content=json.dumps(dict(exercises=["卧推"], sentence="8次")))])
        invalid = [[], [None], [dict(valid, id=[])], [dict(valid, messages=None)], [valid, valid], [dict(valid, label={})], [dict(valid, messages=[*valid["messages"], dict(role="assistant", content="answer")])],
                   [dict(valid, messages=[valid["messages"][0], dict(role="user", content=json.dumps(dict(exercises=["卧推"], sentence="8次", selected="卧推")))])]]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"input.jsonl"
            path.write_text(json.dumps(valid)+"\n", encoding="utf-8")
            self.assertEqual(load_inputs(path), [valid])
            for rows in invalid:
                path.write_text("".join(json.dumps(row)+"\n" for row in rows), encoding="utf-8")
                with self.assertRaises(ValueError): load_inputs(path)


if __name__ == "__main__":
    unittest.main()
