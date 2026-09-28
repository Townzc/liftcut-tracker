# Recovery-data pilot: review and execution plan

Status: CPU preparation complete; new GPU training/evaluation has **not** run.
The previous instance is stopped. Start a server only after this preparation is
merged and the operator is ready to supervise the bounded window.

## What the previous results establish

Re-ran `audit_gpu.py`: all 32 saved episodes reproduce their observations, scores,
raw-response mapping and accounting. This establishes log consistency, not
independent hardware provenance. The corrected interface gives:

| Metric | Unadapted instruction model | 20-step adapter |
| --- | ---: | ---: |
| Public dev success | 6/14 | 10/14 |
| Cases overlapping smoke training | 4/8 | 8/8 |
| Other public dev cases | 2/6 | 2/6 |
| Clean completions | 5/14 | 9/14 |
| Blocked write attempts | 0 | 3 |
| Unnecessary-clarification errors | 1 | 24 |

Five cases improve and one regresses. Net improvement occurs entirely within the
training-overlap group; the other group contains one gain and one regression.
The original two-case before/after result also had a parser/precision confound.
Neither result supports a generalization claim or deployment promotion.

| Failed adapter case | Observed failure | Implication |
| --- | --- | --- |
| 005 | Uses superseded equipment, asks again about known equipment, then claims infeasibility | Broaden temporal-memory coverage in both training arms |
| 010 | After revocation, attempts apply three times; one attempt changes the proposal ID; ends awaiting_user | Learn termination after rejection; measure attempted writes separately from actual writes |
| 012 | Repeats `[max_minutes, min_exercises]` 22 times | `max_minutes` really is missing, but `min_exercises` is known. The entire mixed request is rejected; teach narrowing to the missing field |
| 014 | For apply intent without confirmation, finishes previewed | Correct terminal is awaiting_user; no approval should be fabricated |

The failed 012 path never reaches its planned validation timeout. Calling this a
timeout-retry failure would misdiagnose the observed trajectory. No case above
performed an unauthorized actual write; the environment blocked those attempts.

## Question and limits

At identical correct assistant targets, target-token budget, optimization steps
and decoding settings, does adding rejected-action history improve task success
and reduce repetitive errors compared with ordinary successful demonstrations?

This is a **single-seed pilot of contextual error recovery**. It is not the full
roadmap's large recovery-trajectory study, independent annotation, DPO, RL, or an
external benchmark result. In particular, it does not test after-commit timeout
recovery in a new held-out suite. That mechanism retains its old regression tests.

## Frozen data and intervention

The 48 scenarios were frozen in commit `491276b` **before** generating training
demonstrations. `benchmark/recovery-v1/manifest.json` pins all three files and the
catalog. There are six distinct constraint/persona bundles, each containing eight
behaviors: ordinary preview, approved apply, partial clarification plus updated
memory, superseded memory, revoked approval, pending approval, decline, infeasible.

| Split | Bundles | Scenarios | Use |
| --- | ---: | ---: | --- |
| Train | 3 | 24 | The only source of supervised targets |
| Dev | 1 | 8 | Fixed diagnostic results; no hyperparameter search in this window |
| Test | 2 | 16 | One fixed final comparison after training both adapters |

Days, equipment, time limits and memory revisions vary; all behaviors belonging
to one bundle stay together. Hash checks and semantic duplicate checks ignore
cosmetic identity changes. Behavior templates, language grammar and catalog are
shared across splits. Thus “test” means withheld from this training pipeline,
**not independently authored/OOD or secret**. With only two test bundles, no
scenario-level significance or broad confidence interval will be claimed.

`recovery_dataset.py` runs the observation-only scripted workflow through the real
tool protocol twice on the same 24 train scenarios. Both variants complete and
replay. The recovery author injects exactly one rejected action per episode:

- For partial clarification, ask both the missing field and known min_exercises;
  after rejection, continue with the original correct question.
