import json
import hashlib
from types import SimpleNamespace
import unittest
from train.audit_loss_mass import answer_examples, coefficient_audit, frozen_training_settings


def example(id, tokens, intent='record'):
    return {'id': id, 'tokens': tokens, 'intent': intent, 'family': intent, 'changed': False}


class LossMassTest(unittest.TestCase):
    def test_source_binding_and_complete_training_schedule(self):
        source = b'fixed training source\n'
        digest = hashlib.sha256(source).hexdigest()
        protocol = {'sourceLfSha256': {'research/m4-parser/train/sft.py': digest},
                    'trainingArgs': ['--seed', '20261019', '--batch', '16', '--epochs', '2']}
        self.assertEqual(frozen_training_settings(protocol, source.replace(b'\n', b'\r\n')),
                         ({'seed': 20261019, 'batch': 16, 'epochs': 2}, digest))
        with self.assertRaisesRegex(ValueError, 'source mismatch'):
            frozen_training_settings(protocol, source + b'changed')
        for flag in ('--max-steps', '--limit'):
            with self.assertRaisesRegex(ValueError, 'complete fixed epochs'):
                frozen_training_settings({**protocol, 'trainingArgs': protocol['trainingArgs'] + [flag, '1']}, source)

    def test_batch_normalization_is_not_global_token_share(self):
        rows = [example('long', 90), example('short', 10, 'clarify')]
        mixed = coefficient_audit(rows, batch=2)
        separate = coefficient_audit(rows, batch=1)
        self.assertEqual(mixed['groups']['intent:clarify']['rowShare'], .5)
        self.assertEqual(mixed['groups']['intent:clarify']['fixedBatchLossCoefficientShare'], .1)
        self.assertEqual(separate['groups']['intent:clarify']['fixedBatchLossCoefficientShare'], .5)
        self.assertEqual(separate['groups']['intent:clarify']['tokenShare'], .1)

    def test_answer_only_with_end_marker_and_exact_labels(self):
        label = {'intent': 'clarify', 'reason': 'missing_unit'}
        answer = json.dumps(label)
        row = {'id': 'v4-example', 'messages': [{'role': 'system', 'content': 'long ignored prompt'},
            {'role': 'user', 'content': 'another ignored prompt'}, {'role': 'assistant', 'content': answer}]}
        gold = {'id': row['id'], 'family': 'unit_negative', 'label': label}
        calls = []
        class Tokenizer:
            def encode(self, text, *, add_special_tokens):
                calls.append((text, add_special_tokens))
                return SimpleNamespace(ids=[1, 2, 3])
        parsed = answer_examples([row], [gold], Tokenizer())
        self.assertEqual(calls, [(answer + '<|im_end|>', False)])
        self.assertEqual(parsed[0]['tokens'], 3)
        self.assertTrue(parsed[0]['changed'])
        with self.assertRaisesRegex(ValueError, 'label mismatch'):
            answer_examples([row], [{**gold, 'label': {'intent': 'end'}}], Tokenizer())

    def test_missing_duplicate_and_zero_targets_rejected(self):
        for rows in ([], [example('a', 0)], [example('a', -1)], [example('a', True)],
                     [example('a', 1), example('a', 2)]):
            with self.assertRaises(ValueError): coefficient_audit(rows)
        with self.assertRaisesRegex(ValueError, 'IDs differ'):
            answer_examples([{'id': 'a'}], [{'id': 'b'}], None)

    def test_fixed_order_and_partial_batch(self):
        rows = [example(str(i), 3 + i, 'record' if i % 2 else 'clarify') for i in range(35)]
        a = coefficient_audit(rows); b = coefficient_audit(rows)
        self.assertEqual(a, b)
        self.assertEqual(a['steps'], 6)
        self.assertAlmostEqual(sum(v['fixedBatchLossCoefficientShare'] for k, v in a['groups'].items()
                                   if k.startswith('intent:')), 1, places=5)
        self.assertNotEqual(a['batchOrderSha256'], coefficient_audit(rows, seed=1)['batchOrderSha256'])


if __name__ == '__main__':
    unittest.main()
