# Agent research progress and handoff

Last updated: 2026-09-28. Active milestone: **P1 protocol revision implemented;
P2 data/tokenizer preparation verified; live protocol comparison still pending**.
Canonical plan: [research roadmap](AGENT_RESEARCH_ROADMAP.md).
P0 delivery: [PR #7](https://github.com/Townzc/liftcut-tracker/pull/7).
P1 offline delivery and remote check status: [PR #8](https://github.com/Townzc/liftcut-tracker/pull/8).
Model adapter and hosted pilot delivery: [PR #9](https://github.com/Townzc/liftcut-tracker/pull/9).
Full hosted baseline, audit and remote checks: [PR #10](https://github.com/Townzc/liftcut-tracker/pull/10).

## Implemented in the first increment

- [x] Persist the technical roadmap and repository instructions for future sessions.
- [x] Keep personal career preparation in a local, Git-ignored companion document.
- [x] Audit historical measurements and document missing evidence without changing
  reported numerical results. [Audit](research/2026-09-28-evaluation-audit.md)
- [x] Author 30 synthetic **development** seeds across six categories.
- [x] Implement strict proposal evaluation, alternative-valid-answer acceptance,
  missing-result accounting, group overlap checks, and input hashes.
- [x] Implement a deterministic structured-input baseline and JSONL score/export CLI.
- [x] Add regression tests and a Python CI job alongside existing product checks.

## Verification evidence

- Python 3.11.5: `python -m unittest discover -s research/liftcut-agent/tests -v`:
  145 tests passed locally (24 P0, 41 interactive, 31 model, 18 audit,
  14 protocol and 17 data/comparison).
- `python research/liftcut-agent/benchmark/build_dev_seeds.py --check`: authored
  definitions match all 30 checked-in rows.
- `python research/liftcut-agent/run.py validate`: 30 valid cases, all in `dev`.
- `python research/liftcut-agent/run.py baseline`: 30/30 deterministic contract
  checks passed. This is **not model or multi-turn Agent performance**.
  [Saved report](../research/liftcut-agent/reports/proposal-contract-baseline-2026-09-28.json)
- `python research/liftcut-agent/benchmark/build_interactive_seeds.py --check`:
  all 14 authored interactive development fixtures match.
- `python research/liftcut-agent/interact.py run`: fixed workflow 14/14 passed;
  no-memory control 12/14; no-retry control 11/14. These are scripted environment
  checks, **not model performance or training ablations**.
- All 14 saved traces replay with identical observations, state digests and scores.
  [Experiment and artifacts](research/2026-09-28-interactive-environment.md)
- Model adapter: 14/14 offline smoke tasks and replay, through 97 synthetic replies.
- Authorized hosted pilot: `deepseek-flash`, non-thinking, `interactive-008` only:
  1/1 passed and replayed, 8 API calls, one write, no blocked attempts, and recovery
  from the injected response-loss timeout. Reported usage: 15,579 input and 513
  output tokens; conservative rate-based cost estimate $0.0052893, reservation
  $0.0371136 against a $0.30 guard. This is not a reconciled bill or broad model result.
  [Protocol, executed experiment and raw evidence](research/2026-09-28-model-policy.md)
- Full hosted development run: **8/14 passed**, fixed workflow 14/14; 70 API calls,
  129,573 input and 3,769 output tokens, estimated $0.0433947, reserved $0.3177774
  against a $0.75 guard. All 14 raw-response/environment traces replay, including
  failures. Five responses violated the single-call contract; one termination
  label failed without a write. No prompt/grader changes or reruns during the run.
  [Full analysis](research/2026-09-28-development-baseline.md)
- Offline audit of pilot and full run: 78 distinct requests, usage complete,
  combined estimate $0.0486840. Accuracy stays separate per run. This is neither
  a provider bill nor an account balance; duplicated artifacts are rejected.
- Four protocol profiles each completed 14/14 workflow mock tasks through 97
  synthetic responses; all four arms audited and compared offline. The mock emits
  single calls; separate protocol tests exercise accepted/rejected real batches.
- Exported 59 development decision rows from eight verified successful hosted
  episodes; six failed episodes remain excluded. Invalid decisions in otherwise
  successful recovery traces remain context, not positive targets.
- Pinned Qwen3-4B-Instruct-2507 tokenizer revision
  `cdbee75f17c01a7cc42f958dc650907174af0554`: CPU audit verified 104,177 masked prompt
  tokens and 2,766 supervised tokens across 59 decisions; max sequence 2,973/4,096,
  no truncation. No weights or training job. [Pipeline evidence](research/2026-09-28-protocol-and-data-pipeline.md)
- The four-arm paid comparison was blocked before process creation by the local
  execution-policy gate, including after budget confirmation. It has no live
  results or additional spend; the previous 8/14 baseline is unchanged.
- Previous increment's local product checks: `npm test` passed 47 existing tests.
- Previous local `npm run lint`: zero errors; two existing unused-variable warnings in the legacy
  `generate_seed_cases.ts` script.
- Previous local `npm run build`: successful production build, including TypeScript and 21 pages,
  using public placeholder authentication configuration.
- Relative documentation links and `git diff --check` passed. Remote verification
  is recorded by the pull request's `agent-research` and `quality` CI jobs.

The seed suite covers schedule, equipment, time budgets, missing information,
infeasible constraints, and evidence IDs. Catalogue time costs are artificial.
No model/API or paid GPU training was used in the first two increments.

## Implemented in the second increment

- [x] Reset/step/observation/terminal-state contract with bounded agent steps.
- [x] Eight typed tools for context, memory, lookup, clarification, validation,
  preview, confirmed application and termination.
- [x] Separate simulated user events; confirmation bound to preview/context
  versions, revocation, and idempotent application after response loss.
- [x] Highest confirmed unexpired preference revision, with explicit user
  corrections taking precedence.
- [x] Before-call and after-commit timeout injection with bounded workflow retry.
- [x] Full action/observation traces, strict replay and separate reporting of
  attempted invalid calls, blocked writes, tool errors and final outcomes.
- [x] Fixed workflow and intentionally limited controls; checked-in reports and
  full fixed-workflow traces; CI run/replay checks.

## Limitations and open evidence gaps

- The hosted reference has one complete public-development run. Repeated runs,
  trainable small-model comparison, held-out evaluation, SFT, DPO and online RL
  remain pending. Protocol failures prevented five original tasks from reaching
  decisions. The revised protocol has offline evidence only.
- The environment is an in-process synthetic harness. It is not a production
  authorization layer or a sandbox for untrusted Python policies.
- Structured constraints are supplied; natural-language extraction is not measured.
- Evidence IDs are checked for existence, not semantic relevance or entailment.
- The baseline shares constraint helpers with the grader. Regression mutations and
  alternate valid answers test the contract, but are not an independent research
  validation or an expert review of the scenario design.
- All 30 proposal and 14 interactive seeds are public dev data. No independent
  held-out set has been frozen. Interactive requests may describe desired recovery
  behavior; the scripted user is intentionally simple.
- Token usage and latency instrumentation is implemented; mock values are
  synthetic. Repeated live-model reliability remains unmeasured. Fixed-workflow
  controls are not model ablations.
- Historical 293-case results and training artifacts remain unreproduced in this
  increment; follow the audit recovery checklist before using stronger claims.

## Implemented in the third increment

- [x] Native single-function-call model policy; strict JSON parsing without repair,
  truncation/refusal/multiple-call errors and unchanged environment arguments.
- [x] Shared request, output-token and monetary reservation limits; unknown usage
  stops further requests without disappearing from task denominators.
- [x] Credential-redacted raw responses, request histories, model/config identity,
  usage, estimated cost, latency and per-request incremental logging.
- [x] Recorded-response replay rebuilds requests and environment transitions;
  paired fixed-workflow counts and failure categories are reported.
- [x] 14/14 mock tasks and replay through 97 synthetic responses; local loopback
  HTTP and failure tests; credential-free CI smoke and replay.
- [x] Preflighted, executed and replayed a hosted reference pilot for interactive-008
  under the maintainer-authorized $0.30 reservation guard. Saved all eight request/
  response records and the environment trace from a clean source commit.

Detailed protocol, commands and limits: [model adapter](research/2026-09-28-model-policy.md).

## Implemented in the fourth increment

- [x] Committed protocol/config before the full 14-case hosted run; unchanged
  prompt, tools, scoring and task order; preserve all original failures.
- [x] Saved all 70 raw response records and 14 traces from clean source
  `e9ebb2111c09cc8d2b995b52275d8b9ae497eab8`; full offline replay is consistent.
- [x] Diagnosed five initial `get_context` + `get_memories` responses rejected by
  the single-call parser, plus a pending-approval outcome-label failure.
- [x] Added replay-backed report audit and deduplicated spending ledger; no pooled
  task accuracy, mock spending, or zero-cost substitution for unknown usage.
- [x] Added 18 audit regression tests and credential-free CI artifact auditing.

## Implemented in the fifth increment

- [x] Backward-compatible versioned single/read-batch protocols and separate
  pending-approval prompt factor; one tool step per call, no batched mutations.
- [x] Frozen four-arm experiment, aggregate-budget preflight, sequential runner,
  unknown-usage stop, complete-arm audits and paired comparison CLI.
- [x] Offline workflow matrix, historical replay and 14 protocol regression tests.
- [x] Replay-verified decision export, family/persona lineage and positive-target
  filtering; 17 data/comparison tests, including invalid-decision recovery.
- [x] Actual CPU tokenizer/mask check with hash-pinned public files and isolated
  dependencies; optional CI job reproduces the published report without weights.
- [x] Detailed [GPU pilot and budget](research/2026-09-28-small-model-pilot-plan.md):
  proposed 4090/24GB, four-hour maximum, CNY 30 ceiling; not rented or trained.
- [ ] Execute the frozen paid protocol matrix: already authorized aggregate USD
  2.40 reservation, but the execution environment rejected launch twice. Do not
  repeatedly request the same authorization or work around the execution gate.

## Next concrete work

1. Resolve the paid-run execution gate or obtain artifacts from a permitted manual
   run of `protocol_experiment.py live`. Keep the frozen four-arm plan and all
   failures. Audit every arm before interpreting differences. Authorization is
   recorded locally; permission was not the unresolved user decision.
2. Independently review the pending-approval contract and expand grouped scenarios;
   freeze held-out evaluation before dataset generation. The 59 public development
   decisions are only a pipeline smoke sample.
3. Prepare and verify model serving/tool parsing plus a training dependency lock
   for pinned Qwen3-4B-Instruct-2507. Tokenization success is not model inference
   or a completed SFT pipeline.
4. Review the concrete GPU quote and shutdown path before renting the proposed
   four-hour pilot. Measure memory/throughput and validate final-assistant labels
   through an actual optimizer batch before budgeting full Base/SFT experiments.

## Decision log

| Date | Decision | Reason / evidence |
| --- | --- | --- |
| 2026-09-28 | Prioritize environment, evaluation and post-training | Approved technical direction; existing results emphasize output format |
| 2026-09-28 | Build an offline Python proposal contract first | Establish measurable constraints without requiring GPU/API or product migrations |
| 2026-09-28 | Label seed data as development-only | Avoid claiming generalization from fixtures used to implement the evaluator |
| 2026-09-28 | Keep the historical research branch intact; branch from current main | Preserve separate README work and base this increment on the latest product tree |
| 2026-09-28 | Publish technical milestones; keep personal preparation local | Make public research reproducible while retaining private career context |
| 2026-09-28 | Implement the offline P1 environment before any model rollout | Deterministic replay and mutation tests establish the interface before API spending |
| 2026-09-28 | Keep P1 partially complete until an untrained model comparison runs | Fixed-workflow 14/14 only demonstrates fixture coverage and environment behavior |
| 2026-09-28 | Check in complete synthetic fixed-workflow traces | Let readers replay the reported result, including response loss after a committed write |
| 2026-09-28 | Separate API failures and unknown usage from runtime tool errors | Avoid silently retrying paid calls or scoring unavailable usage as zero cost |
| 2026-09-28 | Use a one-scenario hosted reference before broader rollouts | Validate provider compatibility and cost before generating trajectories |
| 2026-09-28 | Preserve a failed full-suite baseline and prioritize protocol compatibility | Five of six failures occurred before task decisions because the model emitted two read calls; the sixth exposed pending-approval label ambiguity |
| 2026-09-28 | Audit complete saved runs before adding costs | Replay and log/report cross-checks prevent accidental missing or duplicated spending; account balance remains unverified |
| 2026-09-28 | Separate batch acceptance from pending-approval instruction in four frozen arms | Distinguish interface changes from instruction changes; preserve original 8/14 result |
| 2026-09-28 | Continue with offline data and CPU tokenizer work after paid launch rejection | No new live claims or spend; the execution gate remained after explicit budget approval |
| 2026-09-28 | Exclude known-invalid decisions from positive recovery targets | Preserve error context for learning repair without teaching the rejected action as a correct target |

## Update protocol

Read this file at the start of a work session. After an increment, record actual
commands/results, current limitations and the next task. Change the roadmap when
evidence or constraints justify it and add a dated reason here. Link each completed
increment to its final GitHub change; do not mark an experiment complete from a
configuration file or intended result alone.
