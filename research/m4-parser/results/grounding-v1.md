# M4 source grounding v1 — 2026-10-19

The first model run guessed missing units/reps and confused exercises. A number
appearing somewhere in the sentence is not evidence for its field: the old
`labelTextProblems` accepts weight/reps swapped in `卧推60kg8个`. The new shared
[`groundParseLabel`](../../../packages/core/src/parse-label-grounding.ts) checks
ordered fields, complete aliases, multiplicity, RPE scope and patch-only changes
against a bounded grammar. It rejects the whole proposal instead of repairing
fields, copying a plan value or dropping unrecognized clauses. This is pure
preview validation, **not a write authorization or a production parser switch**.

Replay of the two existing 1,060-row output files; **zero new model calls**:

| Model | Split | Raw exact | Guarded exact | Accepted actions | Correct actions rejected | Wrong accepted / invented fields |
| --- | --- | --- | --- | --- | --- | --- |
| merged | dev | 494/500 | 497/500 | 353 | 1 | 0 / 0 |
| merged | old test | 375/500 | 349/500 | 204 | 91 | 0 / 0 |
| merged | handwritten | 50/60 | 35/60 | 14 | 19 | 0 / 0 |
| Q4 | dev | 487/500 | 486/500 | 342 | 2 | 0 / 0 |
| Q4 | old test | 376/500 | 352/500 | 207 | 91 | 0 / 0 |
| Q4 | handwritten | 48/60 | 34/60 | 13 | 17 | 0 / 0 |

Exact includes correct clarifications. Wrong accepted compares **all** resolved
fields, including wrong values/exercises, not only the older invented-field count.
These are post-hoc system scores, not new model accuracy or independent validation.
Development grammar work reduced over-rejection; replay then exposed `10，10次`
being misread as two unweighted sets. That regression now requires explicit reps
units on each unweighted list entry (or explicit bodyweight), so the old test has
also influenced the guard. Original reports remain unchanged.

The bounded grammar is itself deterministic parsing. Agreement with it proves no
incremental model benefit over that grammar; a future comparison must include it
as a rules baseline. Arbitrary language safety is not established. The coverage
loss above blocks enabling this candidate as the native product parser.

Reproduce with `node --import tsx research/m4-parser/scripts/evaluate-grounding.ts
--gold <gold.jsonl> --pred <predictions.jsonl> --out <new-report.json>` (one line).
The command requires exact, unique prediction IDs and refuses to overwrite a
report. [Hashes and replay summary](grounding-v1.json) bind the original outputs.
Raw predictions/weights remain in the maintainer's verified local backup.

Next: isolate runtime/conversion from quantization with same-engine f16/Q4
predictions, then freeze a new evaluation and training protocol. Raw quantization
agreement must reach the unchanged 95% gate independently of source rejection;
rejecting both answers cannot count as quantization improvement. Native model
loading and device acceptance follow quality gates, with existing confirmation,
versioned writes, retries and undo preserved.
