"""Real CPU/autograd checks, no downloads or pretrained model/quality claims."""
import copy
import unittest
import torch
import torch.nn.functional as F
from transformers import Qwen3Config, Qwen3ForCausalLM
from train.sample_mean_loss import sample_mean_causal_loss as loss


class SampleMeanLossTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def setUp(self):
        torch.manual_seed(20261022)
        self.logits = torch.randn(2, 6, 5, requires_grad=True)
        self.labels = torch.tensor([[-100, -100, 1, 2, -100, -100], [-100, 2, 1, 3, 4, 2]])

    def test_matches_individual_example_ce_and_gradients(self):
        expected = torch.stack([F.cross_entropy(self.logits[i, :-1], self.labels[i, 1:],
                                                ignore_index=-100) for i in range(2)]).mean()
        actual = loss(self.logits, self.labels)
        torch.testing.assert_close(actual, expected)
        torch.testing.assert_close(torch.autograd.grad(actual, self.logits, retain_graph=True)[0],
                                   torch.autograd.grad(expected, self.logits)[0])

    def test_padding_does_not_change_loss_or_gradient(self):
        actual = loss(self.logits, self.labels)
        grad = torch.autograd.grad(actual, self.logits)[0]
        padded = torch.cat((self.logits.detach(), torch.randn(2, 3, 5)), dim=1).requires_grad_()
        padded_loss = loss(padded, F.pad(self.labels, (0, 3), value=-100))
        padded_grad = torch.autograd.grad(padded_loss, padded)[0]
        torch.testing.assert_close(padded_loss, actual.detach())
        torch.testing.assert_close(padded_grad[:, :6], grad)
        self.assertFalse(bool(padded_grad[:, 6:].any()))

    def test_prompt_padding_and_final_logits_have_zero_gradient_but_eos_is_learned(self):
        # Targets 1,2 are a synthetic answer token and EOS; the second example
        # has four more answer tokens. No text from any acceptance set is used.
        grad = torch.autograd.grad(loss(self.logits, self.labels), self.logits)[0]
        active = F.pad(self.labels[:, 1:].ne(-100), (0, 1), value=False)
        self.assertFalse(bool(grad[~active].any()))
        self.assertTrue(bool(grad[0, 2].any()))  # predicts EOS at labels[0,3]
        self.assertTrue(bool(grad[1, 4].any()))  # final supervised label

    def test_equal_lengths_match_token_mean_and_gradients(self):
        labels = self.labels.clone(); labels[0] = labels[1]
        expected = F.cross_entropy(self.logits[:, :-1].reshape(-1, 5), labels[:, 1:].reshape(-1))
        actual = loss(self.logits, labels)
        torch.testing.assert_close(actual, expected)
        torch.testing.assert_close(torch.autograd.grad(actual, self.logits, retain_graph=True)[0],
                                   torch.autograd.grad(expected, self.logits)[0])

    def test_unequal_lengths_have_equal_example_coefficient_mass(self):
        logits = torch.zeros_like(self.logits, requires_grad=True)
        grad = torch.autograd.grad(loss(logits, self.labels), logits)[0]
        # With equal token difficulty, total gradient magnitude is identical
        # for the short and long examples instead of scaling with token count.
        torch.testing.assert_close(grad[0].abs().sum(), grad[1].abs().sum())
        token_mean = F.cross_entropy(logits[:, :-1].reshape(-1, 5), self.labels[:, 1:].reshape(-1))
        original = torch.autograd.grad(token_mean, logits)[0]
        torch.testing.assert_close(original[1].abs().sum() / original[0].abs().sum(), torch.tensor(2.5))

    def test_single_example_and_noncontiguous_logits(self):
        transposed = self.logits.detach().transpose(1, 2).contiguous().transpose(1, 2).requires_grad_()
        torch.testing.assert_close(loss(transposed, self.labels), loss(self.logits, self.labels))
        expected = F.cross_entropy(self.logits[0, :-1], self.labels[0, 1:])
        torch.testing.assert_close(loss(self.logits[:1], self.labels[:1]), expected)

    def test_low_precision_logits_use_float32_loss(self):
        for dtype in (torch.float16, torch.bfloat16):
            logits = self.logits.detach().to(dtype).requires_grad_()
            actual = loss(logits, self.labels)
            self.assertEqual(actual.dtype, torch.float32)
            expected = loss(logits.float(), self.labels)
            torch.testing.assert_close(actual, expected)
            self.assertTrue(bool(torch.isfinite(torch.autograd.grad(actual, logits)[0]).all()))

    def test_zero_target_example_is_rejected_even_with_valid_neighbor(self):
        labels = self.labels.clone(); labels[0] = -100
        with self.assertRaisesRegex(ValueError, "every example"):
            loss(self.logits, labels)

    def test_bad_shapes_and_dtypes_are_rejected(self):
        for logits, labels in [(self.logits[:0], self.labels[:0]),
                               (self.logits[:, :1], self.labels[:, :1]),
                               (self.logits, self.labels[:, :3]),
                               (self.logits, self.labels.float()),
                               (self.logits.long(), self.labels)]:
            with self.subTest(shape=logits.shape, dtype=labels.dtype), self.assertRaises(ValueError):
                loss(logits, labels)

    def test_tiny_qwen_causal_shift_and_model_gradients(self):
        cfg = Qwen3Config(vocab_size=19, hidden_size=16, intermediate_size=32,
                          num_hidden_layers=2, num_attention_heads=2,
                          num_key_value_heads=1, head_dim=8, max_position_embeddings=32,
                          attention_dropout=0.0, use_cache=False, pad_token_id=0)
        cfg._attn_implementation = "eager"
        model = Qwen3ForCausalLM(cfg).eval(); other = copy.deepcopy(model)
        ids = torch.tensor([[1, 2, 3, 4, 0, 0], [1, 2, 5, 6, 7, 8]])
        attention = ids.ne(0).long(); labels = ids.clone()
        labels[:, :2] = -100; labels[0, 4:] = -100
        output = model(input_ids=ids, attention_mask=attention, labels=labels)
        token_mean = F.cross_entropy(output.logits[:, :-1].float().reshape(-1, 19), labels[:, 1:].reshape(-1))
        torch.testing.assert_close(output.loss, token_mean)
        # Omitting labels must not change model logits; only loss reduction changes.
        logits = model(input_ids=ids, attention_mask=attention).logits
        torch.testing.assert_close(logits, output.logits)
        actual = loss(logits, labels)
        expected = torch.stack([other(input_ids=ids[i:i+1], attention_mask=attention[i:i+1],
                                     labels=labels[i:i+1]).loss for i in range(2)]).mean()
        torch.testing.assert_close(actual, expected)
        actual.backward(); expected.backward()
        for (name, param), (_, ref) in zip(model.named_parameters(), other.named_parameters()):
            if param.grad is not None:
                with self.subTest(parameter=name):
                    torch.testing.assert_close(param.grad, ref.grad, atol=2e-7, rtol=2e-5)


if __name__ == "__main__":
    unittest.main()
