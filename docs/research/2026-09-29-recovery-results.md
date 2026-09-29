# Recovery pilot: executed training and identifier-validity correction

The first paired recovery-data GPU experiment completed both training arms and
all 72 original evaluation episodes. During review, category names were found in
agent-visible record and memory IDs. This was a preparation defect missed by the
original tests. **The original scores are contaminated diagnostics, not reliable
held-out results.** No historical raw artifact has been rewritten to hide it.

The [pre-execution plan](2026-09-28-recovery-experiment.md) records the original
design; the [identifier probe plan](2026-09-29-identifier-probe.md) was frozen
before its additional GPU execution. Those are separate from corrected training,
which has not run.

![Recorded training loss and diagnostic success](../../research/liftcut-agent/reports/qwen-recovery-pilot-2026-09-28/figures/recovery-diagnostic.png)

## What actually trained

The source checkout was `4b1d2419e73eb4c99ab1f5bb024221e2c97d57f2`.
Both models start from pinned Qwen3-4B-Instruct-2507, revision
`cdbee75f17c01a7cc42f958dc650907174af0554`, using one RTX 4090 24GB.
There were no hosted-model requests, package installations or new weight downloads.

| Quantity | Ordinary successful SFT | Paired mixed recovery SFT |
| --- | ---: | ---: |
| Seed / epochs | 42 / 2 | 42 / 2 |
| Processed decisions / optimizer steps | 300 / 38 | 300 / 38 |
| Supervised tokens | 12,758 | 12,758 |
| Input tokens | 520,538 | 526,216 |
| Training elapsed seconds | 380.35 | 387.58 |
| Peak allocated GPU memory, GiB | 10.37 | 10.55 |
| Changed adapter tensors | 504 | 504 |
| Saved trainable parameters | 33,030,144 | 33,030,144 |
| Reload maximum logit difference | 0.0 | 0.0 |

NF4 double quantization, BF16 compute, fp32 nonquantized layers; LoRA all-linear
r16/alpha32/dropout0; AdamW learning rate 2e-4, weight decay0, microbatch1 and
accumulation8. Both arms use exactly the same assistant targets at each sampler
position, including the final group of four decisions. The mixed arm has only
75 decisions with changed history out of 300; rejected actions are context,
never positive targets. Its additional 5,678 input tokens are an unmatched
context-compute cost. Both final adapters are F32 safetensors of 132,187,888 bytes.

The final saved adapter configuration is audited semantically: PEFT serialized
the set of target module names in different orders, so configuration-file hashes
differ while normalized configurations agree. Evaluation hashes match the exact
saved files; off-instance weight verification is distinct from public CI, which
has no adapter weights.

## Original category-hinted evaluation: retain but do not promote

| Metric | Unadapted | Ordinary SFT | Mixed recovery SFT |
| --- | ---: | ---: | ---: |
| Passed, all original 24 cases | 2/24 | 21/24 | 20/24 |
| Original dev partition | 0/8 | 7/8 | 7/8 |
| Original test partition, contaminated | 2/16 | 14/16 | 13/16 |
| Clean completions | 2 | 18 | 20 |
| Blocked write attempts | 0 | 0 | 0 |
| Actual writes | 0 | 3 | 3 |
| Requests | 92 | 147 | 141 |
| Input tokens | 162,890 | 243,893 | 232,579 |
| Output tokens | 13,746 | 6,095 | 5,956 |
| Unnecessary-clarification errors | 3 | 6 | 0 |
| Invalid `validate_plan` results | 17 | 6 | 6 |

“Clean completion” is the existing executable metric: passed, no blocked writes,
and no tool errors other than timeouts. An invalid result from `validate_plan`
is a normal successful tool response and is not counted as a tool exception.
Zero blocked writes on 24 cases is not a broad reliability guarantee.

All three partial-clarification cases fail in both SFT arms. They read the
updated equipment memory, skip the missing `max_minutes` question, construct a
plan, receive a `wrong_action` validation result and finish `infeasible`. Ordinary
SFT additionally asks for the nonexistent clarification field `action` after
the validation result. Mixed SFT removes that extra error but does not repair
the task. Its additional failed case is `r1-06-pending`, terminating `previewed`
instead of `awaiting_user`. The paired comparison has one ordinary-only success
and zero mixed-only successes. This does not establish a recovery-data advantage.

