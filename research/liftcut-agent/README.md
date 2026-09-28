# LiftCut-AgentLab: measurement foundation

**Implemented:** 30 synthetic development fixtures, a strict structured-proposal
evaluator, a deterministic baseline and regression tests. Python 3.11+ standard
library only; no GPU, model/API credentials, package installation or web app needed.

**Not yet implemented:** an interactive tool environment, model-driven agent,
temporal memory, authorization transitions, training or held-out model evaluation.
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

## Contract

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
  human review and a separate execution environment are still needed for P1.
- There are no tool failures, multi-turn state, medical-quality labels or real user
  outcomes here. Those must receive separate task definitions and measurements.

## Next increment

Build a resettable environment that exposes only observations and typed tools to
the policy. Add trace replay, preview/approval transitions, tool-failure injection,
and stale-memory tasks before collecting any training trajectories. Preserve this
small proposal contract as a fast regression suite.
