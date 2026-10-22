"""Average assistant-token causal CE within each example, then across examples.

Prompt/padding labels are -100. Includes the answer's EOS token; does not add
intent weights, class weights, output repair, or a new data-dependent heuristic.
"""
import torch
import torch.nn.functional as F


def sample_mean_causal_loss(logits, labels):
    if logits.ndim != 3 or labels.ndim != 2 or labels.shape != logits.shape[:2]:
        raise ValueError("expected batch/time/vocabulary logits and matching labels")
    if logits.shape[0] == 0 or logits.shape[1] < 2 or logits.shape[2] == 0:
        raise ValueError("empty batch, sequence, or vocabulary")
    if labels.dtype != torch.long or not logits.is_floating_point():
        raise ValueError("expected floating logits and int64 labels")
    # Predict token t+1 from logit t, exactly once. The last logit has no target.
    shifted = labels[:, 1:]
    counts = shifted.ne(-100).sum(dim=1)
    if bool(counts.eq(0).any()):
        raise ValueError("every example must contain a supervised answer token")
    losses = F.cross_entropy(
        logits[:, :-1].float().reshape(-1, logits.shape[-1]),
        shifted.reshape(-1), ignore_index=-100, reduction="none",
    ).reshape_as(shifted)
    return (losses.sum(dim=1) / counts).mean()
