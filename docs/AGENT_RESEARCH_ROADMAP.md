# LiftCut-AgentLab research roadmap

Updated: 2026-09-29 UTC. Status: approved direction; milestones below are targets.
Current results and the next task live in [research progress](AGENT_RESEARCH_PROGRESS.md).
The remaining first-release schedule and evidence gates are maintained in
[research release criteria](research/2026-09-29-research-release-criteria.md).
The original milestone windows below remain the baseline plan; implementation
is ahead of those dates, while independent evaluation remains unfinished.

## Research question

Can a small tool-using model reliably adjust a plan under changing schedules,
equipment constraints, missing information, and stale preferences? At equal
training-token and inference budgets, do recovery trajectories improve performance
over successful-only demonstrations?

LiftCut provides the domain and eventual demonstration interface. The research
contribution is a measurable loop: **environment → evaluation → trajectories →
training → held-out analysis**. Product work should support that loop.

## Milestones

| Stage | Target window | Deliverable | Exit evidence |
| --- | --- | --- | --- |
| P0: measurement foundation | September 28–October 4 | Historical evaluation audit; 30 synthetic development seeds; executable contracts and rule baseline | Tests, reproducible commands, explicit evaluator limitations |
| P1: interactive environment | October 5–11 | Resettable environment, 6–8 typed tools, fixed workflow and unadapted model policy | Replayable action/observation traces; terminal-state scoring; failure taxonomy |
| P2: trajectory SFT | October 12–25 | Verified rollouts, small-model LoRA SFT, Base/SFT and recovery-data comparison | Validation curves, loss-mask inspection, paired evaluation, cost log |
| P3: first research release | October 26–November 1 | Reproduction bundle, technical report, minimal product demonstration | Results traceable to frozen data/configs; one substantive ablation |
| P4: preference optimization | November | DPO, memory experiments, external tool-use evaluation | Same-context preference audit, SFT/DPO comparison, transfer/forgetting analysis |
| P5: one advanced extension | November–December | Online Agent RL **or** visual document understanding | Verified reward or visual labels, independent evaluation, resource accounting |

Dates guide prioritization, not claims that experiments will produce positive
results. Reduce scope before compromising measurement quality. A negative training
result with a reproducible analysis is a valid outcome.

## Initial task

Adjust a weekly plan to explicit available days, session count, equipment, and time
budget; clarify missing requirements; report impossible combinations; ground
references in supplied records; preview changes before any confirmed mutation.

The initial offline fixtures use **synthetic exercise blocks and artificial time
costs**. They test software constraints, not exercise physiology or clinical safety.
Do not interpret task success as an effective or medically appropriate workout.

P0 evaluates structured proposals only. The offline portion of P1 is implemented
ahead of the target window: 14 interactive development scenarios cover tools,
approvals, memory and retries, with a fixed workflow and replay. The unadapted
model adapter is now implemented, with offline protocol validation, shared budgets
and raw response replay. The first full hosted development run passed 8/14; five
failures were initial multi-call protocol mismatches and one was a terminal-label
mismatch. All records replay. A later 4090 pilot also exercised the trainable
small model; protocol diagnostics and broader grouped evaluation remain. See the
[environment experiment](research/2026-09-28-interactive-environment.md),
[model adapter](research/2026-09-28-model-policy.md) and
[baseline diagnosis](research/2026-09-28-development-baseline.md).

