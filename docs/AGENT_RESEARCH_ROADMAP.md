# LiftCut-AgentLab research roadmap

Updated: 2026-09-28. Status: approved direction; milestones below are targets.
Current results and the next task live in [research progress](AGENT_RESEARCH_PROGRESS.md).

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
| P1: interactive environment | October 5–11 | Resettable environment, 6–8 typed tools, fixed workflow and untrained model policy | Replayable action/observation traces; terminal-state scoring; failure taxonomy |
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
approvals, memory and retries, with a fixed workflow and replay. The untrained
model adapter is now implemented, with offline protocol validation, shared budgets
and raw response replay. Broad model comparison remains pending; P1 is not fully
complete. See the [environment experiment](research/2026-09-28-interactive-environment.md)
and [model adapter](research/2026-09-28-model-policy.md).

## Data and evaluation policy

- Start with 30 authored proposal seeds and 14 interactive seeds. These are public
  development data, never a frozen or unseen test set.
- Target roughly 100 development and 150 independently constructed test scenarios
  for the first model experiments, subject to audit quality and cost.
- Assign user/template/task-family groups before generating completions or
  trajectories. Do not distribute paraphrases or variants across splits.
- Freeze test manifests and hashes. Tune on development data; if test errors inform
  changes, construct a new test version and disclose the reuse.
- Score final task state using executable rules wherever possible. Separate raw
  model decisions from runtime repair, blocked actions, and final accepted output.
- Count missing predictions, timeouts, parse errors, and failed tools in the
  denominator. Reject invalid evaluation files rather than silently dropping rows.
- Report task success by category, evidence grounding, unnecessary calls, repeated
  run reliability, P50/P95, and total cost per successful task as those capabilities
  are implemented. P0 evidence checking only verifies IDs, not semantic entailment.
- Use paired comparisons and scenario/group-aware intervals. Record training seeds;
  disclose single-seed experiments when repeated training is not affordable.

## Baselines and experiments

1. Deterministic workflow: checks whether dynamic decisions are needed.
2. Untrained base model with the same tool interface and budget.
3. The same base model after verified multi-turn trajectory SFT.
4. The same SFT model after DPO using audited preferences.
5. A strong hosted model as a capability reference, not a causal LoRA comparison.

Primary ablation: successful-only vs successful-plus-recovery trajectories at
matched training-token budgets. Additional ablations: structured temporal memory
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