The 150 distinct clean demonstration decisions contain only three correct
`request_clarification` targets (2%). Partial-clarification trajectories account
for 27 rows, but most teach other actions. Coverage of the actual clarification
decision is therefore much smaller than the trajectory count suggests. Across
two epochs, clarification targets contribute 150/12,758 supervised tokens
(1.18%); this is a label count, not a measured fraction of gradient contribution. This is
a hypothesis for the shared failure, not a demonstrated cause. Lower training
loss alone cannot resolve it.

The unadapted model has 13 failures with no accepted native tool call and three
truncated outputs. For example, its first apply-intent reply emits a tool schema
with an unmatched closing tag instead of a callable action. The generic
`expected_single_tool_call` error must not be misread as proof of multiple calls.
Its low score includes interface/inference-budget failures; it should not be
described solely as inability to solve planning tasks.

## Post-hoc opaque-ID diagnostic

All three models completed the same 24 tasks again after record and memory IDs
were replaced with opaque hashes. The diagnostic supervisor and fixture source
was `592f357d9c3503656b814fbd213179d6dd7d69b1`; GPU rollouts still used the
unchanged original source and the exact two saved adapters. No training or
hyperparameter changes occurred between the original evaluation and the probe.

| Metric | Unadapted | Ordinary SFT | Mixed recovery SFT |
| --- | ---: | ---: | ---: |
| Passed | 1/24 | 20/24 | 17/24 |
| Reused dev partition | 0/8 | 6/8 | 5/8 |
| Reused test partition | 1/16 | 14/16 | 12/16 |
| Clean completions | 1 | 17 | 17 |
| Blocked write attempts | 0 | 0 | 0 |
| Requests | 111 | 147 | 166 |
| Unnecessary-clarification errors | 1 | 7 | 0 |
| Invalid `validate_plan` results | 36 | 7 | 33 |
| Input tokens | 209,795 | 244,407 | 298,037 |
| Output tokens | 16,862 | 6,084 | 8,331 |

The mixed arm uses more calls and completes fewer tasks than ordinary SFT on this
diagnostic, despite avoiding tool exceptions. This pilot does not support a
recovery-data advantage. It does not show that recovery training generally fails;
these are tiny, same-author, single-seed experiments with contaminated training.

Paired outcomes: 17 both pass, three ordinary-only successes, zero mixed-only
successes and four both fail. All three differences are pending-approval cases:
mixed SFT finishes `previewed` instead of `awaiting_user`. Both SFT arms still
fail all three partial-clarification cases. In two of those, mixed SFT repeatedly
validates an invalid plan and ultimately emits no accepted native tool call,
using 18 requests per case. Its zero tool-exception count conceals 33 invalid
validation results, compared with seven for ordinary SFT. Exception count alone
would give a misleading impression of reliability.

Ordinary SFT newly fails `r1-04-memory_supersession`: it reads the memories but
searches for old `barbell` equipment instead of the confirmed revision's `machine`,
gets a validation rejection, unnecessarily asks about equipment and terminates
infeasible. This exposes sensitivity to identifier wording; the diagnostic does
not establish which removed cue caused it.

## Evidence boundaries

All data are programmatically authored synthetic tasks with shared author,
templates and artificial exercise costs. There is one training seed and only two
original test bundles. Replaying logs proves consistency with the executable
environment, not independent model-provider provenance or actual rental billing.
The prior 14-case pilot uses different cases and must not be merged into this
denominator. A later opaque-ID probe reuses tasks and contaminated-trained
adapters; it cannot retroactively validate the original test design.
The identifier transform also removes memory-ID suffixes `old`/`current` while
preserving explicit revision fields. Differences may reflect loss of those
recency cues, different tokenization or proposal IDs as well as category hints;
the probe does not isolate any one of those causes.

## Audit, backup and shutdown

All **144 episodes** (72 original + 72 opaque-ID) replay locally with matching
observations, actions, terminal scores, raw-generation parsing and accounting.
Training audit checks every cumulative counter, finite gradients/losses, exact
sampler totals, final partial accumulation group, adapter configurations and
training/evaluation hash agreement. Local verification checks the actual two
final adapter files; public CI deliberately verifies logs/metadata without weights.