The protocol revision now supports bounded read-only batches and a separate
pending-approval prompt factor. Four offline profiles are verified; the frozen
paid comparison has not executed because of an execution-policy rejection.
P2 preparation includes verified decision export, a real tokenizer/mask audit and
an executed 20-step QLoRA compatibility pilot for pinned Qwen3-4B-Instruct-2507.
The paired recovery pilot has since executed, but review found category-bearing
record/memory IDs in all 48 original scenarios. Its high scores do not establish
reliable held-out performance. This motivated corrected model-visible data and
fresh evaluation before more training; see the [result review](research/2026-09-29-recovery-results.md).
The [deeper review and next design](research/2026-09-29-recovery-review-and-next-plan.md)
now separates clean-start task performance from controlled error-prefix recovery.
Its 48 train / 12 dev / 48 reserved test tasks are now frozen and CPU-reproduced.
The [corrected development experiment](research/2026-09-29-controlled-recovery-results.md)
has now completed: U/C/R normal 0/12, 10/12, 11/12; controlled continuation 1/9, 8/9, 9/9.
The paired recovery gain of one case in one error family misses its preregistered
gate. The subsequent [fixed-state diagnostics](research/2026-09-29-state-diagnostic-results.md)
completed 38 continuations: C/R consent 5/10 and 6/10, memory 2/9 and 1/9.
These first-decision development probes expose history and memory sensitivity.
A retrospective training-coverage audit motivates a
[2×2 state-coverage study](research/2026-09-29-state-coverage-next-plan.md);
its four arms have now trained with 41,788 matched target tokens and 126 updates each.
[Completed results](research/2026-09-29-state-coverage-results.md): normal S0/T/M/TM
10/12, 9/12, 11/12, 9/12; read-history consent 0/3, 3/3, 1/3, 2/3; main memory
6/8, 4/8, 3/8, 5/8. Only S0→T passes T screening; M fails both pairs. TM adds
three blocked unapproved-write attempts and is not a reliability promotion candidate.
All 124 episodes and actual weights were restored; 407 generations pass token replay.
Next: [follow-up design v2](research/2026-09-29-followup-experiment-design-v2.md) retains
four-arm seed43/44 replication, separates screening from candidate admission, adds
counterbalanced value/position/identity diagnostics, and conditionally tests one
feedback-repair data factor. The [original replication proposal](research/2026-09-29-coverage-replication-plan.md)
is preserved; new runners still need CPU/Git preparation. Original gates remain
unchanged. Frozen-candidate and independent validation follow; no new training,
reserved evaluation or paid API call is part of the design-only increment.
The [research journal](research/EXPERIMENT_LOG.md) records what changed, why,
actual outcomes and learning checkpoints. Reliable held-out and independent
evaluation remain pending. See the
[data pipeline](research/2026-09-28-protocol-and-data-pipeline.md),
[GPU pilot evidence](research/2026-09-28-gpu-pilot.md) and
[budget plan](research/2026-09-28-small-model-pilot-plan.md).

## Data and evaluation policy

- Start with 30 authored proposal seeds and 14 interactive seeds. These are public
  development data, never a frozen or unseen test set.
- Target roughly 100 development and 150 independently constructed test scenarios
  for the first model experiments, subject to audit quality and cost.
- Assign user/template/task-family groups before generating completions or
  trajectories. Do not distribute paraphrases or variants across splits.
- Audit all model-visible identifiers and text for hidden outcome hints. Paired
  approval/decline counterfactuals must have equal observations before their user
  event. Metadata and proposal identities must not reveal future labels. A split
  hash or lack of duplicate tasks does not establish absence of label leakage.
- Freeze test manifests and hashes. Tune on development data; if test errors inform
  changes, construct a new test version and disclose the reuse.
- Score final task state using executable rules wherever possible. Separate raw
  model decisions from runtime repair, blocked actions, and final accepted output.
- Count missing predictions, timeouts, parse errors, and failed tools in the
  denominator. Reject invalid evaluation files rather than silently dropping rows.
- Diagnose interface failures separately from task decisions that were never
  reached. Version protocol/prompt changes, preserve original scores, and never
  attribute adapter or instruction repairs to post-training gains.
- Report task success by category, evidence grounding, unnecessary calls, repeated
  run reliability, P50/P95, and total cost per successful task as those capabilities
  are implemented. P0 evidence checking only verifies IDs, not semantic entailment.
- Use paired comparisons and scenario/group-aware intervals. Record training seeds;
  disclose single-seed experiments when repeated training is not affordable.

## Baselines and experiments

1. Deterministic workflow: checks whether dynamic decisions are needed.
2. Unadapted instruction model (no project-specific SFT) with the same tool interface and budget.
3. The same base model after verified multi-turn trajectory SFT.
4. The same SFT model after DPO using audited preferences.
5. A strong hosted model as a capability reference, not a causal LoRA comparison.

Primary ablation: successful-only vs successful-plus-recovery trajectories at
matched supervised-token budgets; extra input tokens and compute are reported separately.
Evaluate both normal task starts and the same fixed error history across arms;
separate harness-injected errors from the model's subsequent decisions. Additional ablations: structured temporal memory
vs summary/history under matched context budgets; raw vs repaired outputs; data
sampling strategies only when failure analysis motivates them.

Successful trajectories must actually execute. Store model/tool/data versions,
scenario groups, observations, actions, terminal state, failure labels, and costs.
Inspect token masks and chat templates; tool observations are context rather than
assistant prediction targets. Begin with a small compatibility pilot before
scaling data or model size.

