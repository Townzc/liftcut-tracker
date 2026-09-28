# LiftCut-AgentLab: offline evaluation and interactive environment

**Implemented:** 30 proposal development fixtures, 14 interactive development
scenarios, a strict proposal evaluator, eight typed tools, temporal preferences,
user approval transitions, failure injection, fixed workflows and trace replay.
Python 3.11+ standard library only; no GPU, model/API credentials, package
installation or web app needed.

**Also implemented:** a native function-calling model adapter, strict parsing,
shared run budgets, usage/latency records and model-response replay. Its mock
transport needs no credentials. Trajectory training, product integration and
held-out model evaluation remain pending. The offline confirmation state is a
research fixture, not the product's authorization implementation.
See the [roadmap](../../docs/AGENT_RESEARCH_ROADMAP.md) and
[current progress](../../docs/AGENT_RESEARCH_PROGRESS.md).

## Run from the repository root

```sh
python research/liftcut-agent/run.py validate
python research/liftcut-agent/run.py baseline
python -m unittest discover -s research/liftcut-agent/tests -v
python research/liftcut-agent/benchmark/build_dev_seeds.py --check
```

Export a baseline and independently score its prediction file:

```sh
python research/liftcut-agent/run.py baseline --write-predictions research/liftcut-agent/outputs/baseline.jsonl --output research/liftcut-agent/outputs/baseline-report.json
python research/liftcut-agent/run.py score --predictions research/liftcut-agent/outputs/baseline.jsonl
```

Outputs are ignored by Git and never overwritten. Use new filenames for new runs.
`--cases` and `--catalog` accept alternate inputs. Reports include exact input-file
SHA-256 hashes and evaluator version. Exit codes: `0` valid/all passed, `1` scored
task failures, `2` invalid input or command. A valid empty prediction file scores
zero success; omitted individual predictions stay in the denominator. Duplicate
or unknown case IDs and malformed JSON reject the run rather than dropping rows.

## Proposal contract (P0)

Cases contain `id`, `family_id`, `persona_id`, `split`, `category`, `input`, and
`expected_action`. Pass **only `input`** to a policy. Metadata and oracle labels
are evaluator-owned. Inputs already contain explicit structured constraints;
this first benchmark does not measure extracting constraints from natural language.

Three valid prediction shapes:

```json
{"case_id":"seed-001","prediction":{"action":"propose_plan","sessions":[{"day":"mon","exercise_ids":["bodyweight-a","bodyweight-b"]},{"day":"fri","exercise_ids":["bodyweight-a","bodyweight-b"]}],"evidence_ids":["record-001"]}}
{"case_id":"seed-016","prediction":{"action":"request_clarification","missing_fields":["available_days"]}}
{"case_id":"seed-021","prediction":{"action":"report_infeasible"}}
```

No extra prediction fields are accepted. A proposal must match the requested
session count, use distinct available days, include enough distinct allowed blocks,
respect equipment/exclusions, and fit time budgets recomputed from the catalogue.
The grader accepts alternative valid schedules and block choices, not just the
baseline's answer. `null` means missing information; an empty equipment/day list is
known emptiness and may make a task impossible. Clarification must identify exactly
the missing required fields. Infeasibility is determined for this finite toy domain.

When supplied records exist, a proposal must cite at least one existing record ID.
When none exist, no citation is required. This tests **reference existence**, not
semantic relevance, content entailment, chronology or memory retrieval.

## Data card and limits

- Source: 30 authored synthetic scenarios materialized by `build_dev_seeds.py`.
  No real users, health records, external datasets or teacher-model outputs.
- License: repository MIT license. Catalogue IDs and duration costs are artificial
  exercise blocks, not prescriptions or estimates of physiological effort.
- Six development categories, five cases each: schedule, equipment, time budget,
  missing information, infeasible constraints, and evidence IDs.
- All seeds are **development data**. Do not train on variants and report these
  same cases as unseen evaluation. Group checks reject family/persona overlap and
  exact policy-input duplication across splits; they do not detect all paraphrases.
- The deterministic policy directly solves the structured contract. Its 30/30 result
  is an evaluator sanity check, not an LLM, Agent, safety or generalization result.
- The baseline shares low-level constraint helpers with the evaluator. Mutation,
  boundary and alternative-valid-answer tests provide additional checks; independent
  human review and independent evaluation are still needed.
- P0 has no tool failures or multi-turn state. Those are covered by the separate
  interactive contract below. Neither suite measures medical quality or real
  user outcomes.

## Interactive environment (P1, offline portion)

```sh
python research/liftcut-agent/benchmark/build_interactive_seeds.py --check
python research/liftcut-agent/interact.py validate
python research/liftcut-agent/interact.py run --write-traces research/liftcut-agent/outputs/session.jsonl --output research/liftcut-agent/outputs/session-report.json
python research/liftcut-agent/interact.py replay --traces research/liftcut-agent/outputs/session.jsonl
```

Replay the checked-in evidence directly:

```sh
python research/liftcut-agent/interact.py replay --traces research/liftcut-agent/reports/interactive-fixed-traces-2026-09-28.jsonl
```

