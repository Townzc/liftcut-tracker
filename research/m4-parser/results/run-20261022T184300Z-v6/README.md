# M4 v6: alias-consistent labels and catalog exposure · 2026-10-22 UTC

**Candidate S is rejected by the fixed development gate. Native remains off.** This is observed development evidence, not independent acceptance or a phone release.

## Fixed execution

- Reviewed source `c4343d745000a1dc03b6b0f2963311d39fac4dd4`; protocol SHA-256 `b839b399eada30818ed8ac21e57b4b6d770e1cc601a089e4bb6af3336d31a374`.
- Both fresh original-base Qwen3-0.6B arms use the same corrected labels, all 6,400 original sentence bytes, token-mean loss and row order. Only S changes training-derived catalog membership/order (6,397 catalogs).
- Both run 800 steps / two epochs, batch 16, rank 16, learning rate 0.0002, seed 20261019, 512 tokens and activation checkpointing. H is cached v4 D with original labels.
- Four fresh streams (T, S-HF, S-F16, S) each complete 1,040 inputs: 4,160 new predictions. Greedy / 256 new tokens / reset KV / four GGUF generation and prefill threads are unchanged. No retry, extra seed, repair or candidate substitution.
- Evaluation is the observed 740 dev + 240 challenge + 60 handwritten set. The private 20 originals, paraphrases, numeric variants, outputs and derivatives are excluded from training and this diagnostic evaluation.
- torch 2.8.0, transformers 5.20.1, peft 0.21.2 and llama-cpp-python 0.3.36; HF uses RTX 4090 CUDA, GGUF uses server CPU. These are not physical-device latency results.

| Arm | Internal training seconds | Dev token-mean loss | Peak CUDA allocated bytes |
| --- | ---: | ---: | ---: |
| T | 349.4 | 0.04535 | 10258342912 |
| S | 349.6 | 0.05535 | 10198720512 |

Training loss is not an acceptance score. The shared 40-label repair is separate from T→S; membership and ordering are tested as one package. One seed and observed inputs do not establish generalization.

## Raw scores

| Arm | Set | Exact | Schema valid | Unsupported fields |
| --- | --- | ---: | ---: | ---: |
| H | dev-eval | 613/740 | 90.81% | 190 |
| H | challenge | 206/240 | 96.67% | 138 |
| H | handwritten | 49/60 | 93.33% | 15 |
| T | dev-eval | 636/740 | 92.43% | 215 |
| T | challenge | 195/240 | 95.00% | 151 |
| T | handwritten | 48/60 | 93.33% | 15 |
| S | dev-eval | 609/740 | 91.35% | 208 |
| S | challenge | 204/240 | 97.92% | 131 |
| S | handwritten | 48/60 | 93.33% | 15 |
| S-HF | dev-eval | 607/740 | 90.95% | 209 |
| S-HF | challenge | 205/240 | 99.17% | 140 |
| S-HF | handwritten | 48/60 | 93.33% | 15 |
| S-F16 | dev-eval | 610/740 | 91.22% | 206 |
| S-F16 | challenge | 204/240 | 98.75% | 140 |
| S-F16 | handwritten | 48/60 | 93.33% | 15 |

Unsupported fields are the frozen scorer's `invented` count, not a count of real writes or necessarily fabricated numbers. Resolved-action exact may collapse legal clarification reasons; strict reason correctness is retained below. The six HF/F16 scores are first-offline diagnostics, separate from the 31 matched server reports.

## Reasons and useful records

| Arm | Missing-unit reason | RPE-scope reason | Unknown-exercise reason | Paired positives (same order) | All challenge positives | Invalid reasons / 1,040 |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| H | 10/15 | 0/15 | 15/15 | 14/15, 15/15, 15/15 | 113/120 | 7 |
| T | 4/15 | 0/15 | 15/15 | 14/15, 15/15, 15/15 | 111/120 | 9 |
| S | 9/15 | 0/15 | 15/15 | 13/15, 13/15, 14/15 | 108/120 | 16 |

