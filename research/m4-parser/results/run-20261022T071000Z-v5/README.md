# M4 v5 fixed loss-reduction experiment · 2026-10-22 UTC

**Candidate S is rejected. Native remains off.**
The candidate, numerical gates, data and inference settings were fixed before outcomes. This is not independent acceptance or a phone release.

## Execution

- Source `8b89c8285aee477ea31b81ccb2c7a3d3a013d6ef`; protocol SHA-256 `f9b929e71805841949f3cf8e8d98a9615d7cf935608212eb5934081a6319f79c`.
- Two fresh original-base Qwen3-0.6B trainings: T uses token-mean loss, S uses per-example-mean loss. Both use the same 6,400 v4 train / 740 dev examples, seed 20261019, 800 steps / two epochs, batch 16, rank 16, learning rate 0.0002, maximum length 512 and activation checkpointing.
- H is archived v4 D. Fresh T, S-HF, S-F16 and S each completed 1,040 predictions: **4,160 new outputs**. No inference retry, output repair, additional seed, increased token allowance or candidate substitution.
- Evaluation is the previously observed 740 dev + 240 challenge + 60 handwritten examples. The 20 private originals, paraphrases, numeric variants and outputs are excluded from training and this diagnostic evaluation.
- Runtime: RTX 4090, torch 2.8.0, transformers 5.20.1, peft 0.21.2 and llama-cpp-python 0.3.36. HF uses CUDA; GGUF uses four server CPU generation/prefill threads with reset KV. Greedy decoding and 256 new tokens remain fixed.

| Training | Objective | Steps | Internal training seconds | Dev token-mean loss | Peak CUDA allocated bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| T | token mean | 800 | 346.4 | 0.05173 | 10258342912 |
| S | sample mean | 800 | 361.0 | 0.05046 | 10230227968 |

Internal training, runner step duration and prediction latency are different measurements; the full values are in [summary.json](summary.json). Dev loss is not an acceptance score.

## Raw scores

| Arm | Set | Exact | Schema valid | Invented fields |
| --- | --- | ---: | ---: | ---: |
| H | dev-eval | 613/740 | 90.81% | 190 |
| H | challenge | 206/240 | 96.67% | 138 |
| H | handwritten | 49/60 | 93.33% | 15 |
| T | dev-eval | 613/740 | 90.81% | 190 |
| T | challenge | 206/240 | 96.67% | 138 |
| T | handwritten | 49/60 | 93.33% | 15 |
| S | dev-eval | 650/740 | 94.05% | 194 |
| S | challenge | 197/240 | 98.75% | 143 |
| S | handwritten | 48/60 | 91.67% | 15 |
| S-HF | dev-eval | 651/740 | 94.19% | 204 |
| S-HF | challenge | 202/240 | 97.92% | 143 |
| S-HF | handwritten | 48/60 | 91.67% | 15 |
| S-F16 | dev-eval | 649/740 | 93.92% | 198 |
| S-F16 | challenge | 201/240 | 97.50% | 140 |
| S-F16 | handwritten | 48/60 | 91.67% | 15 |

Exact uses the frozen resolved-action scorer, which may map different legal clarification reasons to the same action. The strict reason tables below keep that limitation visible. Invented counts unsupported fields, not distinct wrong rows or necessarily fabricated numeric values. The six HF/F16 raw scores are additional first-offline diagnostics, separate from the 31 server reports reproduced exactly.

## Replication and paired changes

T reproduces H's raw output on 1040/1,040 items and finish reason on 1040/1,040. All four fresh T weight hashes match v4 after reading the actual bytes.

| Comparison | Set | Both correct | Gained | Lost | Both wrong |
| --- | --- | ---: | ---: | ---: | ---: |
| H->T | dev-eval | 613 | 0 | 0 | 127 |
| H->T | challenge | 206 | 0 | 0 | 34 |
| H->T | handwritten | 49 | 0 | 0 | 11 |
| T->S | dev-eval | 579 | 71 | 34 | 56 |
| T->S | challenge | 189 | 8 | 17 | 26 |
| T->S | handwritten | 45 | 3 | 4 | 8 |
| H->S | dev-eval | 579 | 71 | 34 | 56 |
| H->S | challenge | 189 | 8 | 17 | 26 |
| H->S | handwritten | 45 | 3 | 4 | 8 |

[Per-family gains and losses](loss-summary.json) preserve regressions. This single-seed, fixed-order comparison measures this objective change on these observed sets; it does not establish generalization or a universal causal explanation.

## Clarification and useful positives

