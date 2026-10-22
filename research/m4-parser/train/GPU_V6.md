# M4 v6: consistent aliases and controlled catalog exposure

The [v5 candidate](../results/run-20261022T071000Z-v5/README.md) remains rejected.
Its challenge regressions include 12 correct-field/wrong-exercise outputs and
five missing-unit requests turned into incorrect records. The CPU audit also
found 40 training labels calling registered bench aliases unknown. These are
observations, not proof that catalog exposure caused the model errors.

The [versioned policy](DATA_V6.md) fixes those 40 labels in **both** fresh arms.
All 6,400 training sentences remain byte-identical; other labels remain unchanged.
The 20 private originals, paraphrases, numeric variants, outputs and derivatives
are excluded from training and this diagnostic evaluation. No examples are
derived from the observed evaluation failures.

| Arm | Training | Inference / purpose |
| --- | --- | --- |
| H | Archived v4 D; original labels | Cached Q8 + enum; historical reference |
| T | Corrected labels; original training catalogs | Fresh Q8 + enum; control |
| S | Same corrected labels; augmented catalogs | Fresh Q8 + enum; sole candidate |
| S-HF / S-F16 | Same S weights | Quantization references |

Both fresh trainings call the original token-mean [trainer](sft.py), initialize
from the pinned original Qwen3-0.6B and use seed 20261019, two epochs / 800 steps,
batch 16, rank 16, lr 0.0002, 512 tokens and activation checkpointing. Neither
starts from a previous fine-tuned model. The prompt, sentence/label bytes, row
order and 740 dev rows match between T and S. S changes only model-visible
catalog membership/order from a **training-only** pool, seed 2026102206; 6,397
catalogs differ while stated identities and catalog size remain valid.

Membership and order form one augmentation package; their individual effects
are not isolated. The shared label repair is separate from the T→S comparison.
H→T measures the combined difference from the historical setup, not a guaranteed
replication. One seed and observed data cannot establish independent generalization.
Frozen v1–v5 sources, labels and reports remain unchanged.

## Fixed execution and acceptance

The [protocol](protocol-v6.json) and [runner](../run_v6.py) pin source/data/token
hashes, two trainings and four new streams: T, S-HF, S-F16, S. Each contains the
same 1,040 inputs (740 dev + 240 challenge + 60 handwritten), for 4,160 new
predictions. H uses archived bytes. Greedy decoding, 256 new tokens, four GGUF
generation/prefill threads and reset KV remain fixed. HF uses CUDA; GGUF runs on
server CPU. These are not phone latency measurements.

Before model loading, the [input audit](audit_v6_inputs.py) verifies role order,
the exercises/sentence allowlist, paired sentences/targets, complete supervised
tokens and CPU-reviewed token hashes. No history or selected-action hint enters
model inputs. The runner also verifies its own workspace binding, frozen source
hashes, original base and converter hashes, and all generated manifests.

The [summary](../scripts/summarize-v6.ts) reports paired gains/losses by family,
strict clarification reasons, false refusals and invalid reasons. Separate
literal record-field and exercise-binding diagnostics expose correct numbers
assigned to the wrong exercise. Full raw, grounding and source-comparison scores
are retained for H/T/S. No predictions are corrected or silently retried.

Only S can pass: challenge exact ≥90%, schema ≥99%, invented fields 0, guarded
unsafe 0, original source-v1 challenge coverage ≥90%, and Q8 agreement ≥95%
against **both** HF and F16. Each focus family requires ≥14/15 correct negative
reasons and ≥14/15 useful positive records; overall positive challenge exact
requires ≥108/120. Invalid clarification reasons across all 1,040 inputs must be
zero. S Q8/HF/F16 must each have zero truncation. H/T failures remain visible;
T never substitutes for S. Legal but wrong reasons and indiscriminate refusal
cannot pass. Original numeric thresholds are unchanged.

Even a pass records `releaseReady=false`. Candidate continuous acceptance,
useful coverage beyond source-only parsing, native integration and physical-device
acceptance remain pending. UI, confirmation/write paths and model flags stay unchanged.

## CPU and source readiness

[CPU evidence](../results/catalog-v6-20261022/README.md) records full paired token
audits, two two-step CPU train/export smokes, input/backup/runner mutation tests
and 1,040-input scoring assembly. CPU smokes use saved **v1 merged** weights only
for workflow verification; they do not test original-base GPU training or quality.
Historical H cloned into T/S for report replay is not new candidate prediction.

Before notifying opening, require every exact-head CI check, authorized merge,
and actual restoration of full/incremental reviewed-source bundles into separate
directories. Recheck pinned hashes, own-checkout `@liftcut/core`, generated data
and runner/input/backup tests there. CPU success is not a trained-model result.

## A fresh user-opened GPU window

The last v5 server is OFF. Old credentials or deadlines do not authorize a new
connection. After readiness, ask the maintainer to reopen the AutoDL RTX 4090
and confirm connection details. Work is bounded by opening + **three hours**;
reserve the fourth hour for backup and shutdown, finishing early when possible.
Record both deadlines and a platform shutdown backstop before starting. No
retry, second seed, candidate substitution, extra acceptance calls or longer cap.

Use the cached original base/runtime (torch 2.8.0, transformers 5.20.1, peft
0.21.2, llama-cpp-python 0.3.36 and hashed converter); no downloads. Require CUDA
with bfloat16, ≥22 GiB GPU memory and **≥16 GiB live free space on the output
filesystem**. This includes two weight sets and a full archive duplicate. Prefer
a new directory on `/root/autodl-tmp`, separate from cached work, baseline and
checkout; the old root-filesystem free-space observation predates v5 outputs.
Do not assume free space, delete old assets or upgrade storage. Stop on a failed
preflight. The saved v4 baseline is read-only historical input.

```sh
python research/m4-parser/run_v6.py \
  --cache "$CACHE" --baseline "$BASELINE" --out "$FRESH_OUTPUT" \
  --commit "$REVIEWED_COMMIT" --stop-at "$ORIGINAL_WORK_DEADLINE"
```

GNU timeout bounds children; exit 3 is a failed quality gate, not a retry request.
Preserve failed/partial outputs. The [backup helper](backup_v6.py) binds the new
v6 window ID, commit and original work deadline. Restore and hash-verify all
outputs, logs, source bundle and **eight weights** (adapter, merged, F16, Q8 for
both T/S) off-instance. A completed run requires five full streams; a partial
run is explicitly partial. The helper itself does not power off or prove OFF.

```sh
python research/m4-parser/train/backup_v6.py pack "$WINDOW_ROOT" \
  --window-id "$WINDOW_ID" --commit "$REVIEWED_COMMIT" --stop-at "$ORIGINAL_WORK_DEADLINE" \
  --staged "$STAGED_WEIGHT_MAP"
python research/m4-parser/train/backup_v6.py restore "$OFF_INSTANCE_BACKUP" \
  --window-id "$WINDOW_ID" --commit "$REVIEWED_COMMIT" --stop-at "$ORIGINAL_WORK_DEADLINE" \
  --manifest-sha "$VERIFIED_MANIFEST_SHA"
```

After backup verification, shut down early and confirm platform OFF before
clearing the window timer. Retain the instance/assets. If transfer fails, retain
remote state and obey the original shutdown deadline. Weights/private evidence
never enter Git; publishing preparation does not enable the candidate.