RPE scope means which reported sets an effort applies to, not the allowed numerical RPE range. Each focus negative and positive requires 14/15; overall positives require 108/120. No reason or useful-record gate was relaxed.

## Paired changes

| Comparison | Set | Both correct | Gained | Lost | Both wrong |
| --- | --- | ---: | ---: | ---: | ---: |
| H->T | dev-eval | 595 | 41 | 18 | 86 |
| H->T | challenge | 189 | 6 | 17 | 28 |
| H->T | handwritten | 45 | 3 | 4 | 8 |
| T->S | dev-eval | 583 | 26 | 53 | 78 |
| T->S | challenge | 183 | 21 | 12 | 24 |
| T->S | handwritten | 43 | 5 | 5 | 7 |
| H->S | dev-eval | 568 | 41 | 45 | 86 |
| H->S | challenge | 189 | 15 | 17 | 19 |
| H->S | handwritten | 46 | 2 | 3 | 9 |

[Catalog summary](catalog-summary.json) retains per-family changes and literal set-field versus exercise-binding diagnostics. [Error contributions](error-contributions.json) reconcile to raw totals; [reason matrices](reason-matrix.json) also cover the two quantization references. These are saved-output diagnostics with zero new model calls.

## Gates and quantization

- S Q8 vs S-HF: 1021/1040 (98.17%) identical parsed outputs; original floor 95%.
- S Q8 vs S-F16: 1024/1040 (98.46%) identical parsed outputs; original floor 95%.
- Failed checks: `challengeExact`, `challengeSchema`, `challengeNoInvented`, `focusNegativeReasons`, `focusPositiveUseful`, `clarificationVocabulary`.
- Truncations: H=1, T=2, S=0, S-HF=0, S-F16=0. Candidate S/HF/F16 must each have zero; controls remain reported.

Safe rejection is separate from useful coverage. The original source-v1 challenge-coverage gate remains. Full source-v1/v2/source-only results are in [summary.json](summary.json). Even a development pass leaves `releaseReady=false`; native activation requires candidate continuous, useful-coverage and physical-device acceptance.

## Recovery and operations

- Complete canonical archive restored and hashed: 135 run files, all eight full weights / 6,140,372,384 bytes, all five 1,040-row streams, source and logs.
- The live source bundle restored at the exact reviewed commit; 46 frozen-source hashes and own-workspace bindings passed. One manually transcribed source hash was wrong; preserved recovery failure led to reading the authoritative checksum file directly. Actual transferred and server bytes matched.
- All 31 frozen server reports recomputed from restored bytes and matched. Six additional reference raw scores and attribution are identified separately, with zero inference.
- Lossless transport carried 1,961,472,779 bytes for eight complete weights. Base, payload and reconstructed full-target hashes were checked; nine transport tests passed locally and remotely. Full canonical restoration remained mandatory.
- Platform OFF verified 2026-10-22T20:33:29.367Z after full restoration; this window's timer was cleared afterward. Instance/assets retained. Original 21:43 UTC work and 22:43 UTC power deadlines were unchanged.
- Opening-to-OFF proxy 110.49 minutes × ¥2.18/h ≈ ¥4.01; not a billing interval or invoice.
- Final root checks after the diagnostic additions: 9 JS + 243 TS, lint zero errors/two existing warnings, production build passed. Exact-head CI is required before merge. UI, approval/write paths, production secrets and native flags are unchanged.

Concurrent weight staging, fixed order and CUDA-versus-CPU inference prevent a controlled speed claim. Per-stream latency and read-only resource samples are in the summary; a sampled GPU maximum is not a continuous peak.

Release CI follow-up: the first result commit's quality job repeatedly waited on the Azure Ubuntu mirror before starting its browser tests. The missing mirror/HTTP timeout setup was extended from the other two browser jobs to this job; tests and job timeout remain unchanged. Final release requires every check on the updated commit, not the partial earlier run.