| Arm | Missing-unit reason | RPE-scope reason | Unknown-exercise reason | Paired positives, same order | All challenge positives | Invalid reasons / 1,040 |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| H | 10/15 | 0/15 | 15/15 | 14/15, 15/15, 15/15 | 113/120 | 7 |
| T | 10/15 | 0/15 | 15/15 | 14/15, 15/15, 15/15 | 113/120 | 7 |
| S | 5/15 | 1/15 | 15/15 | 13/15, 15/15, 13/15 | 101/120 | 0 |

RPE scope means which reported sets the effort applies to, not the permitted numerical RPE range. Each focus negative and positive requires at least 14/15; all challenge positives require 108/120, and invalid reasons must be zero.

| S challenge family with unsupported fields | Exact | Invented fields | Record/correct predictions |
| --- | ---: | ---: | ---: |
| contrast_missing_unit_negative | 5/15 | 17 | 7 |
| contrast_rpe_scope_negative | 1/15 | 126 | 14 |

[All error contributions](error-contributions.json) sum to the raw totals. Attribution uses restored outputs and adds no model calls.

## Original gates and source checks

- S Q8 versus S-HF: 1013/1040 (97.40%) identical parsed outputs; original minimum 95%.
- S Q8 versus S-F16: 1020/1040 (98.08%) identical parsed outputs; original minimum 95%.
- Failed checks: `challengeExact`, `challengeSchema`, `challengeNoInvented`, `challengeCoverage`, `focusNegativeReasons`, `focusPositiveUseful`, `challengePositiveUseful`.
- Truncations: H=1, T=1, S=0, S-HF=0, S-F16=0. Candidate Q8/HF/F16 must each have zero; H/T failures remain reported controls.

| S set | Source-v1 correct/actions | Source-v2 correct/actions | Source-only v2 | Unsafe v1 / v2 |
| --- | ---: | ---: | ---: | ---: |
| dev-eval | 251/475 | 251/475 | 258/475 | 0 / 0 |
| challenge | 101/120 | 101/120 | 120/120 | 0 / 0 |
| handwritten | 12/39 | 31/39 | 38/39 | 0 / 0 |

The original source-v1 gate is retained. Safe rejection and quantization agreement do not establish added model utility. The application still requires preview and explicit confirmation before changes. No production model flag, UI or data migration changes in this result.

## Observed runtime

| Stream | Prediction p50 ms | Prediction p95 ms | Sum of per-item seconds | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| H (historical) | 966.00 | 2033.20 | 1064.920 | 36857 |
| T | 1076.80 | 2356.60 | 1204.905 | 36857 |
| S | 963.30 | 2077.60 | 1073.733 | 37234 |
| S-HF | 652.55 | 1822.00 | 739.140 | 38340 |
| S-F16 | 1990.40 | 4271.00 | 2200.135 | 37307 |

The 30-second observer captured 203 successful samples, 6074.14 seconds of intervals, interval-weighted GPU utilization 12.67% and maximum observed memory 18522 MiB. A sampled maximum is not a continuous peak. Sampling excludes setup and backup-only time.
Concurrent lossless weight staging, fixed inference order and CUDA-versus-CPU execution prevent treating these measurements as a controlled speed comparison. H is historical, and no physical device was measured.

## Restoration, operations and power

- Canonical archive restored and SHA-256 verified: 131 run files, all eight complete weights, all five 1,040-row streams, source bundle and operational logs (6,217,174,287 total bytes).
- All 31 frozen server reports were recomputed from restored bytes using the reviewed evaluator and matched exactly. Six reference raw scores and error/strict-reason attribution are additional offline diagnostics, with zero inference.
- Slow source transfer failed before launch. A verified incremental bundle reconstructed the same reviewed source; the partial was retained. T weights were reused locally only after fresh remote and local full-byte hash equality. S was transferred losslessly with XOR/gzip, and every reconstructed full target was hashed. Nine synthetic transport tests passed locally and remotely. Full canonical restoration remained mandatory.
- Platform OFF verified at 2026-10-22T09:10:15.471Z after complete restoration. This window's timer was cleared after OFF; the instance and files were retained. Original 10:10 UTC work / 11:10 UTC power deadlines were not extended.
- Conservative opening-to-OFF proxy: 120.26 minutes × ¥2.18/hour = approximately ¥4.37. This is not the billing interval or invoice.
- Local application checks: 9 JS + 233 TS tests, lint with zero errors/two existing warnings, production build success. Exact-head CI is required before merging this result.

[Acceptance](acceptance.json) · [Report replay](replay-verification.json) · [Run hashes](run-sha256.json) · [Power evidence](power-off.json) · [Fixed protocol](../../train/GPU_V5.md)

