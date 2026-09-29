from copy import deepcopy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from audit_coverage_tokens import audit_calls


class TokenizerContract:
    eos_token_id = 2

    def __init__(self, length=100):
        self.length = length

    def apply_chat_template(self, messages, **kwargs):
        return [1] * self.length

    def decode(self, ids, **kwargs):
        return "".join({1: "a", 2: "<eos>", 3: "b"}[i] for i in ids)


class CoverageGenerationTokenTests(unittest.TestCase):
    def setUp(self):
        self.call = {"request": {"messages": [{"role": "user", "content": "example"}],
                                 "tools": [], "max_completion_tokens": 512}}
        self.generation = {"model_called": True, "output_ids": [1, 2], "raw_text": "a<eos>",
                           "prompt_tokens": 100, "eos_reached": True}

    def test_same_length_different_output_ids_cannot_pass_text_replay(self):
        actual = audit_calls([self.call], [self.generation], TokenizerContract())
        self.assertEqual(actual["completion_tokens"], 2)
        changed = deepcopy(self.generation)
        changed["output_ids"] = [3, 2]
        with self.assertRaisesRegex(ValueError, "do not decode"):
            audit_calls([self.call], [changed], TokenizerContract())

    def test_prompt_count_and_eos_flag_must_be_recomputed(self):
        for update, error in (({"prompt_tokens": 101}, "token budget"), ({"eos_reached": False}, "EOS status")):
            with self.subTest(update=update), self.assertRaisesRegex(ValueError, error):
                audit_calls([self.call], [{**self.generation, **update}], TokenizerContract())

    def test_context_guard_needs_a_genuinely_overlong_prompt(self):
        guard = {"model_called": False, "output_ids": [], "raw_text": None, "prompt_tokens": 0,
                 "eos_reached": False, "parse_error": "context_limit", "requested_prompt_tokens": 4090}
        result = audit_calls([self.call], [guard], TokenizerContract(4090))
        self.assertEqual(result["local_context_guards"], 1)
        self.assertEqual(result["generated_prompt_tokens"], 0)
        with self.assertRaisesRegex(ValueError, "context guard"):
            audit_calls([self.call], [{**guard, "requested_prompt_tokens": 100}], TokenizerContract(100))


if __name__ == "__main__":
    unittest.main()
