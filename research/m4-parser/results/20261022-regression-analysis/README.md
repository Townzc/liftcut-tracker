# Why v3 lost challenge accuracy

This is a retrospective analysis of the **existing frozen outputs**, not another
training run, rescore with relaxed rules, or an independent test. The original
[v3 report](../run-20261021T222100Z-v3/README.md) remains unchanged. Native release
stays blocked.

## Observations

Previous Q8: **213/240 (88.75%)**. New Q8: **187/240 (77.92%)**. The net loss of
26 examples consists of **42 regressions and 16 improvements**; 171 remain correct
and 11 remain wrong. [Paired counts and source hashes](paired.json) are reproduced
by [this offline script](../../scripts/analyze-challenge-regression.py), using the
archived predictions and frozen scorer failure IDs.

| Negative family | Previous correct | New correct | Paired regressions |
| --- | ---: | ---: | ---: |
| Missing weight unit | 11/15 | 3/15 | 8 |
| Ambiguous multi-set RPE scope | 12/15 | 0/15 | 12 |
| Unknown exercise | 15/15 | 2/15 | 13 |
| Plan, not an actual report | 2/15 | 11/15 | 1 (10 improvements) |

The 42 regressions have different meanings:

- 20 expected clarifications became `record`: semantic over-acceptance.
- 14 stayed `clarify` but used invalid reason values: 13 unknown-exercise cases
  and one plan case. This is a contract failure, not 14 additional successful
  writes. Synonyms are not silently normalized to improve the score.
- 8 remained `record` but returned incorrect contents.

Raw invented **fields**, not example counts, rose from 50 to 153. Q8/HF and Q8/F16
agreement are 97.69% and 98.08%; **HF, F16 and Q8 each score 187/240**. Quantization
cannot explain the main loss. Development improved from 591/740 to 610/740 while
the challenge and handwritten sets worsened; development fit did not transfer.

## Interpretation and limits

Both v2 and v3 use 6,400 rows, the original 4,000-row base pool, 800 optimizer
steps and the same nominal rank, learning rate, seed and short system prompt.
V3 replaces the 2,400-row contrastive augmentation; it does not merely add more
training to v2. No matched ablation isolates each changed template or sampling
decision, so a single causal explanation would be too strong.

The [v3 generator](../../src/contrastive-v3.ts) gives each positive/negative family
120 rows, but most new negatives share explicit qualifier phrases and a small
number of sentence frames. Missing-unit negatives explicitly announce that the
unit is unknown; the challenge also contains bare numbers without that cue.
Multi-set RPE scope changes with word order, and catalog aliases/ambiguous names
are broader than the augmentation's four literal names. The observed errors are
consistent with learning these surface cues instead of the intended boundary.
The short prompt does not enumerate the closed clarification-reason vocabulary;
unconstrained decoding permits the invalid synonyms observed above. This is a
plausible mechanism, not proof that a longer prompt or more examples will fix it.

## Next controlled work

1. Keep the original scores, thresholds and failure files. Treat this challenge
   as an **observed regression set**, never claim fresh generalization on it.
2. Diagnose format and meaning separately. The existing [v2 G1 CPU diagnostic](../closed-decode-20261021/README.md)
   already improved format/exact results on 92 observed cases while invented
   fields increased from 18 to 22. Do not repeat it unchanged or activate grammar
   as a semantic fix. Any new decoding ablation needs a specific new hypothesis;
   raw and guarded metrics remain separate.
3. Before another training run, audit label-first examples for both explicit and
   implicit missing information, catalog ambiguity and qualifier scope across
   independently assigned sentence frames. Keep positive counterparts to measure
   over-refusal. Change one defined factor per arm, preserve failed arms, and
   freeze sampling, decoding and budget before inference.
4. The maintainer's 20 original utterances and their outputs remain private
   acceptance material. No originals, paraphrases, numeric variants or generated
   responses enter training or generation seeds. Their repeated use during repair
   makes them developmental acceptance, not an unseen holdout.
5. Complete the real conversational confirmation path first. Native download,
   physical-device performance and deployment remain separate gates; a cloud
   Agent passing these examples does not qualify the rejected 0.6B model.

No GPU was opened for this analysis. Learning checkpoint: explain why a lower
development loss, high quantization agreement and zero *guarded* writes can all
coexist with worse raw parsing and inadequate useful coverage.
