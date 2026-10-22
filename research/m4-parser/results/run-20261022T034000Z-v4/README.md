# M4 v4 fixed data × prompt experiment · 2026-10-22 UTC

**Candidate D rejected. Native integration remains off.** The original quality
gates and the additional clarification gates remain unchanged. This result is a
completed fixed experiment, not a phone release or an independent acceptance pass.

## Execution and scope

- Exact source `f9535a89fc2075d3e2eb96d6eaaa437b00955576`, protocol SHA-256
  `8c723364befc5fd741b875bfd69515e627ded1fa1598f39759c3bac7087c53f9`; the source tree was checked before model calls.
- One original-base Qwen3-0.6B training: 6,400 train / 740 dev, two epochs / 800
  steps, batch 16, rank 16, lr 0.0002, seed 20261019, max length 512 and activation
  checkpointing. Training metrics: 348.3 seconds, dev loss 0.05173,
  peak CUDA allocation 10,258,342,912 bytes. Runner elapsed time
  includes additional setup/export work and is reported separately.
- [v4 data](../../DATA_CARD_V4.md) replaces 720 paired boundary rows while retaining
  5,680 rows/order and the short SFT prompt. No private original, paraphrase,
  numeric variant or output from the 20-utterance acceptance entered training.
- A reuses 1,040 archived v3 Q8 outputs. B, D-HF, D-F16, C and D each completed
  1,040 outputs: **5,200 new predictions**. No retry, sweep, grammar restriction,
  output repair, second training or candidate switch was performed.
- All inputs are the **previously observed** 740 development, 240 challenge and
  60 handwritten examples. This experiment did not use the private 20 utterances
  and does not establish unseen generalization.
- Runtime: RTX 4090, torch 2.8.0+cu128, transformers 5.20.1, peft 0.21.2 and
  llama-cpp-python 0.3.36. HF used CUDA; GGUF used four server CPU generation and
  prefill threads with reset KV state. These are not phone benchmarks.

| Arm | Weights | Inference prompt |
| --- | --- | --- |
| A | Archived v3 Q8 | Short; archived output |
| B | Same v3 Q8 | Short plus legal clarification reasons |
| C | New v4 Q8 | Short |
| D | Same new v4 Q8 | Short plus reasons; **preselected candidate** |

## Raw quality

| Arm | Set | Exact | Schema valid | Invented fields |
| --- | --- | ---: | ---: | ---: |
| A | dev-eval | 610/740 | 91.62% | 243 |
| A | challenge | 187/240 | 92.50% | 153 |
| A | handwritten | 47/60 | 91.67% | 17 |
| B | dev-eval | 609/740 | 89.59% | 215 |
| B | challenge | 199/240 | 96.67% | 143 |
| B | handwritten | 48/60 | 90.00% | 17 |
| C | dev-eval | 624/740 | 92.03% | 201 |
| C | challenge | 200/240 | 97.08% | 147 |
| C | handwritten | 48/60 | 95.00% | 21 |
| D | dev-eval | 613/740 | 90.81% | 190 |
| D | challenge | 206/240 | 96.67% | 138 |
| D | handwritten | 49/60 | 93.33% | 15 |
| D-HF | dev-eval | 611/740 | 90.68% | 190 |
| D-HF | challenge | 200/240 | 96.25% | 142 |
| D-HF | handwritten | 51/60 | 95.00% | 15 |
| D-F16 | dev-eval | 614/740 | 90.81% | 188 |
| D-F16 | challenge | 203/240 | 97.08% | 141 |
| D-F16 | handwritten | 50/60 | 93.33% | 15 |

Exact uses the frozen resolved-action scorer; different valid clarification
reasons can resolve to the same action. Invented counts fields, not rows. HF/F16
raw scores are six **additional post-result offline reports**, separate from the
40 reports reproduced from the server. They use the same restored predictions
and frozen evaluator and change no gates.

## What changed, and what remains wrong

