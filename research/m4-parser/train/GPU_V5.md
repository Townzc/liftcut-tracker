# M4 v5: isolate the training loss reduction

The [v4 result](../results/run-20261022T034000Z-v4/README.md) remains rejected and
closed. Its 138 invented challenge fields include 132 from ambiguous RPE scope.
The coefficient audit found clarification rows were 38.31% of examples but only
16.15% of batch-normalized answer-token coefficients. This is a measurable
imbalance, **not evidence that changing it will improve model quality**.

This new [protocol](protocol-v5.json) tests that hypothesis with a fresh control.
No new data, label, prompt, model size, decoding rule or acceptance threshold is
chosen based on v5 results. The 20 private originals, paraphrases, numeric variants
and outputs are excluded from both training and this diagnostic evaluation.

| Arm | Training | Inference | Role |
| --- | --- | --- | --- |
| H | Completed v4 | Archived D Q8 + enum | Historical outputs only |
| T | Original-base, original token-mean loss | Fresh Q8 + enum | Fresh control |
| S | Same original base, per-example mean loss | Fresh Q8 + enum | **Preselected candidate** |
| S-HF / S-F16 | The same S weights | HF / F16 + enum | Quantization references |

Both fresh trainings use the same 6,400 v4 training rows, 740 dev rows, short SFT
prompt, seed 20261019, two epochs / 800 steps, batch 16, rank 16, lr 0.0002,
512-token maximum and activation checkpointing. Both initialize from the pinned
original Qwen3-0.6B, never H or another fine-tuned checkpoint. The old trainer and
all v4 frozen sources remain byte-equivalent under LF normalization.

T calls the original [trainer](sft.py). S calls its explicitly separate
[variant](sft_sample_mean.py): causal CE is averaged over each example's unmasked
assistant tokens, including EOS, and then over examples. Prompt and padding stay
masked. The [loss function](sample_mean_loss.py) rejects an example with no target
tokens. Dev loss retains its original token-mean definition for both arms.
There is no class/intent weighting or new label heuristic. With these full
16-example batches, clarification's coefficient share would be its row share,
38.31%; both replaced RPE groups would be 120/6400 = 1.875%. These are arithmetic
coefficients, not gradient influence or predicted accuracy.

## Fixed execution and evidence

The [runner](../run_v5.py) performs two trainings, then exactly four new streams
in order T, S-HF, S-F16, S: 1,040 outputs each, **4,160 new predictions**.
H reuses 1,040 archived outputs with file/input/token hashes checked. All arms use
the same enum input bytes and token IDs. Evaluation remains the **observed** 740
dev + 240 challenge + 60 handwritten examples; it is not independent generalization.
Decoding stays greedy, 256 new tokens, four GGUF generation/prefill threads and
reset KV. HF uses CUDA; GGUF remains server CPU evaluation, not a phone benchmark.

Report H→T replication differences, T→S paired gains/losses by split/family,
H→S historical changes, invalid reasons, correct clarification reasons, false
refusals, invented fields, guarded safety/coverage and source-only comparisons.
H timing is historical and cannot serve as a new speed control. A single seed
does not establish robust causal/generalization performance. Preserve every
output, including regressions, failed schema and truncation; do not repair/retry.

S alone must meet the original numeric gates: agreement ≥95% against **both** HF
and F16; challenge exact ≥90%, schema ≥99%, invented fields 0, guarded unsafe 0,
and original source-v1 challenge coverage ≥90%. Strict-reason gates remain
≥14/15 in each target negative family, ≥14/15 in each paired positive family,
≥108/120 in all positive challenge examples, and zero invalid clarification
reasons across all 1,040 items. Legal-but-wrong reasons or all-clarify cannot pass.

The truncation scope is declared **before v5 outcomes**: S Q8, S-HF and S-F16
must each have zero truncations. V4's aggregate check covered all cells; v5 keeps
the known failed historical H and fresh control T as reported controls, outside
this candidate-format check. This does not rewrite v4's failure. T cannot replace
a failed S, and passing these observed-set gates still sets `releaseReady=false`.
Continuous candidate acceptance, useful coverage beyond deterministic parsing,
native integration and real-device checks remain necessary. UI, approval and
production model flags stay unchanged.

