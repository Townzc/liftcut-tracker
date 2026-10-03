# LiftCut-AgentLab research roadmap

Updated: 2026-10-03 UTC. [G2 complete results](research/2026-10-03-g2-complete-results.md)
restore full tasks2/12→10/12 and repair3/4→4/4, but true infeasible2/4→0/4.
Both original mechanism and candidate gates FAIL; memory24/48 and ID6/12 also
remain below fixed S0. Both new weights and222 native/environment episodes with
439 actual generations were restored; platform OFF is user-confirmed. Compute
proxy CNY3.07 at2.18/hour, not an invoice. G1's failure remains unchanged.

Update 2026-10-03 UTC: [G3 stop-boundary data and gates](research/2026-10-03-g3-stop-boundary-design.md)
are frozen locally (stop_half and stop_all vs the reused, reproduction-checked G2
coverage_mix control). The [memory audit](research/2026-10-03-memory-arrangement-audit.md)
shows training covers only 4 of the record orders D2 uses; all coverage_mix memory
errors fall in unseen orders. The G3 execution chain and drill precede any new opening.

[Next local work](research/2026-10-03-post-g2-next-plan.md) isolates the stopping
boundary: keep normal/repair coverage and move one exposure of each existing
train-only infeasible target behind actual invalid feedback. This is a proposal,
not a ready or executed G3 experiment. Exact CPU coverage, matching, recovery and
Git checks must pass before requesting a new server opening. No additional paid
seed, API, expansion or reuse of the closed G2 opening. Memory latest-valid
selection is a separate shortfall, not silently bundled into stopping training.

The [evidence index](research/RESEARCH_INDEX.md), saved G1/G2 trajectory viewers,
[learning guide](research/AGENT_LEARNING_GUIDE.md), complete review and research
journal are available. All gains and regressions stay visible. No overall adapter
has been promoted; fixed representative seed42 remains unchanged, all48 reserved
tasks remain unused and independent evaluation remains unfinished. Repeated
same-seed development improvements do not establish generalization.

The preparation/execution updates below are historical; current status is above
and in [progress](AGENT_RESEARCH_PROGRESS.md).

Latest preparation update: [G1 seed42 paired-pilot readiness](research/2026-10-02-g1-pilot-readiness.md)
now has two identical CPU preparations, matched41,788 target tokens/126 updates per
arm,222-case evaluation and real archive/receipt contract drills. These are CPU
checks, not new training or performance. Final exact-commit checks and local staged
Git installation precede a new CNY8/150-minute work/180-minute hard window. The
original pilot protection thresholds and48 untouched reserved tasks remain fixed.

Latest model evidence: 2026-10-02 UTC. [Complete fixed-seed42 D2](research/2026-10-02-d2-complete-results.md)
now replays all320 episodes and340 generations with actual original weights.
T improves authorization to12/12 but repairs only1/4; TM attempts3 unapproved
writes, all blocked. The original G1 behavior trigger is met by T's two failed
unknown-evidence repairs. Next is CPU readiness for fresh paired T-control/T-repair
training, followed by a separately opened CNY8 pilot only after frozen preparation,
controller/recovery and exact-commit checks. G1 is not yet a model result.
48 reserved tasks remain unused; no independent generalization claim or promotion.
This D2 run's compute proxy is CNY0.7297; provider-off/actual billing are pending.

Previous milestone record: the original42/43/44 four-arm study is
complete. A subsequent [D2 partial window](research/2026-10-02-d2-partial-results-and-repair.md)
completed S0 only (80 cases/84 generations) before an archive-registration bug.
The data is restored and independently replayed; T/M/TM remain unrun and G1 cannot
be evaluated. Latest-valid-memory position scores16/16,2/16,8/16 expose an S0
development shortfall. Controller/incremental-deployment repairs and a production-path
CPU drill now precede a new complete D2 window; scientific conditions stay fixed,
and prior costs/partial results stay visible. The older readiness statements below
are historical; current details are in progress and the linked review.

The original42/43/44 four-arm study is
complete; [three-seed results](research/2026-10-02-r1-three-seed-results.md) retain
all gains and regressions. S0→T reproduces its local screen3/3, but no treatment
passes all-seed candidate guards. [Next work](research/2026-10-02-post-r1-next-plan.md)
has completed the [CPU shortfall audit and80 D2 contracts](research/2026-10-02-shortfall-audit-and-d2-contracts.md).
Sixteen environment-only clarification interventions separate missing information,
day re-planning and waiting for user input; they are not new model successes.
The [bounded execution/recovery readiness](research/2026-10-02-d2-execution-readiness.md)
is now implemented and exercised with320 CPU oracle episodes, native/token replay,
actual local seed42 weights and simulated shutdown. After final exact-commit CI,
merge and staging, the first CNY5 D2 window was opened but
[failed before model launch](research/2026-10-02-d2-startup-review.md): local
interpreter mismatch and slow/repeated upload exhausted the setup allowance.
Shutdown was requested; compute proxy CNY0.6463, platform billing unconfirmed.
A maintained launcher, verified prefix resume and an additional ten-minute
prelaunch shutdown guard then enabled the partial S0 window described above.
The controller bug is repaired in v2; the scientific conditions and90/120-minute
limits remain fixed. Both failed-window costs stay separate from the next CNY5
reserve; historical06654db is the incremental deployment base, not the next target.
No extra training seed or reserved evaluation. Seed44 is
user-confirmed off, with a reported CNY4.60 run cost.
Earlier stage-specific “next” statements below are historical context.
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
is preserved. [Versioned R1 execution and handoff](research/2026-10-01-coverage-replication-execution.md)
now implement seed pairing, exact provenance, bounded windows and independently
verified local backup receipts. [Seed43 results](research/2026-10-01-coverage-replication-seed43-results.md)
are now complete: normal11/12,11/12,12/12,11/12; read-history consent0/3,3/3,1/3,3/3;
main memory4/8,6/8,2/8,2/8. Both T pairs pass the unchanged original screen, neither
M pair does; T's memory effect changes sign across completed seeds. The124 episodes,
actual weights and409 generations passed local replay. Remote receipt acceptance
and provider shutdown/billing remain unconfirmed after connection loss.
Seed44 remains the next separate window after closure and readiness checks; no
three-seed or generalization claim. Then perform the fixed three-seed review before
conditional D2/G1, frozen-candidate and independent validation. The48 reserved tasks
remain unused; seed42 stays the predetermined representative checkpoint.
The [post-seed43 plan](research/2026-10-01-post-seed43-review-and-next-plan.md)
details what44 can still establish, local receipt-transfer readiness, a common
30-minute budget for new D2 memory/ID cases, conditional G1 and explicit stopping
rules. This is a planning increment, not a new trained model or ready D2 runner.
The subsequent [seed44 local collector increment](research/2026-10-01-seed44-monitor-readiness.md)
now implements and fault-tests receipt publication and fresh restoration. CPU
preparation is verified; previous platform confirmation, final CI and a new
user-opened window remain prerequisites. No seed44 model result exists yet.
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
