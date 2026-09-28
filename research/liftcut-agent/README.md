# LiftCut-AgentLab: offline evaluation and interactive environment

**Implemented:** 30 proposal development fixtures, 14 interactive development
scenarios, a strict proposal evaluator, eight typed tools, temporal preferences,
user approval transitions, failure injection, fixed workflows and trace replay.
Python 3.11+ standard library only; no GPU, model/API credentials, package
installation or web app needed.

**Not yet implemented:** a model-driven policy, trajectory training, product
integration or held-out model evaluation. The offline confirmation state is a
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

## Next increment

Add an untrained model policy behind the same observation/tool interface, with
bounded calls, strict parsing and usage accounting. First verify the adapter with
mock responses, then measure a small live pilot after model access and a spending
limit are established. Expand and independently review grouped scenarios before
collecting SFT trajectories; keep these public seeds as regression fixtures.
