# Agent research progress and handoff

Last updated: 2026-09-28. Active milestone: **P1: model adapter and one-case hosted
pilot delivered; broader model comparison pending**.
Canonical plan: [research roadmap](AGENT_RESEARCH_ROADMAP.md).
P0 delivery: [PR #7](https://github.com/Townzc/liftcut-tracker/pull/7).
P1 offline delivery and remote check status: [PR #8](https://github.com/Townzc/liftcut-tracker/pull/8).
Model adapter and hosted pilot delivery: [PR #9](https://github.com/Townzc/liftcut-tracker/pull/9).

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
  96 tests passed locally (24 P0, 41 interactive and 31 model/transport/CLI tests).
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
- `npm test`: 47 existing product tests passed locally.
- `npm run lint`: zero errors; two existing unused-variable warnings in the legacy
  `generate_seed_cases.ts` script.
- `npm run build`: successful production build, including TypeScript and 21 pages,
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

- A model-policy adapter is implemented and validated offline. Broad live-model
  evaluation, SFT, DPO and online RL remain pending.
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

## Next concrete work: P1 model-policy comparison

1. Evaluate the hosted reference across the remaining development categories with
   an explicit aggregate run budget; keep the single-case pilot separate from a
   broader baseline and account for all requests/failures.
2. Select an accessible trainable small model for the same-base Base/SFT comparison.
   A hosted capability reference is a separate baseline, not a training control.
3. Compare model policies to the fixed workflow on the same tools and step budget. Preserve
   parse failures, timeouts and blocked actions in failure reporting.
4. Expand development families from actual failures and request independent human
   review of task labels. Construct and freeze grouped evaluation before SFT.
5. Only then collect executable success/recovery trajectories for the matched-token
   SFT experiment. No GPU rental is needed for the next adapter implementation.

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

## Update protocol

Read this file at the start of a work session. After an increment, record actual
commands/results, current limitations and the next task. Change the roadmap when
evidence or constraints justify it and add a dated reason here. Link each completed
increment to its final GitHub change; do not mark an experiment complete from a
configuration file or intended result alone.
