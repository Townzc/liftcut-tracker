# M4 v3 fixed experiment · 2026-10-21 UTC

**Candidate rejected. Native integration stays off.** Quantization agreement passes,
but Q8 challenge accuracy drops from 213/240 to 187/240 and invented fields rise
from 50 to 153 against the previous Q8 on the same inputs. The 20 private scenario
utterances also do not establish full natural-language acceptance.

## What actually ran

- Source `44978c5ec594fa680538b1d5236d1c7110fbd84d`, tree
  `9578a918f9345a99fb82be8c752969d31cf4ee5a`, identical to the nine-check approved
  PR head `7977ef677170bf1eed9f0e6227ef6e6108708a52`.
- One pinned Qwen3-0.6B base, unchanged [v3 data](../../DATA_CARD_V3.md): 6,400 train,
  740 dev, rank 16, batch 16, learning rate 0.0002, seed 20261019, two epochs / 800
  steps, activation checkpointing. No private original or paraphrase in training.
- Training metrics: 346.7 seconds, dev loss 0.04968, peak allocated CUDA memory
  10,258,342,912 bytes. Runner train/export timing is separate: 354.79 / 22.63 seconds.
  This is synthetic-label LoRA SFT, not a newly demonstrated teacher distillation.
- Four arms completed 1,040 predictions each: 740 observed development, 240 observed
  challenge and 60 existing handwritten examples. Same input tokens, greedy decoding,
  no G1, no truncation, no retry or extra candidate. HF used CUDA; GGUF used server CPU
  with four generation/prefill threads. These timings are not phone performance.
- Runtime: torch 2.8.0+cu128, transformers 5.20.1, peft 0.21.2, llama-cpp-python 0.3.36.

## Scoring failure and offline recovery

The original process **stopped during scoring**, after all 4,160 outputs and both
agreement reports were complete. Its cached `node_modules/@liftcut/core` resolved
into an older checkout without `parse-label-grounding.ts`. Data-manifest checks
had passed; the missing scorer was not imported until the end. This was an
operator workspace setup error, not a new model failure or permission to retrain.

The stopped run, exit code 1, log and original hashes remain unchanged. After full
off-instance restore, an isolated copy of the exact frozen source used its own
`packages/core` binding to compute 38 reports and the original acceptance function.
The **three reports already produced on the server** match the offline results;
only absolute gold/prediction path prefixes are normalized. The other 35 reports
were first produced offline, so this is not a claim that 38 server reports matched.
No model call, altered label or scoring threshold was involved in recovery.
See [scoring recovery](scoring-recovery.json) and [original run file hashes](sha256.json).

A subsequent [workspace preflight](../../scripts/check-workspace.mjs) now runs before
base verification or inference in `run_v3.py`. Three filesystem regressions cover
the correct binding, stale equal-byte sources, and missing scoring modules; the
Linux runner test verifies a failed preflight stops before any prediction. This
fix is **after** the recorded experiment and does not rewrite its source version.

## Raw quality

| Arm | Set | Exact | Schema valid | Invented fields |
| --- | --- | ---: | ---: | ---: |
| Previous Q8 | dev | 591/740 | 87.57% | 230 |
| Previous Q8 | challenge | 213/240 | 94.58% | 50 |
| Previous Q8 | handwritten | 51/60 | 90.00% | 12 |
| New HF | dev | 613/740 | 91.76% | 239 |
| New HF | challenge | 187/240 | 92.50% | 155 |
| New HF | handwritten | 46/60 | 90.00% | 17 |
| New F16 | dev | 612/740 | 91.76% | 247 |
| New F16 | challenge | 187/240 | 92.50% | 153 |
| New F16 | handwritten | 46/60 | 90.00% | 17 |
| New Q8 | dev | 610/740 | 91.62% | 243 |
| New Q8 | challenge | 187/240 | 92.50% | 153 |
| New Q8 | handwritten | 47/60 | 91.67% | 17 |

Exact means resolved semantic equality under the frozen scorer; different valid
clarification reasons can resolve equally. Invented counts fields, not incorrect
rows. These known diagnostic sets are not unseen generalization evidence.

Q8/HF agreement is **1,016/1,040 = 97.69%**; Q8/F16 is **1,020/1,040 = 98.08%**.
Both exceed the unchanged 95% threshold. Agreement does not mean the shared answer
is correct. All three new formats regress on challenge quality, so quantization
alone cannot explain the regression.