The 976,388,918-byte full archive has SHA-256
`1e22064f18b1f5d9bd8e77f9210dca59bd441fea883cba078cea1d08f3e53436`.
All **87 inventory files**, including all eight saved adapters (three periodic
checkpoints plus final per arm), were restored and hash/size-verified off-instance.
Large artifacts remain Git-ignored; the public report includes only synthetic
logs, small metadata, derived audits and figures.

Observed container start: 2026-09-28 23:39:52 UTC. Backup acknowledgment was sent
at 2026-09-29 01:20:21 UTC. After the controller was resumed for shutdown, the
remote host closed SSH; a new connection was refused, observed by 01:20:53 UTC.
The final shutdown-command return code, controller acknowledgment-consumption
receipt, provider power state and actual bill were **not** retrieved/independently
verified. Do not turn the SSH observation into a confirmed billing-stop claim.

Transfer throughput initially dropped; the controller was briefly paused during
backup with another bounded resume watcher, while both original independent
shutdown guards retained the **01:39:52 UTC** hard deadline. Throughput recovered;
the complete archive verified before the controller was resumed. This operational
deviation from the five-minute backup-wait plan is preserved in the operator
observation, not hidden inside historical raw logs.

At the user-supplied CNY 2.18/hour quote, container-start-to-refused-probe time is
1.6836 hours, giving **CNY 3.670272** as an upper observation-window compute proxy.
It is not a provider-side cap or reconciled invoice. No disk expansion or paid
hosted-model calls occurred. Separate storage charges remain unverified.

[Public artifact index](../../research/liftcut-agent/reports/qwen-recovery-pilot-2026-09-28/README.md),
[opaque paired audit](../../research/liftcut-agent/reports/qwen-recovery-pilot-2026-09-28/identifier-probe-audit.json),
[operator observation](../../research/liftcut-agent/reports/qwen-recovery-pilot-2026-09-28/operations-observation.json).

The figure was rendered with Matplotlib 3.10.9 (optional analysis dependency) using
`plot_recovery.py`; editable vector output is saved alongside its PNG. All 191
CPU unit tests pass locally. CI additionally reproduces CPU tokenization and
audits the complete published experiment without GPU access or credentials.

## Next experiment: corrected data before larger training

The next CPU preparation should target four training bundles (40 scenarios:
eight existing behavior types plus two additional clarification contexts per bundle),
one development bundle (8) and three freshly authored evaluation bundles (24).
These are design targets, not a frozen or executed dataset. Keep each bundle
entirely within one split. Treat the present 24 evaluated tasks as diagnostics
only; do not relabel them as unseen after editing IDs.

1. Use opaque record/memory identifiers generated independently of outcomes.
   Approval/decline/pending counterfactuals must have identical visible context
   before their user event; use a public-context episode identity so hidden
   labels do not change proposal IDs. Add invariance and adversarial-ID tests.
2. Audit every model-visible observation and demonstration. Require correct
   missing-field requests before plan construction; distinguish unavailable
   information from impossible constraints. Target at least 12 distinct correct
   clarification decisions across different missing fields/replies instead of
   merely counting full trajectories. Add combinations of memory updates and
   partial clarification while preserving the evaluation/prompt contract.
3. Freeze scenarios and manifests before demonstration generation. Replay every
   programmatic target, reject positive targets for invalid actions, and regenerate
   token masks and exactly paired schedules twice on CPU. Do not reuse 12,758 as
   the new token budget; opaque identifiers and new tasks change tokenization.
4. Retrain ordinary and mixed arms from the same pinned base with one fixed seed
   and unchanged optimizer settings. Evaluate the same unadapted reference and
   both final adapters on the fresh 8+24 cases. Do not select checkpoints on test.
5. Primary comparison: paired task success. Report clarification behavior,
   clean completion, blocked attempts, actual writes, protocol failures and
   calls/tokens alongside it. A reduction in errors with no task improvement is
   a narrow behavioral result, not a successful recovery intervention.

Plan another 4090 window only after that offline gate and its measured token/
runtime estimate pass. Provisional limit remains two hours from boot at the
user's CNY 2.18/hour quote (CNY 4.36 compute; CNY 10 total planning ceiling),
with no disk expansion, paid API calls or A800 requirement. If 96 evaluations
cannot fit with a backup margin, reduce the frozen scope before launch or
present a revised budget; do not extend a running deadline. Repeated seeds and
external evaluation follow only after corrected data and a useful within-study
signal. DPO/RL remain deferred.