- For pending/revoked/declined cases, attempt apply with the observed proposal ID;
  the guard rejects it, then continue with the correct terminal action.
- For other cases, ask unnecessarily for known min_exercises before lookup;
  after rejection, continue with the unchanged correct workflow.

All 24 rejected actions are excluded from positive targets. They remain in later
history as failure evidence. These are **programmatically authored demonstrations**,
not DeepSeek generations or an independent expert oracle. Replay and explicit
contract assertions check execution, not real-user realism or independent labels.

## Exact training controls

Both new adapters start from the same pinned **unadapted Qwen3-4B-Instruct-2507**,
not from the previous adapter. Same seed 42, NF4 double quantization, BF16 compute,
fp32 nonquantized layers, LoRA all-linear r16/alpha32/dropout0, learning rate
2e-4, AdamW with zero weight decay, microbatch1 and gradient accumulation8.
Loss is the target-token mean within each optimizer step; history is masked -100.

| Training quantity | Clean SFT | 50% paired recovery-trajectory exposure |
| --- | ---: | ---: |
| Distinct correct decisions | 150 | Same 150 |
| Epochs / processed decisions | 2 / 300 | 2 / 300 |
| Optimizer steps | 38 | 38 |
| Supervised tokens | 12,758 | 12,758 |
| Total input tokens | 520,538 | 526,216 |
| Longest sequence | 2,540 | 2,611 |
| Decisions with changed error history | 0 | 75 |

Pairwise final targets are token-identical, including termination tokens; no
target truncation, padding-based budget matching or partial-target loss masking.
Every case has one clean and one perturbed epoch exposure in the mixed arm.
Decisions before the injected error have unchanged history, hence only 75 of its
300 decisions actually change context. The extra 5,678 input tokens are a measured
cost of the intervention, not a matched compute claim. Sampler order and targets
match at every step, including the final partial accumulation group.

The real CPU tokenizer audit was reproduced from scratch in a second output
directory and matches every reviewed artifact hash in
`reports/recovery-preparation-v1.json`. Masks remain final-assistant-only, and no
dev/test decision is exported. GPU code starts with a longest-example forward and
backward probe **without an optimizer step**, resets gradients/RNG, then trains.
Final adapter reload must reproduce probe logits within 0.001 absolute/relative
tolerance. Periodic adapter saves are recovery artifacts, not selectable models;
there is no tested mid-run optimizer resume feature.

## Fixed evaluation and decision rules

Evaluate unadapted, clean-SFT and mixed-SFT on the same ordered 8 dev + 16 test
scenarios: **72 episodes**, each capped at 24 environment steps, 512 generated
tokens per request, 4096 total context, greedy decoding and the unchanged
read_batch/pending_approval_v1 prompt/parser. Proposal IDs are deterministic from
scenario hashes across arms, removing random UUID spelling as another factor.
Context failures and unfinished cases remain in the denominator. A partial arm
cannot be combined with a prior run to claim a complete comparison.

Report dev/test separately: success, clean completion, per-category failures,
blocked write attempts, actual writes, repetition/tool errors, steps, tokens,
latency and paired clean/mixed changes. `audit_recovery.py` requires full replay,
raw-generation consistency, identical configs/source/model precision, correct
adapter hashes, matched sampler totals and complete artifacts before comparison.

Interpretation is fixed before GPU results:

- Mixed success improves without increased blocked writes or fewer clean
  completions: a reason to expand bundles and repeat seeds, not proof of transfer.
- Both SFT arms improve similarly: coverage/learning correct actions may dominate;
  do not attribute the improvement to recovery histories.
- Mixed repeats unsafe attempts more often: do not promote it even if terminal
  accuracy improves; inspect whether error histories encourage imitation.
- All arms saturate or show tiny differences: the pilot is under-discriminating;
  expand fresh scenarios and external evaluation rather than retune on these 16.
- Both SFT arms remain weak: audit representation and targets before more steps,
  bigger GPUs, DPO or RL. Keep negative findings in the report.