[Acceptance](acceptance.json) · [Replay](replay-verification.json) · [Run hashes](run-sha256.json) · [Power evidence](power-off.json) · [Frozen protocol](../../train/GPU_V6.md)

## Interpretation and next step

Observed: common alias repair T gains 23 dev cases over historical H but loses 11 challenge cases. Catalog augmentation S recovers nine challenge cases relative to T, while losing 27 dev cases and three useful challenge positives. H→T is not an isolated replication; T→S is the fixed catalog comparison. Neither intervention is sufficient for acceptance.

The [binding audit](binding-attribution.json) distinguishes literal labels from resolved actions. Across 1,040 inputs, T has 16 field-exact literal-name mismatches: 12 different available identities, three resolved-equal cases and one unresolved implicit action. S has 34: 23 different available identities, nine resolved-equal cases and two unavailable unknown names. The challenge subset contributes 9→12 different available identities. This is a saved-output attribution, not actual writes, and does not change any score. Aliases and selected-action resolution cannot explain away all binding errors.

The unquantized reference scores 205/240 and has 140 unsupported fields; all 15 RPE-scope negatives produce record proposals. F16 behaves similarly. S Q8 proposes records in 14/15 and emits invalid schema in one. Quantization passes its original agreement floor but cannot fix the underlying semantic decision. Missing-unit S Q8 gives nine correct reasons, five records and one invalid-schema response. Guards reject unsafe proposals; that is not useful model acceptance.

The [training-only inventory](training-inventory.json) regenerates the exact reviewed training bytes and rechecks all 12,800 arm rows: zero policy errors, 246 RPE-scope and 261 missing-unit clarification labels per arm, and 517 multi-set RPE records (252 each-set / 265 last-set). No training row or label was changed. S spreads target positions more widely; improved exposure alone did not produce reliable binding. Training retains V2's prose instructions while inference appends the ten legal reason tokens. That mismatch was an intentional v4 factor, not a newly proven cause; it remains an independently testable hypothesis.

Next CPU work is a versioned training/inference contract comparison: hold sentence, labels, catalog, order, objective and seed fixed; test prompt alignment as a separate factor before changing data again. Require source/tokenizer-bound input checks, unchanged-target audits, small CPU gradient/export checks, fixed evaluator/recovery rehearsals and exact-head CI before another GPU notice. Do not claim the next runner is ready, mix this change with catalog augmentation, or manufacture training examples from any observed failures. The private 20 originals and all derivatives remain excluded. The existing frozen gates continue to apply; candidate continuous-dialogue and physical-device acceptance follow only after development acceptance. Native stays off.

Operational prerequisite: preserved data-disk usage reached 78.57%; a new full window still needs the unchanged 16 GiB preflight. No old model asset was deleted or paid storage added. Prepare and review a backup-backed storage plan before requesting another opening; the server remains off meanwhile.

## Reproducing the additional CPU diagnostics

The original 31-report replay uses the recovered exact reviewed source. The following new post-result scripts run from this result commit and read saved outputs or regenerate the frozen synthetic training set. They perform zero inference and refuse to overwrite reports:

```sh
node --import tsx research/m4-parser/scripts/audit-v6-bindings.ts --run-dir /path/to/restored/run --manifest-sha a003d4bba99e5f0a0a9aa03c0ef38e8d3e9c80887205944808bf426a219409c8 --out /new/binding-attribution.json
node --import tsx research/m4-parser/scripts/audit-v6-training.ts --out /new/training-inventory.json
node --test --import tsx tests/m4-v6-bindings.test.ts
```

Four diagnostic tests cover action/alias distinctions, the frozen resolver's semantics, tamper rejection and exact training-byte recovery. Initial audit-test failures were fixture naming, manifest serialization and substring matching errors; they were corrected without changing product code, model outputs or gates. Current diagnostics and final root checks pass; exact-head CI is recorded separately in the release evidence.

Learning checkpoint: distinguish a shared label repair from catalog augmentation, literal numeric-field accuracy from correct exercise binding, quantization agreement from correctness, and safe refusal from useful record coverage.