Paired previous/new Q8 challenge results: 171 both correct, 16 newly correct,
42 regressed, 11 both wrong. On dev, 74 gains coexist with 55 regressions; handwritten
has two gains and six regressions. A net dev improvement does not establish a better
candidate. Known negative challenge families remain weak: missing units 3/15,
RPE scope 0/15 and unknown exercises 2/15. This identifies observed error groups;
it does not isolate a causal training example or justify an unplanned sweep.

## Guard coverage and unchanged gates

| Q8 set | Source-v1 correct/actions | Source-v2 correct/actions | Source-only v2 | Unsafe accepted |
| --- | ---: | ---: | ---: | ---: |
| dev | 242/475 | 242/475 | 258/475 | 0 |
| challenge | 111/120 | 111/120 | 120/120 | 0 |
| handwritten | 13/39 | 31/39 | 38/39 | 0 |

Original checks: same input tokens, raw agreement, no truncation, guarded safety
and challenge coverage **pass**. Challenge exact ≥90%, schema ≥99% and invented
fields =0 **fail**. [Acceptance](acceptance.json) remains `releaseReady: false`.
The source-v2 comparison does not replace the source-v1 gate. Because its guard
only accepts the deterministic source parser's result, this coverage cannot prove
added model utility. Refusing valid reports also has a real usability cost.

## Twenty originals and the application boundary

After the candidate weights were backed up, the predeclared CPU follow-up made
exactly 20 free-decoding calls, 23.25 seconds total, with unchanged original bytes
and no retry. Schema valid: 16/20. Of six literal representable requests, two raw
outputs matched and the semantic guard accepted none. Of 14 requests needing an
Agent workflow, nine delegated; four had invalid schema and one proposed an
unsupported correction. Two erroneous numeric targets and the four invalid outputs
are rejected by the necessary role check. This is a previously observed regression
set, not a fresh blind test, phone benchmark or successful continuous AI dialogue.

A separate continuous PostgreSQL lane replayed the 20 predictions with explicit
**scripted manual approvals**. It exercised same-ID correction, exercise-specific
confirmed load inheritance, pending per-hand units, void and separately confirmed
redo, idempotency and no automatic session end. Its eight fixture rows are not
eight model successes. Originals, snapshots and scripts remain private; only
[aggregate counts and hashes](pilot-summary.json) are published.

The cloud application fix in [PR #151](https://github.com/Townzc/liftcut-tracker/pull/151)
passed all nine CI checks and deployed as `1f367674921600e1384b0c7786781fc98d549a00`.
It binds live workout/standalone drafts to current-report roles and confirmed
correction targets. Existing user confirmation and the minimal UI remain. It is
an application protection, not evidence that this on-device candidate passed.

## Backup, power and next work

- Restored and hashed all **49 run files**, four weights included; the combined
  backup with operational evidence is **3,084,378,205 bytes**. All four output files
  contain 1,040 unique IDs. Scoring recovery used those restored bytes.
- AutoDL was visibly **OFF at 2026-10-22T00:00:09.395Z**, after backup verification.
  The original 01:21 work / 02:21 power deadlines were not extended. The completed
  window's timer was cleared only after OFF. No instance or retained asset was deleted.
  [Power evidence metadata](power-off.json); the console image remains private.
- The observed 22:21–00:00 window is about 99 minutes, roughly ¥3.60 at the supplied
  ¥2.18/hour. This is not a platform invoice or a measurement of actual boot time.
- [Summary](summary.json) includes per-arm metrics, paired changes, latency, training
  and weight hashes. Raw outputs, logs, source bundle and weights are in the verified
  private backup; public aggregate files alone cannot reproduce raw inference.
- Next: connect server-owned pending/confirmed references to the Agent workflow,
  preserve per-hand basis, and validate clarifications, correction and void/redo
  continuously. Diagnose the known data failures with CPU checks before proposing
  another fixed experiment. No automatic training or GPU opening is scheduled.
  Native download/inference and real-device acceptance remain gated.

Learning checkpoint: distinguish model quality, quantization agreement, source
verification and application authorization. A zero unsafe-accept count plus high
agreement can still describe a model that is unusable for natural conversation.
