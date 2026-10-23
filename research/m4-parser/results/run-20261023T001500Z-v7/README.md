# M4 v7: train/inference prompt alignment · 2026-10-23 UTC

**Development gate: FAIL. Candidate S is rejected; native remains off.**

This is observed development evidence. The private 20 originals and every derivative stay outside training and diagnostic evaluation. Existing UI and modification confirmations are unchanged.

## Fixed comparison

- Reviewed source `b4c3801982133d420b281bf1b7c0d446fa3a1691`; protocol SHA-256 `3387d907e803c0f992dc7068ee6a20d52a5e422c08cca6c671c0f411aac0906b`.
- S starts from pinned original Qwen3-0.6B. Compared with cached v6 T, only the train/dev system text changes to the already frozen inference clarification enumeration. All 6,400 sentences, labels, catalogs, row order, original token-mean loss and training parameters stay fixed.
- One 800-step / two-epoch training; batch 16, rank 16, learning rate 0.0002, seed 20261019, 512-token limit and activation checkpointing. No augmentation, repair, retries, extra seeds, candidate switching or changed gates.
- Three fresh 1,040-item streams (S-HF, S-F16, S-Q8): 3,120 new predictions. H is historical v4 D; T is historical v6 T. Their 2,080 cached outputs and model/input provenance are hash-verified. They cannot establish a speed improvement.
- Frozen observed inputs: 740 dev, 240 challenge, 60 handwritten. Greedy decoding, 256 output tokens, reset KV and four GGUF generation/prefill threads. HF uses server CUDA; F16/Q8 use server CPU, not a phone.
- Training dev loss changes its conditioning prompt, so it is not directly comparable to historical T loss or a model-selection criterion. One seed and warn-only deterministic CUDA execution do not establish replicated causality.

## Raw results

| Arm | Set | Exact | Schema valid | Unsupported fields |
| --- | --- | ---: | ---: | ---: |
| H | dev-eval | 613/740 | 90.81% | 190 |
| H | challenge | 206/240 | 96.67% | 138 |
| H | handwritten | 49/60 | 93.33% | 15 |
| T | dev-eval | 636/740 | 92.43% | 215 |
| T | challenge | 195/240 | 95.00% | 151 |
| T | handwritten | 48/60 | 93.33% | 15 |
| S | dev-eval | 644/740 | 93.65% | 246 |
| S | challenge | 180/240 | 95.83% | 162 |
| S | handwritten | 50/60 | 95.00% | 15 |
| S-HF | dev-eval | 642/740 | 93.51% | 249 |
| S-HF | challenge | 185/240 | 96.25% | 162 |
| S-HF | handwritten | 49/60 | 95.00% | 16 |
| S-F16 | dev-eval | 644/740 | 93.65% | 246 |
| S-F16 | challenge | 182/240 | 96.25% | 159 |
| S-F16 | handwritten | 50/60 | 95.00% | 15 |

Unsupported fields are the frozen scorer's `invented` count, not actual database writes or necessarily fabricated numerals. Resolved-action exact can collapse legal clarification reasons; strict reason gates below remain separate. HF/F16 raw scores are six additional offline diagnostics, not extra server-report matches. A complete, hash-checked HF-only provisional analysis ran while F16/Q8 continued; final metrics are recomputed after canonical restoration.

## Strict reasons and useful records

| Arm | Missing unit | RPE scope | Unknown exercise | Paired positives (same order) | All positives | Illegal reasons / 1,040 |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| H | 10/15 | 0/15 | 15/15 | 14/15, 15/15, 15/15 | 113/120 | 7 |
| T | 4/15 | 0/15 | 15/15 | 14/15, 15/15, 15/15 | 111/120 | 9 |
| S | 3/15 | 0/15 | 15/15 | 12/15, 11/15, 14/15 | 97/120 | 6 |

Each focus needs at least 14/15 negatives with the correct reason and 14/15 useful positives; overall positives need 108/120. RPE scope means which sets the report applies to, separately from numeric RPE range.

## Paired changes and quantization

| Comparison | Set | Both correct | Gained | Lost | Both wrong |
| --- | --- | ---: | ---: | ---: | ---: |
| H->T | dev-eval | 595 | 41 | 18 | 86 |
| H->T | challenge | 189 | 6 | 17 | 28 |
| H->T | handwritten | 45 | 3 | 4 | 8 |
| T->S | dev-eval | 607 | 37 | 29 | 67 |
| T->S | challenge | 178 | 2 | 17 | 43 |
| T->S | handwritten | 47 | 3 | 1 | 9 |
| H->S | dev-eval | 587 | 57 | 26 | 70 |
| H->S | challenge | 174 | 6 | 32 | 28 |
| H->S | handwritten | 47 | 3 | 2 | 8 |

[Reason matrices](reason-matrix.json) and [binding attribution](binding-attribution.json) distinguish wrong clarification decisions, literal aliases and different resolved exercise identities. [Family contributions](error-contributions.json) reconcile to raw totals. [Decision attribution](decision-attribution.json) separates guessed units, unverified rep roles and effort applied to multiple sets; overlapping issue counts are not new accuracy scores. All use saved outputs with zero new inference.