DPO pairs should share the same history; when outcomes establish preference,
execute both branches from the same environment snapshot. Do not treat tool
observations from different histories as interchangeable model completions.

Online RL is gated on reproducible resets, reliable rewards, a non-saturated SFT
baseline, and measured rollout cost. Final task success dominates efficiency
rewards. Check early termination, over-refusal, repetition, and reward exploitation.
Offline DPO alone is not online Agent RL experience.

## External validation and optional vision extension

Evaluate a versioned, explicitly identified [BFCL](https://gorilla.cs.berkeley.edu/leaderboard)
tool-use subset for transfer and forgetting. Subset scores are not full leaderboard
scores. [tau2-bench](https://github.com/sierra-research/tau2-bench) is a reference for
interactive environments and outcome evaluation. Respect benchmark licenses and
report modified settings.

The optional visual task is label/screenshot → structured fields → clarification
and controlled recording. Compare OCR+rules, an untrained VLM, and VLM adaptation.
Split by product/template/source, with crops and augmentations kept in one group.
Measure units, numeric fields, uncertainty, and downstream success; an oracle-text
input separates visual extraction errors from policy errors. Unseen food quantities
and health outcomes are not automatic ground truth.

## Implementation and resource decisions

- Python research code lives in `research/liftcut-agent/`, runnable without the web
  application. JSON contracts connect future tools to the existing product.
- Reuse existing product schemas and validation semantics through contract fixtures
  when integrating. Product authorization remains enforced by server code.
- Use a single policy and a small typed tool set first. Add orchestration only when
  a measured failure justifies it.
- Preserve historical LoRA work as a separately labeled baseline. Recover original
  data, configurations, and outputs before declaring its results reproduced.
- The first 4090 QLoRA compatibility pilot ran on 2026-09-28: 20 optimizer steps,
  final-assistant-only labels and identical logits after adapter reload. This is
  pipeline evidence on 59 public development decisions, not a completed P2 data
  study or a held-out improvement. See the [GPU pilot](research/2026-09-28-gpu-pilot.md).
- The [recovery-context pilot](research/2026-09-29-recovery-results.md) executed
  with identical 12,758 supervised tokens per adapter. Visible category hints
  invalidate reliable held-out claims; the later opaque-ID probe remains a
  reused-task diagnostic. Both adapters and all 144 traces were backed up.
- The corrected recovery-v2 executed 36 normal development episodes and 27
  continuations with 26,052 target tokens, 648 decisions and 81 updates per SFT arm.
  All 63 episodes and both adapters were backed up and re-audited before the
  shutdown acknowledgment. Compute proxy through the connection-refusal observation
  is CNY 5.18, within the four-hour CNY 8.72 compute window; supplier billing is unknown.
- The 38 fixed-state diagnostics completed and were backed up before acknowledgment;
  compute proxy CNY 0.42. Findings and the exact old training pools motivated the
  four-arm coverage study. Its two CPU preparations agree, with 1,008 sampled
  decisions, 41,788 supervised tokens and 126 updates per arm, seed42 only.
  The completed four-arm window restored five archives / 88 files before ACK.
  Connections closed and a follow-up was refused; compute proxy CNY 4.75, below the
  CNY 6.54 cap / CNY 8 reserve, with no independent provider power/billing confirmation.
  Two further three-hour windows for seed43/44 are proposed at CNY 13.08 compute /
  CNY 16 reserve; versioned CPU/Git preparation and updated pricing come first.
- Use [immutable server checkouts and artifact manifests](research/AUTODL_RUNBOOK.md)
  when AutoDL instances change; keep model caches separate and copy critical
  checkpoints off-instance before shutdown/release.
- Measure a small rollout and training pilot before renting substantial compute.
  Record generation, GPU, development evaluation, final evaluation, and storage
  costs separately. Do not start paid jobs without an agreed budget.
- Keep a reproducible Python/training environment, model revision, chat template,
  adapter configuration, seed, dataset hashes, and code commit with every run.

## Review and revision

At each milestone, update [progress](AGENT_RESEARCH_PROGRESS.md) with evidence,
remaining limitations, the next concrete task, and changed assumptions. Plans may
change when experiments or available resources justify it; preserve the reason in
the decision log. Completed tasks and training claims must be backed by artifacts.

The public plan documents technical work. Personal preparation and career details
are maintained locally. Substantial changes go through a work branch, relevant
checks, and then a merge into `main`.
