# Agent research progress and handoff

Last updated: 2026-09-28. Active milestone: **P0 measurement foundation**.
Canonical plan: [research roadmap](AGENT_RESEARCH_ROADMAP.md).

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
  24 tests passed locally.
- `python research/liftcut-agent/benchmark/build_dev_seeds.py --check`: authored
  definitions match all 30 checked-in rows.
- `python research/liftcut-agent/run.py validate`: 30 valid cases, all in `dev`.
- `python research/liftcut-agent/run.py baseline`: 30/30 deterministic contract
  checks passed. This is **not model or multi-turn Agent performance**.
  [Saved report](../research/liftcut-agent/reports/proposal-contract-baseline-2026-09-28.json)
- `npm test`: 47 existing product tests passed locally.
- `npm run lint`: zero errors; two existing unused-variable warnings in the legacy
  `generate_seed_cases.ts` script.
- `npm run build`: successful production build, including TypeScript and 21 pages,
  using public placeholder authentication configuration.
- Relative documentation links and `git diff --check` passed. Remote verification
  is recorded by the pull request's `agent-research` and `quality` CI jobs.

The seed suite covers schedule, equipment, time budgets, missing information,
infeasible constraints, and evidence IDs. Catalogue time costs are artificial.
No model/API or paid GPU training was used in this increment.

## Limitations and open evidence gaps

- No interactive environment, tool execution, approval state, temporal memory,
  model-driven policy, SFT, DPO or online RL has been implemented in AgentLab yet.
- Structured constraints are supplied; natural-language extraction is not measured.
- Evidence IDs are checked for existence, not semantic relevance or entailment.
- The baseline shares constraint helpers with the grader. Regression mutations and
  alternate valid answers test the contract, but are not an independent research
  validation or an expert review of the scenario design.
- All 30 seeds are public dev data. No independent held-out set has been frozen.
- Historical 293-case results and training artifacts remain unreproduced in this
  increment; follow the audit recovery checklist before using stronger claims.

## Next concrete work: P1 interactive environment

1. Define reset/step/observation/terminal-state contracts, with hidden scoring
   metadata unavailable to the policy.
2. Add narrow read, candidate lookup, validation, clarification, proposal and
   confirmed-application tools. Keep approved proposal versions and idempotency
   keys in the environment, not under model control.
3. Record replayable action/observation trajectories and separate attempted invalid
   actions from runtime blocks and final state.
4. Add stale-preference, missing-information, timeout/recovery and revoked-approval
   scenarios, with deterministic initial states and controlled failure injection.
5. Compare a fixed workflow and an untrained model policy after the offline
   environment passes contract checks; measure API cost before generating data.
6. Construct independently authored grouped evaluation scenarios before SFT.

## Decision log

| Date | Decision | Reason / evidence |
| --- | --- | --- |
| 2026-09-28 | Prioritize environment, evaluation and post-training | Approved technical direction; existing results emphasize output format |
| 2026-09-28 | Build an offline Python proposal contract first | Establish measurable constraints without requiring GPU/API or product migrations |
| 2026-09-28 | Label seed data as development-only | Avoid claiming generalization from fixtures used to implement the evaluator |
| 2026-09-28 | Keep the historical research branch intact; branch from current main | Preserve separate README work and base this increment on the latest product tree |
| 2026-09-28 | Publish technical milestones; keep personal preparation local | Make public research reproducible while retaining private career context |

## Update protocol

Read this file at the start of a work session. After an increment, record actual
commands/results, current limitations and the next task. Change the roadmap when
evidence or constraints justify it and add a dated reason here. Link each completed
increment to its final GitHub change; do not mark an experiment complete from a
configuration file or intended result alone.
