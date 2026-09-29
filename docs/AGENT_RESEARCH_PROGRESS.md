# Agent research progress and handoff

Last updated: 2026-09-29 UTC. Active milestone: **P2 paired GPU pilot executed;
identifier leakage discovered in recovery-v1; corrected data and reliable held-out
evidence required before scaling training**. The hosted protocol matrix remains pending.
Canonical plan: [research roadmap](AGENT_RESEARCH_ROADMAP.md).
P0 delivery: [PR #7](https://github.com/Townzc/liftcut-tracker/pull/7).
P1 offline delivery and remote check status: [PR #8](https://github.com/Townzc/liftcut-tracker/pull/8).
Model adapter and hosted pilot delivery: [PR #9](https://github.com/Townzc/liftcut-tracker/pull/9).
Full hosted baseline, audit and remote checks: [PR #10](https://github.com/Townzc/liftcut-tracker/pull/10).
Protocol revision, data/tokenizer audit and remote checks: [PR #11](https://github.com/Townzc/liftcut-tracker/pull/11).
Portable AutoDL workspace, GPU pilot and diagnostic evidence: [PR #12](https://github.com/Townzc/liftcut-tracker/pull/12).

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

- Latest increment: 191 local CPU tests pass; all 144 recovery/opaque-probe episodes
  replay, and 87 full-backup files are hash-verified off-instance. See the
  [result review](research/2026-09-29-recovery-results.md). The entries below retain
  their historical verification scopes rather than replacing earlier results.
- Python 3.11.5: `python -m unittest discover -s research/liftcut-agent/tests -v`:
  155 tests passed locally and on AutoDL Python 3.12.3 before shutdown. Subsequent
  offline audit and shutdown-path regressions expand the local suite to 161;
  neither suite needs GPU execution for unit tests.
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
  no truncation. That increment used no weights or training job; the subsequent
  GPU pilot is described below. [Pipeline evidence](research/2026-09-28-protocol-and-data-pipeline.md)
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

- The hosted reference has one complete public-development run. A real 20-step
  QLoRA compatibility pilot and corrected local-model development comparison have
  run; neither establishes generalization. Repeated training, a larger SFT data
  study, external evaluation, DPO and online RL remain pending. The revised
  protocol has local GPU evidence; its paid hosted four-arm matrix remains blocked.
- The environment is an in-process synthetic harness. It is not a production
  authorization layer or a sandbox for untrusted Python policies.
- Structured constraints are supplied; natural-language extraction is not measured.
- Evidence IDs are checked for existence, not semantic relevance or entailment.
- The baseline shares constraint helpers with the grader. Regression mutations and
  alternate valid answers test the contract, but are not an independent research
  validation or an expert review of the scenario design.
- All 30 proposal and 14 original interactive seeds remain public dev data.
  Recovery-v1 freezes 24 train / 8 dev / 16 test scenarios by constraint/persona
  bundles, but all 48 contain category hints in visible record/memory IDs. Its
  original scores are contaminated diagnostics. The opaque-ID probe reuses tasks
  and already-trained adapters; it is not corrected training or independent/OOD
  validation. Shared authorship, behavior templates and catalog also limit claims.
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
  proposed 4090/24GB, four-hour maximum, CNY 30 ceiling. Subsequently executed on
  a maintainer-started instance as recorded in the sixth increment.
- [ ] Execute the frozen paid protocol matrix: already authorized aggregate USD
  2.40 reservation, but the execution environment rejected launch twice. Do not
  repeatedly request the same authorization or work around the execution gate.

## Implemented in the sixth increment

- [x] Connected to the maintainer-started 4090; verified 16 vCPU / 120GiB cgroup
  limits, 50GB data disk, CUDA/BF16 and pinned isolated dependencies.
- [x] Immutable per-commit server checkouts, push-disabled origin, relative cache
  setup, environment inspection and explicit data/run SHA-256 handoff manifests.
  SSH endpoint configuration stays locally ignored; no credentials in Git.
- [x] Downloaded 8.06GB of pinned public model files; checked LFS hashes and
  reproduced the exact 59-decision tokenizer report on server Python 3.12.
- [x] Ran 20 NF4/QLoRA steps in 218.47s; 504 adapter tensors updated, finite loss/
  gradients, 11.50GiB peak allocated memory (23.04GiB reserved), identical logits
  after adapter reload. This is compatibility evidence, not generalization.
- [x] Preserved the initial native-interface defect and its raw outputs; fixed
  mapping of assistant prose plus tool calls without repairing free-form actions.
- [x] Backed up the final adapter, optimizer/RNG state and experiment inputs/logs
  off-instance; verified both archive SHA-256s and all 39 selected artifact hashes.
- [x] Corrected native-interface development replay: unadapted 6/14; adapter 10/14.
  Training-overlap group: 4/8 to 8/8; remaining public dev group: 2/6 to 2/6.
  Adapter adds three blocked write attempts and repeated unnecessary clarifications;
  do not claim generalization or uniformly improved reliability.
- [x] All 32 saved episodes replay; offline audit links raw generations, messages,
  token/report counts, adapter identity and deterministic training sampler totals.
- [x] Executed platform shutdown through Bash at 22:50 UTC; command returned 0,
  SSH closed and a follow-up connection was refused. Approximate GPU fee CNY 1.77,
  no expansion; actual provider bill remains unverified. Added a guard fix for the
  platform's no-shebang shell script; the original timer was not a verified hard cap.

The stopped server retains experiment checkouts `d399e8e` and `ef865ed`. The final
offline audit/runbook/shutdown guard were committed after shutdown. On the next
boot, prepare the reviewed full commit from main before using the updated guard;
do not assume the cloned instance automatically pulled newer GitHub code.

Details, source commits and follow-up design: [GPU pilot](research/2026-09-28-gpu-pilot.md).

## Next concrete work

1. Prepare a corrected dataset on CPU before requesting another server window.
   Audit model-visible identifiers and hidden-outcome invariance, strengthen
   missing-information decisions, and create fresh evaluation bundles. Keep all
   currently evaluated scenarios as development diagnostics.
2. Regenerate/replay paired demonstrations and reproduce token budgets twice;
   freeze the new data/config before training. Do not reuse old token counts after
   identifier or task changes. See the [result review and next experiment](research/2026-09-29-recovery-results.md).
3. Budget from the corrected input/generation estimates. Provisional 4090 limit:
   two hours from boot at CNY 2.18/hour (compute CNY 4.36), CNY 10 total planning
   ceiling, no expansion. Do not ask for a boot until CPU gates and migration
   handoff are ready. Repeated seeds/external evaluation follow a useful signal;
   do not move to DPO/RL on the strength of the contaminated original scores.
4. The separately authorized hosted protocol matrix still needs a permitted
   execution path or manually produced artifacts. Do not bypass the prior tool
   execution gate or repeat the already answered authorization request.

## Implemented in the seventh increment

- [x] Re-audited all 32 prior GPU episodes and diagnosed the four adapter failures.
  Case012 fails before reaching its timeout: one missing field and one known field
  are requested together, causing 22 whole-request rejections.
- [x] Committed 48 grouped scenarios in `491276b` before demonstration generation.
  All labels are realizable by the scripted workflow; cross-split duplicate tasks,
  group overlaps and held-out target exports are rejected. Those checks missed
  category hints inside visible IDs, discovered during the subsequent GPU run.
- [x] Generated and replayed 24 clean + 24 perturbed training episodes offline.
  Excluded 24 rejected decisions from targets while keeping them in later context.
  These are programmatic demonstrations, not new model-generated trajectories.
- [x] Reproduced real CPU tokenization twice: 150 paired correct decisions, exact
  per-target token equality; each arm uses 300 decisions / 38 optimizer steps /
  12,758 supervised tokens. Clean/mixed input totals 520,538 / 526,216; longest
  sequences 2,540 / 2,611. Only 75 mixed decisions change error history.
- [x] Prepared new training, arbitrary ordered dev/test local rollouts, fixed
  three-arm replay/comparison audit, boot-relative deadline, archive/backup
  acknowledgment and completion/failure shutdown. GPU paths remain unexecuted.
- [x] Added CPU regression and tokenizer CI coverage. The complete new AutoDL
  window still needs its first observed execution; offline checks are not GPU proof.

Plan, exact controls, budget and commands:
[recovery-data pilot](research/2026-09-28-recovery-experiment.md).
Implementation: [PR #13](https://github.com/Townzc/liftcut-tracker/pull/13).
CPU CI verified 179 Python tests and reproduced the paired tokenizer/data report;
the local upload archive also has all 13 prepared file hashes verified. No new
GPU or paid API execution is included in this milestone.

## Implemented in the eighth increment

- [x] Ran two fresh QLoRA arms on the retained 4090: 38 steps, 300 decisions and
  exactly 12,758 target tokens each. Both final adapters reload with zero probe
  logit difference. Source `4b1d241`; no package install/weight redownload.
- [x] Found the visible-ID category leakage missed by the previous preparation.
  Preserved original 2/24, 21/24 and 20/24 scores as contaminated diagnostics;
  withdrew reliable held-out claims instead of silently changing historical data.
- [x] Froze opaque-ID fixtures/supervisor in `592f357` before its GPU run, retaining
  the same models and rollout source. Complete probe: unadapted 1/24, ordinary SFT
  20/24, mixed SFT 17/24. All original and probe episodes replay.
- [x] Diagnosed three ordinary-only successes on pending approval, no mixed-only
  success, four shared failures, and 33 mixed invalid-validation results versus
  seven ordinary. Zero blocked writes in either suite does not establish broad safety.
- [x] Verified the full 976,388,918-byte archive and all 87 inventory files on the
  local machine, including eight saved adapters. Kept weights out of public Git.
- [x] Sent verified-backup acknowledgment and resumed the controller for shutdown;
  remote SSH closed and a fresh connection was refused. Estimated compute proxy
  CNY 3.67; provider state/bill and final command return code remain unverified.
  Documented the bounded backup-wait pause; the original two-hour hard cutoff stayed armed.
- [x] Added stricter training/public-metadata audits, identifier invariance checks,
  controller-resume regression tests, archive restoration checks and public CI replay.
  Updated the next experiment to prioritize opaque IDs, recency/approval counterfactuals
  and diverse clarification decisions. New data/CPU gates are not prepared yet.

Analysis and evidence: [recovery result review](research/2026-09-29-recovery-results.md).
Implementation: [PR #14](https://github.com/Townzc/liftcut-tracker/pull/14).

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
| 2026-09-28 | Use the maintainer's existing 4090 at CNY 2.18/hour, without disk expansion | Actual 50GB disk fits pinned 4B weights and pilot checkpoints; no A800 evidence |
| 2026-09-28 | Fix native assistant-content mapping in a separate source commit and rerun diagnostics | Initial pure-tool parser rejected a valid call preceded by prose; keep that failure separate from training effects |
| 2026-09-28 | Reuse the image's Torch in a separate Python 3.12 venv, then reverify CPU artifacts | Avoid global package changes; server token audit matched the original Python 3.11 result exactly |
| 2026-09-28 | Prepare a paired recovery-context pilot before renting more compute | Existing 6/14 to 10/14 gain is entirely net training overlap; three blocked writes and 22 repeated clarification failures motivate the intervention |
| 2026-09-28 | Match every assistant target and sampler position across SFT arms | Isolate error history while exactly matching supervised tokens and optimizer steps; disclose extra context compute and shared-template holdout limits |
| 2026-09-29 | Invalidate reliable held-out claims for recovery-v1 and preserve original results | All 48 fixtures contain visible category hints; preparation tests missed this defect |
| 2026-09-29 | Freeze a bounded post-hoc opaque-ID probe using unchanged trained models | Diagnose identifier sensitivity within the same boot deadline; do not silently retrain or relabel reused tasks as new tests |
| 2026-09-29 | Prioritize data correction and clarification coverage before larger training | Both original SFT arms fail all three partial-clarification cases; mixed data does not improve original task success |

## Update protocol

Read this file at the start of a work session. After an increment, record actual
commands/results, current limitations and the next task. Change the roadmap when
evidence or constraints justify it and add a dated reason here. Link each completed
increment to its final GitHub change; do not mark an experiment complete from a
configuration file or intended result alone.
