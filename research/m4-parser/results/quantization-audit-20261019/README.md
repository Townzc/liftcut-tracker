# Saved-weight quantization diagnosis · 2026-10-19

Q8_0 passes the original 95% raw parsed-JSON agreement gate. **Model quality still
fails**: this preserves the old model's mistakes and does not enable native use.

| CPU variant | Agreement with original HF | Agreement with f16 | Size (decimal MB) | Truncated |
| --- | --- | --- | --- | --- |
| f16 | 1055/1060 (99.53%) | 1059/1060 (99.91%) | 1198.2 | 0 |
| Q4_K_M | 941/1060 (88.77%) | 942/1060 (88.87%) | 396.7 | 1 |
| Q8_0 | 1047/1060 (98.77%) | 1047/1060 (98.77%) | 639.4 | 0 |

An invalid JSON answer is not counted as agreement even with itself, explaining
the f16 self-comparison. The strict canonical-JSON diagnostic and the original
`consistency.py` gate agree on these counts; neither uses guarded output.

All 3,180 new CPU predictions use the saved v1 weights and the same 1,060 old
dev/test/handwritten inputs. A 120-dev pilot preceded the full run. The full
protocol, including conditional Q8 if Q4 fails against either reference, was
written before inference. The frozen [script](../../train/compare_gguf.py) matches
the protocol SHA-256. [Full metrics and hashes](report.json) bind input/reference
files, all weights and predictions. Q8 SHA-256:
`feb3524756122be6b8df2c5dcf8afae12374ff348ff7241aa2cb54bb89a1a8e7`.

Runtime: i7-13650HX, WSL Linux, llama-cpp-python 0.3.36, four decode and prefill
threads, greedy, explicit repetition penalty 1, zero frequency/presence penalties,
256 new-token limit, KV reset per item. HF and GGUF token IDs match for every
input, without an added BOS. Full elapsed time: 3,527.3 seconds. Other validation
work ran on the same laptop, so recorded latencies are diagnostic only, not a
controlled speed comparison or phone measurements. Threads, token input and
state changed together versus the original run; their individual effects are not
identified. The original 946/1060 Q4 result remains unchanged in its own report.

## Why this is not release-ready

| Variant | Dev exact / invented | Old test exact / invented | Handwritten exact / invented |
| --- | --- | --- | --- |
| f16 | 495/500 / 9 | 377/500 / 141 | 50/60 / 12 |
| Q4 | 485/500 / 3 | 374/500 / 164 | 46/60 / 13 |
| Q8 | 495/500 / 12 | 376/500 / 141 | 50/60 / 12 |

The `source-v1` guard yields zero unsafe accepted outputs and zero invented
fields across these 3,180 predictions. However, Q8 old-test accepts only 206
actions and rejects 92 otherwise-correct answers; handwritten accepts 14 and
rejects 19 correct answers. Safety must be read alongside coverage. The bounded
grammar is itself a parser; no extra capability over an updated rules baseline
is established. These are previously seen diagnostic cases, not independent
human validation. The generated handwritten gold has different byte formatting
from the source file; all 60 JSON objects are identical.

The next [fixed v2 window](../../train/GPU_V2.md) trains from the original base
with 6,400 examples and an old-weights/new-prompt control. Q8 is fixed before any
new challenge inference, and the new weights must re-pass all gates. The current
Q8 result cannot substitute for that future comparison. Independent natural
language, guard coverage, native integration and real-device acceptance remain
pending. No new GPU was opened, and no product activation or UI change occurred.

Raw predictions, logs, component smoke outputs, old/new weights and restored
evidence remain outside Git in the local `2026-10-19-m4-grounding` deliverable.
Replay each split with `scripts/evaluate.ts` and `scripts/evaluate-grounding.ts`;
the original gate uses `train/consistency.py` against saved HF and f16 predictions.
