# Agent research progress and handoff

Last updated: 2026-09-29 UTC. Active milestone: **four-arm state-coverage study completed,
restored and reviewed; next work is CPU preparation for stability testing**.

| Arm | Complete dev task | Read-history consent | Main memory | Autonomous blocked writes |
| --- | ---: | ---: | ---: | ---: |
| S0 | 10/12 | 0/3 | 6/8 | 0 |
| T | 9/12 | 3/3 | 4/8 | 0 |
| M | 11/12 | 1/3 | 3/8 | 0 |
| TM | 9/12 | 2/3 | 5/8 | 3 |

Only S0→T passes the original T screening gate; neither M pair passes. TM attempts
unapproved writes in three related pending cases, all blocked by the environment;
do not promote TM as a reliability candidate. Complete-task regressions, all paired
gains/losses and descriptive interactions are retained. Single seed42 and reused
development states remain limitations; the 48 reserved tests are unopened.

All four adapters have 126 updates and 41,788 exactly matched target tokens each.
Five archives / 88 files, actual weights and 124 native/environment replays passed
off-instance verification before ACK upload by 08:31:34 UTC. All 407 actual generations
also pass pinned-tokenizer prompt reconstruction/output decoding; no context guards.
The server executed immutable `30fd396` and passed 264 tests. Publication/analysis
code passed **281 local tests in 95.671 seconds**; its changes were not deployed into
the running GPU experiment. Four explicit scripted proposal repairs pass validation
but add zero model successes or writes.

SSH/SFTP closed after ACK; a subsequent connection was refused by the 08:32:21 UTC
observation. ACK consumption, shutdown return and provider power/bill were not
independently observed. Boot-proxy-to-check compute proxy ≈¥4.75 at ¥2.18/hour,
within the three-hour ¥6.54 compute cap / ¥8 reserve; storage unknown and separate.
No server job or connection remains under management; do not reopen for CPU work.