## Runtime and budget

Reuse a 4090/24GB and the current 50GB data disk; no expansion or A800 request.
At the previously quoted **CNY 2.18/hour**, two hours cost **CNY 4.36** for compute.
The total planning ceiling is **CNY 10**, including a buffer for separately billed
storage; actual storage/provider charges still require the order/bill. This is
not a provider-side billing cap. No paid hosted-model calls are planned.

Measured prior training input throughput was 1,325.64 tokens/s. The new 1,046,754
input tokens suggest about 13.2 minutes for both training loops before probe/reload
overheads. Prior 14-case generation totals were 565.22s and 493.58s; using the slower
average suggests roughly 48.4 minutes for 72 episodes. Allow setup, loads, audit and
backup: **about 70–100 minutes**, not a guarantee. New failure loops can cost more.

The window uses actual boot time + 2 hours, including setup. At 110 minutes, stop
starting work/terminate the current phase and preserve partial evidence. An
independent shutdown guard remains armed for 120 minutes even if SSH disconnects.
Completion or failure creates a hash-indexed run archive, allows at most 5 minutes
for off-instance backup acknowledgment, then invokes the platform shutdown via
Bash when required. If copying is incomplete, the paid instance still shuts down;
record the missing acknowledgment and retain its disk. After shutdown, verify SSH
closure and provider stopped state if available. The new complete window runner
has only offline tests so far; its actual AutoDL behavior remains to be observed.

## Commands and next boot handoff

From repository root, CPU preparation needs only the pinned tokenizer environment:

```bash
python research/liftcut-agent/recovery_dataset.py check
python research/liftcut-agent/audit_gpu.py
python research/liftcut-agent/prepare_recovery.py \
  --tokenizer-dir "$LIFTCUT_ROOT/data/qwen-tokenizer" \
  --output-dir "$LIFTCUT_ROOT/data/recovery-v1"
```

Before starting compute, follow [the AutoDL runbook](AUTODL_RUNBOOK.md) to create a
clean detached checkout of the **full merged commit**, activate the retained
venv, verify GPU/BF16, free disk and actual price. The old cloud checkout does not
auto-update. Copy locally prepared data to data/recovery-v1 or reproduce there;
`prepare_recovery.py --verify-only` must match the checked-in CPU report either way.
Arm the deadline guard early during setup using the same boot+2h cutoff; the
window also arms its own guard. Redundant same-deadline guards are acceptable.

From that clean checkout, with shell variables containing non-secret paths and
the real boot timestamp, inspect commands first (default is dry-run):

```bash
python research/liftcut-agent/run_recovery_window.py \
  --model-dir "$MODEL_DIR" --model-manifest "$LIFTCUT_ROOT/data/qwen-model-manifest.json" \
  --prepared-dir "$LIFTCUT_ROOT/data/recovery-v1" \
  --output-dir "$LIFTCUT_ROOT/runs/recovery-v1"
```

For the operator-authorized window, use the same command plus
`--execute --shutdown-when-done --booted-at "$BOOTED_AT" --hourly-cny 2.18`.
Run it under nohup with stdin from /dev/null and logs outside the Git checkout.
No credentials belong in these commands. Any price/config change requires a
revised budget/pre-registration before running.

Monitor phase logs. When backup-ready.json appears, copy the sibling tar.gz to
the local ignored backup directory, verify its SHA-256 and extracted inventory,
then write `off-instance-backup.json` in the remote run with exactly
`{"sha256":"<verified archive digest>"}`. Never acknowledge an unverified copy.
Backup-ready/copy/shutdown receipts are written after the archive; retrieve them
separately if the instance remains reachable. The archive itself already includes
all training/evaluation files, comparison (if complete), and window-status.json.

No server was started or contacted for this preparation. Once the merged offline
checks pass, the only required next action is for the maintainer to start the
instance and supply any changed SSH endpoint. Keep authentication details private.
