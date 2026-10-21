# Numeric roles and confirmed context — 2026-10-21

Two separate checks now exist: [`labelRoleProblems`](../../../../packages/core/src/parse-label-roles.ts)
rejects a value borrowed from the wrong numeric role; [confirmed references](../../../../packages/core/src/confirmed-set-reference.ts)
bind corrections, explicit load inheritance and voids to stored IDs/revisions.
The numeric gate is **necessary, not sufficient**: it does not establish whether
a sentence describes an actual, a plan, or a compound request. It is not a new
semantic-parser accuracy result. Frozen source-v1/v2 remain unchanged.

The internal `TodayStore.confirmReviewedSet` port re-reads and checks the retained
preview under the existing owner transaction lock. Exact retries produce one
event; stale source records, other owners and changed previews fail. It has **no
HTTP route or product UI caller**. Native inference remains disabled. A future
caller must retain the preview server-side after source validation, not accept a
client-supplied retained preview as authority. The same existing SQL write/event
path is used; there is no new table, grant or production migration.

Actual verification: six synthetic core tests; four PostgreSQL test/subtest
results; the root suites (6 JavaScript + 206 TypeScript tests), core/app type
checks and targeted lint passed locally. DB coverage includes correction without
an extra row, exercise-specific inheritance after another exercise, stale-source
rejection, concurrent identical approvals, compensation, and a separately
confirmed redo. A real Chromium UI/API/local PostgreSQL regression also passed;
its refreshed home capture is used in README. Auth is a contract double.

## Twenty observed scenario utterances

The original private cases were unchanged (SHA-256
`a93883af71f65fe3be1926deb07c38890d206323df64b18b1d2f4b1c11b02f23`).
Forty archived free/G1 predictions were replayed: **zero new model calls**.
The new numeric gate rejects four wrong-target outputs (two cases, two arms)
and two schema-invalid outputs. The existing semantic gate still accepts **zero**.
These exposed cases are regressions, not unseen acceptance or training data.

A separate continuous, **scripted-confirmation** lane ran all 20 checkpoints
against actual PostgreSQL through TodayStore. It checked the original record ID
on correction, confirmed exercise-specific load, pending references that must
not resolve, and compensating void followed by a separately supplied redo.
Original text, expected workflow, model output, explicit scripted approvals,
before/after rows and trace events are retained in private artifacts. Scripted
manual entries are not credited as successful model proposals.

**Full natural-language acceptance FAILED.** Per-hand load basis is not represented
in the current set schema. The atomic labels cannot express only-load inheritance,
pending-draft edits, whole-exercise skips or query+finish, and the current semantic
guard still declines the observed requests. No overall success percentage is
reported from refusals. Fix the versioned contextual proposal boundary and route
compound requests before another GPU candidate; keep raw utterances out of SFT.