Read the [full results](research/2026-09-29-state-coverage-results.md),
[what/why/result/next journal](research/EXPERIMENT_LOG.md) and
[case walkthrough](research/RECOVERY_STUDY_WALKTHROUGH.md).
Publication and remote checks: [PR #20](https://github.com/Townzc/liftcut-tracker/pull/20).
The [replication proposal](research/2026-09-29-coverage-replication-plan.md) needs
versioned seed43/44 implementation and CPU/CI gates before another server window.
Two proposed three-hour windows imply ¥13.08 compute / ¥16 reserve, not new spending.
[External transfer preflight](research/2026-09-29-external-transfer-preflight.md)
remains a future independent-source validation option; no external dataset/model run.

Previous fixed-state diagnostics are completed, restored and reviewed.
C/R consent decisions: 5/10 and 6/10; memory decisions: 2/9 and 1/9. These are
first-decision development diagnostics, not complete-task or held-out scores.
All 38 continuations replay; 44 actual model generations in that earlier increment.
The 21-file archive was verified locally before acknowledgment; actual v2 adapter
backups were rehashed. SSH/SFTP then closed; provider power/billing remains
unverified. Boot-to-connection-check compute proxy ≈¥0.42 at ¥2.18/hour.
That increment passed 248 local CPU tests; the executed frozen server code passed 240.
Read the [research journal](research/EXPERIMENT_LOG.md),
[results](research/2026-09-29-state-diagnostic-results.md) and
[next design](research/2026-09-29-state-coverage-next-plan.md).
That design has now executed as the four-arm study above; its new results do not rewrite earlier conclusions.
See the [release criteria and schedule](research/2026-09-29-research-release-criteria.md)
for the remaining 3–5 week first-release estimate and evidence gates.

P2 recovery-v2 remains completed and backed up.
U/C/R normal success: 0/12, 10/12, 11/12; controlled continuation: 1/9, 8/9, 9/9.
The recovery gain is one case in one error family, below the preregistered gate.
All 63 episodes replay and 42 archive files, including both actual adapters, were
verified off-instance before the shutdown acknowledgment. Connections closed;
provider power/billing was not independently observed. See the
[results](research/2026-09-29-controlled-recovery-results.md) and
[next diagnostic design](research/2026-09-29-state-diagnostic-plan.md).
The hosted protocol matrix remains pending.
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

- Current publication: all 281 CPU tests pass. All 124 real episodes and 407 native
  generations replay, five archives / 88 files and actual weights were verified off-instance.
  Public inventory excludes weights; tokenizer CI independently checks every saved prompt
  and output ID. Grounding/session-count script repairs explicitly add no model success.
- Previous CPU-preparation increment: all 264 tests pass (16 new). Four training arms execute
  and replay 72 scripted episodes each, with 504 identical correct targets. T/TM
  add 80 context-only reads and 64 terminal/apply targets after reads; M/TM balance
  position × invalidity at eight scenarios per cell (two per training bundle).
  Two independent real-tokenizer preparations match exactly, with target masking,
  sample order and per-update target budgets verified. A synthetic native-response
  fixture audits all 124 planned evaluations and five-archive restore/ack; this is
  CPU contract evidence, not GPU execution. Tests reject altered native text, weights,
  training counters, missing archives, forged comparisons and added blocked-write
  cases hidden by aggregate counts. The bounded controller dry run makes no GPU call.
- Previous increment: all 248 CPU tests pass (8 new). Published synthetic evidence
  has an exact hash inventory, complete native/environment replay and a reproducible
  descriptive review. Tests reject changed evidence and forged review summaries.
  The server executed frozen commit `992ac9a`, passed 240 tests and reproduced the
  diagnostic preparation. All 38 continuations and 21 backup files were verified
  off-instance before acknowledgment. Both actual v2 adapter backups were rehashed.
  A retrospective audit of SHA-matched training pools reproduces missing read-to-finish
  transitions and correlated memory coverage; these are hypotheses, not causal proof.
- Previous increment: all 240 CPU tests pass (25 new). Two independent fixed-state
  preparations match all file, prefix and real-tokenizer hashes. The reference
  contract passes 19/19 and replays; this is scripted verification, not model
  performance. New tests exercise a synthetic 38-state native-response audit and
  archive/restore/ack flow, plus unknown usage, denied writes, complete read-batch
  execution, source-value attribution, tampering, missing cases and deadlines.
  The one-hour controller dry run makes zero GPU calls. Both restored recovery-v2
  adapter weights and configurations match their recorded SHA256. New GPU entry
  points are implemented but have not yet executed on a server.
- Previous increment: all 215 local CPU tests pass, including saved real-episode
  replay, restoration-index, clarification-order and tamper checks. The executed GPU source passed all 208
  server tests and all GitHub checks before launch.
  Two independent local preparations and server preparation matched all frozen
  data/token hashes. All 63 real episodes and raw generations now replay; actual
  adapter hashes and 42 restored files were verified. Publication inventory and
  the complete descriptive review reproduce locally. See the
  [execution specification](research/2026-09-29-controlled-recovery-experiment.md).
- Previous increment: 197 local CPU tests pass; the new forensic report reproduces
  from both previously prepared directories and replays all 144 recovery/probe
  episodes. No new GPU/API execution or adapter-file verification. The previous
  increment verified 87 full-backup files off-instance. See the
  [deeper review and next plan](research/2026-09-29-recovery-review-and-next-plan.md). The entries below retain
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

1. Prepare the [seed43/44 replication](research/2026-09-29-coverage-replication-plan.md)
   on CPU, preserving historical frozen source hashes. Pair all four arms within each seed;
   initialization, sampler order, provenance, backup and ACK must bind seed and arm.
2. Recalculate each window from the completed study's actual timing and transfer costs.
   Proposed two three-hour 4090 windows: ¥13.08 compute proxy / ¥16 reserve at the quoted
   rate, storage separate. Finish CPU reproduction, tests and Git/CI before requesting startup.
   TM's unapproved-write regression is an explicit replication target, not a deployment candidate.
3. Keep the 48 reserved tests unopened and the unmet v2 recovery gate unchanged. Freeze a
   candidate only after stability review, then prepare one-time reserved and independent-source
   evaluation. Preserve the [learning cases](research/2026-09-29-state-coverage-results.md)
   and [journal](research/EXPERIMENT_LOG.md); do not add prompts/data/DPO mid-comparison.
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

## Implemented in the ninth increment

- [x] Recomputed decision-level training coverage: 3/150 clarification targets,
  all for max_minutes and all coupled to memory updates; 75/300 mixed histories
  change, but only 24 are immediately after an error. Injected examples cover
  15 unnecessary clarifications and 9 unapproved writes, zero invalid validations.
- [x] Replayed both suites and distinguished requested from accepted clarification.
  All three ordinary-SFT clarification calls on opaque partial cases are rejected.
  Mixed SFT repeats the identical invalid plan 26 times across the probe.
- [x] Diagnosed masked memory mistakes by grading unchanged recorded plans with
  only the missing fixture answer supplied to the grader. Two ordinary and one
  mixed first plans still violate equipment constraints on the opaque partial
  cases. These are offline counterfactuals, not new model responses or revised scores.
- [x] Added executable limitations for evidence-ID grading and hidden-state-derived
  proposal IDs, and tests protecting counterfactual scope and input immutability.
- [x] Saved a staged next design: 48 train / 12 dev / 48 reserved test targets,
  corrected IDs and separated clarification/memory factors; 36 normal development
  episodes plus 27 controlled continuations, three model arms, explicit go/no-go
  rules, two-hour provisional budget and a 30-minute backup/shutdown margin.
- [x] Added full JSON reproduction to tokenizer CI and corrected stale roadmap
  wording that still described the executed recovery pilot as pending.
- [x] Subsequently completed new data, continuation runner, paired masks and
  measured runtime in the tenth increment below; preserve this design as history.

Evidence and design: [forensic review](research/2026-09-29-recovery-review-and-next-plan.md).
Implementation: [PR #15](https://github.com/Townzc/liftcut-tracker/pull/15).

## Implemented in the tenth increment

- [x] Froze 48 train/12 dev/48 reserved test scenarios with opaque public IDs,
  approval counterfactual invariance and separated missing-field/memory coverage.
- [x] Reproduced 324 paired targets and nine exact error prefixes twice locally
  and once on the server. Both SFT arms consumed 648 decisions, 81 updates and
  26,052 supervised tokens; input context and elapsed compute differ.
- [x] Executed committed source `036dcca` on the retained 4090. Both final adapters
  reload with zero maximum logit difference. All 63 development episodes completed;
  normal and controlled panels remain separate and reserved test usage is zero.
- [x] Recorded C/R paired improvements on memory+clarification and pending recovery.
  Normal pending still fails both. Net recovery +1 in one family misses the
  preregistered +2/two-family gate; no larger training or seed expansion is launched.
- [x] Restored all 42 files from three archives and re-audited actual adapters and
  raw generations before uploading the shutdown ack. SSH/SFTP then closed and a
  reconnect was refused. Compute proxy through that observation is CNY 5.1788;
  supplier power state, shutdown return code and billing were not directly seen.
- [x] Added reproducible publication inventory/review checks to CI and a Chinese
  pipeline walkthrough. Public logs omit all weights; local full backups remain.
- [x] The following increment implemented and froze the 19-state CPU diagnostic design.

Evidence: [results and limits](research/2026-09-29-controlled-recovery-results.md).
Implementation: [PR #16](https://github.com/Townzc/liftcut-tracker/pull/16).

## Fixed-state diagnostic preparation increment

- [x] Implemented 10 consent and 9 memory/clarification states, real tool/user
  prefixes, first-decision scoring, complete read-batch handling and raw replay.
- [x] Matched all files and real tokenizer hashes in two independent preparations;
  19/19 scripted reference contracts pass. No new actual model outputs.
- [x] Added pinned-adapter inference entry, durable per-call evidence, paired
  38-state native audit, one-hour boot deadline and verified archive acknowledgment.
- [x] Verified both local actual adapter weights/configurations; controller dry-run
  starts no GPU process. All 240 local tests pass; tokenizer reproduction is in CI.
- [x] Saved evidence-based first-release milestones and updated the private local
  learning plan without publishing personal career details.
- [x] Executed the short GPU diagnostic window in the following increment (below).

## Fixed-state results and training-coverage review

- [x] Ran 19 states per existing adapter, 44 actual generations, no training or test
  evaluation; C/R consent 5/10 vs 6/10, memory 2/9 vs 1/9. No autonomous blocked
  writes, parsing failures, truncation or context guards occurred.
- [x] Restored and verified the complete 21-file archive and replayed all 38 states
  before acknowledgment. Connection closure observed; provider power/bill unverified.
- [x] Published exact-inventory synthetic evidence, action-level comparisons and
  CI replay. Added a reproducible retrospective audit of the original training pools.
- [x] Both pools have 64 get_context→get_memories targets and no read→finish
  targets; eight memory fixtures confound valid position with invalidity type.
  Observed failures motivate coverage interventions but do not isolate causality.
- [x] Added the persistent research journal and three concrete trace walkthroughs;
  saved a four-arm design with CPU, evaluation and budget gates still pending.

Evidence: [diagnostic results](research/2026-09-29-state-diagnostic-results.md).
Publication and analysis: [PR #18](https://github.com/Townzc/liftcut-tracker/pull/18).

## Four-arm state-coverage preparation

- [x] Expanded only the original training bundles; frozen 72 scenarios per arm.
- [x] Executed and replayed all scripted trajectories; injected reads remain context,
  business states agree, and every correct target is paired across S0/T/M/TM.
- [x] Added a permutation-invariant public identity for the new training study;
  future user decisions do not enter it. Historical data, runners and identities unchanged.
- [x] Independently reproduced actual tokenizer masks and exact four-arm schedules.
  Each arm uses 41,788 target tokens and 126 updates; input compute is disclosed separately.
- [x] Added versioned GPU training/evaluation, paired gates, raw-response audit,
  three-hour controller and five-archive actual-weight restore before acknowledgment.
- [x] All 264 local tests pass; synthetic operational tests are not model evidence.
- [x] Execute all four arms; restore actual adapters and 124 evaluations before ACK.
- [x] Publish exact evidence inventory, 407-generation token audit, paired regressions,
  training curves, five learning cases and four explicitly scripted proposal diagnostics.
- [x] Close the GPU window after verified backup; follow-up connection refused.
- [ ] Prepare independent seeds and frozen-candidate validation; no new server window ready.

Specification: [execution and budget](research/2026-09-29-state-coverage-experiment.md).
Implementation and remote verification: [PR #19](https://github.com/Townzc/liftcut-tracker/pull/19).

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
| 2026-09-29 | Add identical post-error starts and gate test evaluation on development evidence | Reset-only evaluation does not isolate recovery; injected training errors omit invalid validation, and missing information is confounded with memory updates |
| 2026-09-29 | Preserve narrow score definitions and report masked failures separately | wrong_action masks equipment errors; tool exception count misses valid:false; evidence IDs do not enforce citation of selected memory |
| 2026-09-29 | Keep the replacement instance for the full controlled development experiment | Maintainer explicitly superseded migration-only early shutdown; use a boot-relative four-hour CNY8.72 compute proxy within the CNY10 planning reserve, including preparation |
| 2026-09-29 | Prepare recovery-v2 and transfer final adapters during evaluation | 48 train / 12 dev / 48 reserved test, two CPU reproductions, 26,052 matched target tokens per arm; three error types, nine exact prefixes; early per-arm archives reduce late transfer risk |
| 2026-09-29 | Preserve limited positive results without lowering the recovery gate | R gains one normal and one continuation case, but recovery gain is only one case/one family; C already has 8/9 and normal pending still fails both |
| 2026-09-29 | Diagnose fixed consent and memory states before more training | Compare equal previews under changed histories; separate raw context, stale memory and invalid high revision values; 38 planned inference-only continuations after CPU gates |
| 2026-09-29 | Prepare a matched 2×2 coverage intervention after diagnostic failure | Both adapters restart planning after reads; distinct memory values expose wrong-source choices. Exact training pools lack corresponding terminal histories and independent position/invalidity coverage; causality remains untested |
| 2026-09-29 | Maintain a what/why/result/next journal and concrete learning cases | Maintainer requested continuous records to independently understand and explain the project; observations, interpretations and pending experiments stay separate |
| 2026-09-29 | Freeze four matched state-coverage arms before GPU execution | 72 train scenarios/504 paired decisions per arm; actual target sequences identical; context-only reads and memory permutations isolated within the new common data |
| 2026-09-29 | Revise the proposed window from two hours/¥6 to three hours/¥8 | Actual inputs imply about 93 training minutes, 112 with 20% margin; evaluation/setup/backup bring the estimate to about 177 minutes; hard deadline remains boot-relative |
| 2026-09-29 | Keep the narrow T screening result and reject TM promotion | Only S0→T passes; M misses both pairs, and TM adds three blocked unapproved-write attempts; no aggregate score or system interception hides model behavior |
| 2026-09-29 | Reproduce current factors before adding a repair intervention | Single-seed outcomes trade off across task, consent and memory; all-four-arm seed43/44 work remains a CPU preparation proposal |

## Update protocol

Read this file at the start of a work session. After an increment, record actual
commands/results, current limitations and the next task. Change the roadmap when
evidence or constraints justify it and add a dated reason here. Link each completed
increment to its final GitHub change; do not mark an experiment complete from a
configuration file or intended result alone.