| Arm | Missing-unit correct reason | RPE-scope correct reason | Unknown-exercise correct reason | Paired positives (same order) | All challenge positives | Invalid reasons / 1,040 |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| A | 3/15 | 0/15 | 2/15 | 14/15, 15/15, 15/15 | 111/120 | 18 |
| B | 2/15 | 0/15 | 15/15 | 14/15, 15/15, 15/15 | 111/120 | 8 |
| C | 5/15 | 0/15 | 15/15 | 14/15, 15/15, 15/15 | 111/120 | 9 |
| D | 10/15 | 0/15 | 15/15 | 14/15, 15/15, 15/15 | 113/120 | 7 |

Each negative/paired-positive threshold is at least 14/15. All positive challenge
cases must reach 108/120, and invalid clarification reasons must be zero. A legal
reason is not enough: it must be the appropriate reason for that input.

| Challenge comparison | Both correct | Gained | Lost | Both wrong |
| --- | ---: | ---: | ---: | ---: |
| A->B | 182 | 17 | 5 | 36 |
| A->C | 183 | 17 | 4 | 36 |
| B->D | 191 | 15 | 8 | 26 |
| C->D | 198 | 8 | 2 | 32 |
| A->D | 182 | 24 | 5 | 29 |

A→B and C→D compare the prompt factor. A→C and B→D compare the data factor.
[Family-level comparisons](factor-summary.json) retain gains and regressions
instead of reporting only net accuracy. These are single-seed observed-set
comparisons, not replicated causal/generalization estimates. Archived A timing
also cannot serve as a controlled new latency baseline.

The reason-list prompt alone raises unknown-exercise clarification from 2/15 to
15/15 (A→B); the changed data also reaches 15/15 without that list (C). Missing-unit
clarification is 3/2/5/10 across A/B/C/D, so the combined condition helps but still
misses its 14/15 threshold. RPE-scope clarification remains **0/15 in every cell**:
neither tested intervention fixes that boundary. D's 113/120 useful positives pass
the predeclared utility floor, while its remaining safety/quality failures still
reject it.

D's nonzero invented-field contributions, recomputed from saved predictions:

| Challenge family | Resolved exact | Invented fields | Record/correct predictions |
| --- | ---: | ---: | ---: |
| contrast_rpe_scope_negative | 0/15 | 132 | 15 |
| contrast_missing_unit_negative | 10/15 | 6 | 4 |

[All per-family contributions](error-contributions.json) sum to the unchanged
raw totals in every arm. This is post-result error attribution, not a causal
training ablation; one wrong multi-set record can add several invented fields.

## Quantization, source checks and release decision

Q8/HF 1004/1040 (96.54%); Q8/F16 1007/1040 (96.83%). See [original acceptance](acceptance.json).
Failed checks: `noTruncation`, `challengeExact`, `challengeSchema`, `challengeNoInvented`, `focusNegativeReasons`, `clarificationVocabulary`. No alternate arm replaces D.

All four new-model streams (C, D, D-HF, D-F16) hit the 256-token limit on the same
observed development item, `test-00307` (`60 x 7`, a public synthetic missing-unit
fixture). They repeat set objects although the expected answer is a short
clarification. Archived A and B also answer this item incorrectly, but stop.
This is not a valid answer needing a larger output allowance; no cap or score was
changed. [Saved-output truncation summary](truncation-summary.json).

| D set | Source-v1 correct/actions | Source-v2 correct/actions | Source-only v2 | Unsafe accepted v1 / v2 |
| --- | ---: | ---: | ---: | ---: |
| dev-eval | 226/475 | 226/475 | 258/475 | 0 / 0 |
| challenge | 113/120 | 113/120 | 120/120 | 0 / 0 |
| handwritten | 14/39 | 31/39 | 38/39 | 0 / 0 |

Original source-v1 remains mandatory. Source-v2 accepts a subset of its deterministic
parser, so safe rejection cannot establish useful model coverage beyond rules.
Quantization agreement measures whether two formats agree, not whether either
answer is correct. The application still requires a preview and explicit approval
before every modification; this experiment changes no production model or UI.

