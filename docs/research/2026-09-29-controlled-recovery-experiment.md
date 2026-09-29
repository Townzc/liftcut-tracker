# Recovery-v2: corrected data and controlled continuation experiment

Pre-execution specification, preserved after execution. Results were pending when
this specification was frozen; see the [completed results](2026-09-29-controlled-recovery-results.md).
This realizes
the [reviewed next design](2026-09-29-recovery-review-and-next-plan.md), with the
maintainer's subsequent instruction to keep the already-started replacement
instance running until the experiment and verified backup finish.

## Frozen CPU preparation

108 same-author synthetic scenarios: 48 train, 12 development, 48 reserved test.
All twelve behaviors of a constraint/persona bundle stay in one split. Test
labels are checked with the fixed workflow for realizability, but no test targets
or model test rollouts are generated. This remains a small development study,
not independent external evaluation.

Record/memory IDs depend on a separate identifier seed, bundle and slot, never
future outcomes. Approved/pending/declined/revoked variants have identical
model-visible messages and proposal replies before their user event. Episode
identity hashes only publicly readable context. Full scenario identity remains
in audit metadata, outside model input.

Missing time, missing equipment, missing days, no clarification answer, memory
update, and memory-plus-missing-time are separate conditions. Memory order is
varied; an unconfirmed or expired higher revision acts as a distractor. CPU
permutation/adversarial-name tests validate environment invariance; these tests
are not evidence that the learned model is invariant.

All 108 contract cases pass the scripted workflow. Train-only exports have 324
paired correct decisions and 20 actual clarification targets across three fields.
The recovery version injects 48 bad actions: 20 invalid plans while information
is missing, 12 unapproved writes and 16 unnecessary clarification requests.
Rejected actions are context only, never supervised positive labels.

| Quantity | Clean SFT | Mixed recovery SFT |
| --- | ---: | ---: |
| Seed / epochs | 42 / 2 | 42 / 2 |
| Scheduled decisions | 648 | 648 |
| Optimizer updates | 81 | 81 |
| Supervised tokens | 26,052 | 26,052 |
| Input tokens including targets | 1,144,882 | 1,161,328 |
| Maximum sequence tokens | 2,671 | 2,762 |
| Changed error-context decisions | 0 | 192 |

The correct target tokens match at every sampler position and every optimizer
group. Extra input tokens and elapsed compute are not matched. Two fresh local
preparation directories reproduced the same decisions, prefix transcripts and
token files. The default Anaconda environment has an unrelated NumPy ABI problem;
the existing isolated tokenizer-only `.venv` produced both successful runs without
modifying global packages. Server reproduction must match before launch.

Machine-readable parameters and file digests:
[recovery-preparation-v2.json](../../research/liftcut-agent/reports/recovery-preparation-v2.json).
Pinned model revision remains `cdbee75f17c01a7cc42f958dc650907174af0554`.
QLoRA: NF4 double quantization, BF16 compute, fp32 nonquantized layers,
all-linear r16/alpha32/dropout0, AdamW lr2e-4/weight-decay0, microbatch1,
accumulation8, target-token mean loss per group, gradient clipping1.
The final adapter is predetermined. This bounded 81-update run saves final
adapters only and does not claim exact optimizer/RNG resume.

## Two distinct evaluation panels

Each of unadapted/clean/mixed runs the same 12 normal development episodes and
9 fixed-error continuations: **63 total**, zero test episodes. Greedy decoding,
512 generated tokens per request, context4096, and 24 total environment actions
including prefix actions. No parser repair, new prompt or loss weighting is
introduced in this comparison.

The nine continuation starts are three each of:

- known-field clarification rejection: preview, approved, memory parent tasks;
- invalid-plan rejection with missing information: time, equipment, days;
- blocked unapproved write: pending, declined, revoked.

Every prefix is executed through the normal environment/user simulator. This
reconstructs the proposal, approvals, revocations, call counts and remaining
steps instead of just injecting a text transcript. The first real model request
must match the frozen prefix's next-request digest. Prefix reply provenance is
scripted, usage and latency are zero, and prefix actions are excluded from
autonomous model-error/request/token metrics. They remain in full replay traces.
Synthetic prefix generation is not attributed to the model, even where a legacy
whole-episode score counts an injected error.

First recovery accepts context/memory rereads or a correct equipment search for
known-field rejection; rereads or exactly the missing fields for invalid-plan
rejection; and the observed declined/awaiting_user termination for blocked writes.
Final task success stays primary. Panels are never pooled. Report paired outcomes,
actual writes, autonomous blocked attempts, accepted clarifications, repeated
invalid plans, format failures and actual model usage alongside success.

The development go/no-go thresholds remain those in the reviewed plan. They are
engineering pilot criteria, not significance claims. Only after a useful signal
and a fixed candidate should additional seeds and the reserved test be considered.

## Replacement instance and bounded execution

The retained 4090, Python3.12.3/Torch2.8.0+cu128 environment, nine pinned model
files, eight earlier adapters and the old 976,388,918-byte archive were inspected.
No new model download, package installation, disk expansion or hosted API request
is needed. Direct GitHub clone timed out and a retry failed; a local Git bundle
transfers committed public source and is SHA-verified before checkout. The
incomplete clone is preserved separately; server pushes remain disabled.

The instance was already running during preparation. Container start is estimated
from `ps etimes` and UTC now, not a timezone-sensitive `ps lstart` string. This is
an uptime proxy, not a supplier billing receipt. The maintainer explicitly replaced
the migration-only early shutdown with completion of the formal experiment.
That 20-minute guard was cancelled and a four-hour boot-relative hard guard armed.

At the previous quoted CNY2.18/hour, four hours is **CNY8.72 compute**, within the
existing CNY10 total planning reserve; the new order price/storage invoice is not
independently verified. No deadline is measured anew from training start. Reserve
the final 30 minutes for backup and shutdown, reject a launch with fewer than
100 minutes remaining, and shut down early after successful off-instance backup.
All setup, synchronization and preparation time counts against the window.

Train clean, archive its complete final adapter and training logs immediately;
then train/archive mixed. Those archives can transfer while later phases execute.
Run all three evaluations and the full audit. A third archive contains all rollout
evidence and phase logs. Each archive has exact file sizes/hashes and is restored
off-instance before acknowledging the combined archive-index digest. The controller
then shuts down; an independent deadline guard remains armed if the controller
or SSH disappears. Partial runs retain their failure status, never a complete
three-arm score. SSH closure alone is not provider billing confirmation.

## Reproduction

```sh
python research/liftcut-agent/controlled_recovery.py check
python research/liftcut-agent/prepare_controlled.py --tokenizer-dir TOKENIZER_DIRECTORY --output-dir NEW_PREPARED_DIRECTORY
python -m unittest discover -s research/liftcut-agent/tests -v
python research/liftcut-agent/run_controlled_window.py --model-dir MODEL_DIRECTORY --model-manifest MODEL_MANIFEST --prepared-dir NEW_PREPARED_DIRECTORY --output-dir NEW_RUN_DIRECTORY
```

The last command is a dry run. Actual execution additionally requires
`--execute --shutdown-when-done --booted-at OFFSET_AWARE_START_PROXY` on AutoDL.
Both training and evaluation require a clean committed checkout. Code commit,
model, adapters, prepared hashes and native generations are bound in the audit.