The fixtures are authored by `benchmark/build_interactive_seeds.py`; all 14 are
public **development data**, not unseen evaluation. `--scenario interactive-008`
selects the write-timeout example. `--policy no-memory` or `--policy no-retry`
disables one fixed-workflow behavior as a harness control; these commands currently
exit `1` because their task failures are intentional.

Run exit codes: `0` all tasks passed, `1` task failures, `2` invalid input.
Replay exit codes: `0` all traces are consistent, `1` missing traces, `2` invalid
or inconsistent traces. **Valid replay does not imply task success**; inspect
`task_passed` separately. Missing traces remain in the total. Duplicate/unknown
IDs, changed input hashes, forged user events, or mismatched observations reject
the replay. Output files are never overwritten.

The workflow receives copied observations, tool schemas and user events. The
harness owns scenario labels, scripted user answers, fault schedules and scoring.
Every attempted call uses one step; timeout recovery retries at most twice with
the same action. No subprocess isolation, live models or API billing is involved.

| Tool | Purpose |
| --- | --- |
| `get_context` | Read structured input, user corrections and active plan |
| `get_memories` | Read versioned, confirmed/expired preferences |
| `search_exercises` | Look up artificial blocks by equipment |
| `request_clarification` | Request missing required fields |
| `validate_plan` | Return actionable constraint feedback |
| `propose_plan` | Store an immutable preview without writing a plan |
| `apply_plan` | Apply the approved preview with idempotent receipts |
| `finish` | End the episode; terminal state is scored independently |

See the [environment walkthrough and actual experiment results](../../docs/research/2026-09-28-interactive-environment.md)
for approval binding, memory precedence, trace structure and limitations.

## Model-policy adapter

```sh
python research/liftcut-agent/model.py mock --output-dir research/liftcut-agent/outputs/model-smoke
python research/liftcut-agent/model.py replay --config research/liftcut-agent/outputs/model-smoke/config.json --episodes research/liftcut-agent/outputs/model-smoke/episodes.jsonl
```

The mock completes 14/14 scenarios through 97 synthetic responses. Its token
counts and latency are test values, not measurements of an LLM. Live mode requires
an explicit endpoint, complete reviewed configuration, credential environment
variable and `--allow-live`; output directories are never reused. Unknown usage
halts the shared run and remains unknown cost. Every selected scenario stays in
the denominator, including those not attempted after budget exhaustion.

See [model protocol and budget documentation](../../docs/research/2026-09-28-model-policy.md)
for commands, artifacts, replay semantics and the prepared hosted-model pilot.
The first authorized live pilot passed one development scenario in 8 requests,
with a conservative rate-based cost estimate of $0.0052893. Its raw responses and
trace are checked in for offline replay. This is provider integration evidence,
not a general model benchmark. Details are in the [progress log](../../docs/AGENT_RESEARCH_PROGRESS.md).

## Hosted baseline and offline spending audit

The first full hosted development run passed **8/14** with `deepseek-flash`
(non-thinking, temperature 0). Five failures returned two tools where the adapter
required one; a sixth used the wrong terminal label while awaiting approval and
made no write. All 14 records replay, including failures. The 70 requests cost an
estimated $0.0433947 using configured conservative rates. This is public dev data,
not generalization or training evidence.

```sh
python research/liftcut-agent/audit.py --run-dir research/liftcut-agent/reports/deepseek-pilot-2026-09-28 --run-dir research/liftcut-agent/reports/deepseek-development-2026-09-28
```

The audit verifies complete artifacts through offline replay, recomputes metrics,
rejects duplicate runs, and keeps missing usage unknown. It adds spending across
distinct runs, never accuracy across overlapping scenarios. No network or API
credentials are used. `--output NEW_PATH` saves a ledger without overwriting.
Exit 0 means valid evidence, including evidence of failed tasks. See the
[experiment and diagnosis](../../docs/research/2026-09-28-development-baseline.md).

## Next increment

Bounded read-only batching and a separate pending-approval prompt revision are
implemented, preserving legacy replay. Four workflow-mock profiles pass 14/14;
this is not an updated live score. The paid four-arm comparison has not executed
because the execution environment rejected its launch after budget approval.

```sh
python research/liftcut-agent/protocol_experiment.py preflight
python research/liftcut-agent/protocol_experiment.py mock --output-dir research/liftcut-agent/outputs/protocol-smoke
python research/liftcut-agent/compare_protocols.py --run-root research/liftcut-agent/outputs/protocol-smoke
python research/liftcut-agent/export_trajectories.py --run-dir research/liftcut-agent/reports/deepseek-development-2026-09-28 --output-dir research/liftcut-agent/outputs/decisions
```

The existing live run yields 59 verified development decisions from eight
successful episodes. Known-invalid decisions in recovery traces remain context
and are excluded as positive targets. A real pinned Qwen3-4B tokenizer verified
2,766 supervised tokens, masked all context and avoided truncation at 4,096.
Weights, SFT and frozen held-out data are not part of this result. See the
[pipeline walkthrough and reproduction](../../docs/research/2026-09-28-protocol-and-data-pipeline.md).

Next: complete the frozen live comparison in a permitted environment, independently
review grouped data, validate small-model serving and execute the separately
budgeted [GPU compatibility pilot](../../docs/research/2026-09-28-small-model-pilot-plan.md).