## CPU evidence and release gates

[CPU preparation](../results/loss-v5-20261022/README.md) includes actual autograd
and tiny random-Qwen checks, two separate two-step SFT/export smokes, exact
1,040-input assembly and historical-byte preservation. The smoke base is a saved
v1 merged model for local workflow verification; it is **not** the GPU initialization
or a candidate quality measurement. CUDA/bfloat16 memory and model outcomes remain
unmeasured. Backup tests use byte fixtures and eight staged weight paths; no fake
weights are reported as a trained model.

Before notifying GPU opening: finish exact-head CI (including the new CPU-only
`m4-loss` job), merge as authorized, and restore the reviewed source bundle into
a separate local directory. Recheck source hashes, own workspace bindings and
runner/backup tests there. A green CPU result is not a successful GPU experiment.

## Fresh user-opened window only

The previous v4 instance is OFF. Do not reconnect or treat its old opening, timer,
password availability or deadline as a new authorization. After readiness, notify
the maintainer to open the existing AutoDL RTX 4090 and confirm current connection
details. Use at most **three hours of work plus one hour for backup/shutdown**;
finish early. The known v4 timings suggest roughly 90–120 minutes of work, but S
output lengths and actual v5 performance are unknown. This estimate never extends
the original opening-based deadlines. Schedule a platform shutdown backstop.

The reviewed clean checkout needs its own `@liftcut/core` workspace binding.
Cache requirements are the pinned original base, torch 2.8.0, transformers 5.20.1,
peft 0.21.2, llama-cpp-python 0.3.36 and the hashed converter archive. No downloads.
Require CUDA with bfloat16 support, at least 22 GiB GPU memory and **16 GiB free disk**
on the actual output filesystem. Two sets of v4-shaped weights total about 5.72 GiB;
the budget includes another full 5.72 GiB archive even without weight staging,
1 GiB converter allowance and 3 GiB for source, logs, dependencies and temporary
work (15.44 GiB total, rounded up). The initially proposed 24 GiB guard exceeded
the server's last observed pre-v4 free space; it was corrected before any v5 GPU
opening. Live free space must still pass; no old asset deletion or disk upgrade is
assumed. This operational guard changes no model-quality threshold.
`BASELINE` is the preserved v4 run directory; it is never modified or re-evaluated.

```sh
python research/m4-parser/run_v5.py \
  --cache "$CACHE" --baseline "$BASELINE" --out "$FRESH_OUTPUT" \
  --commit "$REVIEWED_COMMIT" --stop-at "$ORIGINAL_WORK_DEADLINE"
```

GNU timeout bounds child processes. Exit 3 means a failed quality gate, not a
reason to retry. No second seed, candidate switch, enlarged output allowance or
unplanned continuation is permitted. Failures preserve partial logs and outputs.

The [backup helper](backup_v5.py) binds the window ID, reviewed commit and original
work deadline explicitly. After the driver exits, restore/hash-verify all outputs,
logs, source bundle and **eight weight files** (adapter, merged, F16 and Q8 for both
T and S) off-instance. Completed runs must include all five streams; a stopped
partial run stays explicitly partial. The helper neither shuts down nor proves
power-off. Shut down early after verified backup, check the platform shows OFF,
and then clear this window's timer. Retain the instance/assets; do not delete it.
If backup fails, preserve remote state and obey the original shutdown deadline.

```sh
python research/m4-parser/train/backup_v5.py pack "$WINDOW_ROOT" \
  --window-id "$WINDOW_ID" --commit "$REVIEWED_COMMIT" --stop-at "$ORIGINAL_WORK_DEADLINE" \
  --staged "$STAGED_WEIGHT_MAP"
python research/m4-parser/train/backup_v5.py restore "$OFF_INSTANCE_BACKUP" \
  --window-id "$WINDOW_ID" --commit "$REVIEWED_COMMIT" --stop-at "$ORIGINAL_WORK_DEADLINE" \
  --manifest-sha "$VERIFIED_MANIFEST_SHA"
```

Weights and raw private evidence never go into Git. Publishing preparation or
results through the web deployment does not enable the on-device candidate.