## Post-result CPU diagnosis

The frozen training objective averages cross entropy over unmasked answer tokens
within each batch. A [tokenizer-only audit](../../train/audit_loss_mass.py),
reconstructed from the actual training rows and fixed 800-batch ordering, found:

- Clarification: 2,452 rows (38.31%), but
  16.15% of scalar loss coefficients.
- Record: 3,026 rows (47.28%), but
  74.95% of those coefficients.
- The replaced RPE pairs contain 120 positives and 120 negatives. Their coefficient
  shares are 4.17% and
  0.80%, respectively.

This is an **observed coefficient imbalance, not proof of gradient impact or a
causal explanation**. Token difficulty, repeated JSON syntax and the weight on the
initial intent decision also matter. No loss, data, weight or inference condition
was changed during the run. A possible next controlled experiment is per-example
loss normalization with all other factors fixed; it first needs CPU gradient/
padding checks, a frozen protocol, CI and a new user-opened window. No new GPU run
is authorized by this report. Positive-case gates must remain to catch over-refusal.

The audit uses the original pinned tokenizer. All 6,400 answer token sequences
matched the saved tokenizer serialization, despite the file hashes differing.
[Coefficients](loss-coefficients.json) and [equivalence](tokenizer-equivalence.json)
record the distinction. Five dependency-free arithmetic/input/source-binding regressions pass;
root verification also passed 9 JS and 233 TS tests. Exact-head PR CI remains a
separate release gate; these local tests do not substitute for it.

Reproduce the coefficient audit with the pinned original tokenizer, without model
weights or inference (the local run used `tokenizers==0.22.2`):

```sh
node --import tsx research/m4-parser/scripts/build-v4.ts
python research/m4-parser/train/audit_loss_mass.py --tokenizer /path/to/pinned-base --out /new/path/audit.json
python research/m4-parser/test_loss_mass.py -v
```

## Backup, replay and power

- All **140 run files**, including four new weight files,
  were restored and hash-verified off-instance; the combined operational backup
  contains **3,136,847,761 bytes**. Raw outputs, logs, weights and the
  complete source bundle remain in the private backup. No weights or private
  utterances are published here.
- The exact source recomputed **40 reports**, all matching the server reports.
  Only absolute path prefixes in metric metadata were normalized. Six additional
  HF/F16 raw scores were first computed offline. All this scoring made zero model
  calls. [Replay receipt](replay-verification.json),
  [reference-score receipt](reference-metrics-verification.json),
  [original file hashes](run-sha256.json).
- AutoDL visibly **OFF at 2026-10-22T05:43:34.312Z**, after full backup restoration.
  The original 06:40 work / 07:40 shutdown deadlines were not extended. The timer
  was cleared only after OFF; the instance and retained assets were not deleted.
  [Power evidence metadata](power-off.json); console image remains private.
- Opening proxy 03:40 UTC to verified OFF is 123.6 minutes, approximately
  **¥4.49** at the supplied ¥2.18/hour. This is a conservative duration
  proxy, not actual boot time, exact billing stop time or the platform invoice.
- [Full aggregate summary](summary.json) includes paired results, latency,
  30-second GPU samples, training and hashes. Resource maxima are sampled maxima;
  the interval-weighted GPU figure excludes setup/backup-only time and is not
  whole-lease utilization. Public aggregates alone do not reproduce raw inference.

Next: test the loss-weighting hypothesis on CPU before freezing another comparison.
Candidate continuous acceptance, demonstrated utility beyond the source-only
baseline, native integration and physical-device validation remain pending.
The earlier cloud 20-utterance acceptance is separate evidence and does not make
this rejected native candidate ready to release.

Learning checkpoint: explain why balanced example counts need not mean balanced
token loss, why agreement is different from correctness, why a safety guard does
not prove model usefulness, and why the original selection/gates remain fixed.