- Q8 vs S-HF: `{"items": 1040, "missing": 0, "sameText": 1019, "sameParsed": 1013, "parsedAgreement": 0.974, "minAgreement": 0.95}`.
- Q8 vs S-F16: `{"items": 1040, "missing": 0, "sameText": 1023, "sameParsed": 1018, "parsedAgreement": 0.9788, "minAgreement": 0.95}`.
- Failed fixed gates: noTruncation, challengeExact, challengeSchema, challengeNoInvented, challengeCoverage, focusNegativeReasons, focusPositiveUseful, challengePositiveUseful, clarificationVocabulary.
- Candidate truncations: S-HF=1, S-F16=1, S=1.
- Raw unsupported fields, guarded unsafe writes, source-v1 useful coverage and strict reasons remain separate checks. A development pass still requires candidate continuous and physical-device acceptance.

## What regressed, and what this comparison establishes

The same-condition control is **v6 T (195/240)**, not v6's separately catalog-augmented
candidate S (204/240). Aligned S reaches **180/240 (75%)**, with two gains and
17 losses. The [paired attribution](paired-attribution.json) retains their IDs,
synthetic gold labels and actual outputs:

| Newly wrong relative to T | Count | Observed behavior |
| --- | ---: | --- |
| Different available exercise, otherwise correct fields | 12 | Barbell/dumbbell curl becomes the corresponding bench press |
| Missing repetitions | 2 | Clarification becomes an incomplete record with required fields absent |
| Explicitly scoped RPE positive records | 2 | Weight/reps are corrupted; the stated RPE itself is preserved |
| Missing weight unit | 1 | Clarification becomes a record with an unstated `lb` |

Both gains are correct clarification decisions: one uncertainty case and one
missing-repetitions case. Overall useful positives drop 111→97/120. Across the
whole challenge set, field-correct but wrong available exercise identities rise
9→21; these are not merely alternate names for the same exercise.

The unchanged scope problem remains more systematic: all 15 ambiguous multi-set
RPE cases become records applying RPE to every set. For missing units, 11/15
become records, including six guessing `lb`; four also lack necessary evidence
for the repetition role. These issue counts overlap. They occur in HF as well as
Q8, so quantization does not explain the main safety failure. HF already scores
185/240 with 16 wrong available identities; F16 scores 182/240. Quantization and
engine differences still matter—the Q8 score is five below HF—and passing 95%
agreement must not be described as eliminating all regression.

All three new streams truncate on the same old synthetic missing-unit item,
`test-00307`, after repeatedly expanding sets. Six illegal reason outputs also
remain across S's 1,040 predictions. The source-v1 guard rejects unsafe proposals
but useful challenge coverage is only 97/120 (80.83%); the existing source-only v2
parser resolves all 120 actionable cases in this observed challenge set. No
incremental model benefit or real database write is established here.

**Interpretation:** aligning the enum is insufficient under this fixed recipe.
It improves dev exact 636→644/740 and handwritten 48→50/60 while hurting the
challenge set, so reporting only dev loss/accuracy would hide the regression.
Input/token integrity, the fixed training configuration and offline replay pass;
there is no evidence of changed data or a broken transfer. The short prompt's
missing output shapes are a follow-up hypothesis, not a demonstrated explanation
for every action-copy or scope error. One seed and cached controls limit causal
and generalization claims. No acceptance threshold is relaxed.

## Recovery and verification

- Canonical restoration verified 122 run files, four complete weights (3,070,186,192 bytes), five full prediction streams, source and logs.
- All 31 frozen server reports recomputed from the restored bytes and matched. Six additional HF/F16 raw scores are labelled separately. The live source bundle restored the exact reviewed commit and all 53 source hashes; local workspace bindings were checked.
- Lossless weight transfer: 1,073,394,066 network bytes; original base, payload and reconstructed full-target hashes verified. Nine local and nine remote transport tests pass. Staging never changes model bytes.
- Platform OFF was observed before clearing the timer; final OFF/timer verification was 2026-10-23T01:46:14.323Z. Original work 03:15 UTC / power 04:15 UTC limits were retained. Instance and old assets retained.
- Conservative opening-to-OFF proxy: 91.24 minutes at ¥2.18/hour ≈ ¥3.31; not an invoice or exact billing interval.
- Root checks: 9 JS + 249 TS, lint zero errors/two existing warnings, production build pass. Exact-head CI and matching production deployment are separate release evidence.
- An initial source-install command used unavailable bare `python` and failed before executing the installer. Explicit cached Python succeeded; both logs were retained. This was not an experiment restart.

Concurrent transfer, cached controls and server engine differences prevent controlled speed claims. Sampled GPU memory maximum is not a continuous peak. No private utterances, raw private traces or model weights are published.

## CPU follow-through: prompt size is a separate constraint

A post-result read-only inventory reproduced every reviewed train/dev token sequence with the pinned local tokenizer. The aligned prompt fits all 6,400 training and 740 dev rows (maximum 348/347 tokens). Substituting the existing full cloud instructions **only in memory** reaches 534/533 tokens: 54 training and six dev rows exceed the fixed 512-token bound. No changed examples were saved or trained, and no model was called.

The short aligned instructions contain the reason enumeration but omit the per-intent JSON shapes present in the older cloud prompt. This is an observed contract difference, not proof that more text fixes semantic decisions. A future self-contained contract needs explicit field/identity/scope rules, its own token/mask checks and a train × inference comparison. Neither dropping long rows nor truncating answers is acceptable. The legacy prompt is not a selected candidate or a GPU-ready package.

[Inventory receipt](prompt-budget.json) · [Read-only audit source](../../scripts/audit_prompt_budget.py) · [Next CPU design draft, not GPU-ready](NEXT.md)

[Acceptance](acceptance.json) · [Summary](summary.json) · [Replay](replay-verification.json) · [File hashes](run-sha256.json) · [Power evidence](power-off.json) · [Frozen protocol](../../train/GPU_V7.md)