## Interpretation and next step

The loss change improves dev exact from 613/740 to 650/740 and removes all seven
illegal clarification reasons and the candidate's repeated-set truncation. It
does **not** improve challenge quality: 206/240 → 197/240 (85.83% → 82.08%), with
eight gains and 17 losses. Dev loss also falls, so neither dev loss nor the dev
aggregate would have been a sufficient release criterion.

The [saved-output attribution](regression-causes.json), reproduced by
[audit-v5-regressions.ts](../../scripts/audit-v5-regressions.ts), explains every
paired challenge regression without new inference:

- Twelve lost positive records differ **only in the exercise name**, with all
  set fields unchanged: ten Pull-up → 卧推 and two Barbell bench press → Dumbbell
  curl. The positive floor falls from 113/120 to 101/120. This is action binding
  failure, not simply more conservative clarification.
- Five lost missing-unit negatives become records: three add kg/lb that the
  input did not state; two turn the input into multiple unweighted sets. Correct
  missing-unit clarification falls from 10/15 to 5/15.
- Six of the eight gains repair the invalid `target_not_actual` spelling to
  `plan_not_actual`. The other two correctly clarify one missing-reps request
  and one RPE-scope request. These gains are real, but most concern label
  vocabulary rather than the safety boundary we intended to improve.

RPE-scope accuracy remains 1/15 in **all three S formats**. Fourteen ambiguous
RPE inputs still become records, contributing 126 of 143 unsupported fields;
the other 17 come from missing units. S-HF and S-F16 reach only 202/240 and
201/240, so quantization is not the main explanation for rejection. Q8 adds
some differences, but an unquantized S would still fail the original gates.

The earlier coefficient imbalance was an observation, not a sufficient causal
explanation. In this fixed comparison, giving every example equal mean loss
helps some formatting and observed dev behavior while hurting exercise binding
and challenge utility. One seed does not prove that sample-mean loss always
hurts; it does reject this candidate and the claim that this intervention solved
the boundary problem. No failing row was edited or reclassified to improve the score.

An additional [CPU catalog audit](catalog-coverage.json) regenerated all v4 data
files and matched their saved hashes, including the exact 6,400 training rows.
Every model-visible user payload contains only `exercises` and `sentence`;
`selected` is absent, so the UI selection is not an input-level explanation.
Neither challenge catalog's full membership occurs in training (0/240 rows),
versus 304/740 dev rows whose catalog membership is seen. This is a coverage
difference, not unseen exercise names or proof of cause: T still achieves
206/240 on the same challenge inputs. [Reproduction source](../../scripts/audit-v5-catalogs.ts).

The same audit finds a concrete **alias-policy mismatch**: 40 existing training
rows label bare `卧推` / `bench press` as `unknown_exercise` with both bench
variants available. The shared registry resolves both exact aliases to
`barbell-bench`, and the challenge includes nine corresponding record targets.
The full catalogs and sentence frames differ, so these are not identical-input
label duplicates. Nevertheless, the training policy and the registry/challenge
policy disagree. This does not prove the v5 regression mechanism (T saw the
same labels), and no historical label or score is changed by the audit.

Before another GPU run, unify the alias policy and add a CPU check that rejects
such cross-policy targets. Then specify a label-preserving catalog/order
intervention and separately audit intent/reason decisions versus copied numeric
fields. Retain a control and the positive-record floors, verify no missing value
is supplied by catalog context, and freeze a new comparison only after CPU
checks and CI. Do not simply add epochs, relax the missing-unit
rule, raise the token cap or use the private 20 utterances as training material.
The audits support a testable direction, not a prepared next GPU run or a claim
that changing catalogs alone will fix the model.

To reproduce the attribution from the verified archive (no model loading):

```sh
node --import tsx research/m4-parser/scripts/audit-v5-regressions.ts \
  --run-dir "$RESTORED_RUN" --out /tmp/v5-regression-causes.json
node --import tsx research/m4-parser/scripts/audit-v5-catalogs.ts \
  --run-dir "$RESTORED_RUN" --out /tmp/v5-catalog-coverage.json
```

The private 20-utterance cloud conversation has separate application evidence; it does not certify this on-device candidate. Native integration, candidate continuous acceptance, additional utility beyond rules and physical-device acceptance remain pending. GPU training requires a newly reviewed experiment and a fresh user-opened window.

Learning checkpoint: explain token-mean versus sample-mean coefficients, historical versus fresh controls, strict reason correctness versus resolved action accuracy, and why a lower dev loss or safe rejection alone cannot authorize release.
