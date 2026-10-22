# M4 continuous workout conversation

The authenticated web Agent prepares corrections, explicitly inherited loads,
invalidations and separately reported redo sets in the existing conversation.
The model cannot confirm a card or write an actual. Native inference remains off.

## Recording contract

- A conversation has a server-persisted **confirmed focus**: session, exercise,
  record ID, set index and revision. It is updated only after a committed approval,
  independently of the six-turn model prompt window.
- A pending utterance remains unconfirmed. It cannot become a database reference
  or redirect an uncertain fourth-set correction to the previously saved third
  set. Explicit current-message ordinals take precedence for the named exercise.
- Numeric roles are checked against the current report. Weight is never a set
  index, old quotes are not current actuals, and polite phrases are not repetitions.
  Model tools supply quoted changed fields, not numeric record IDs or targets.
- “Same weight” is an explicit lookup of the named exercise's latest confirmed
  set. Its identity/revision is bound to the preview. Omitted weight stays unknown;
  plan prescriptions never supply actual weight, reps or RPE.
- Progress/missing-record answers are composed from the freshly read database;
  user-reported completion cannot become a confirmed record through model prose.
  Explicitly uncertain workout reports keep that uncertainty in the displayed
  clarification too. Unsupported partial model text is not streamed first.
- A correction preserves the record ID and unchanged fields. A void retains the
  old row and append-only events. Redo needs new reported quantities and another
  confirmation, creating a new slot; the voided slot is not counted twice.
- Per-hand kg/lb is retained with its basis. Legacy total-weight columns stay
  null, so volume and 1RM cannot silently double it or mix bases. Extra confirmed
  actual sets do not expand the long-term prescription.

## Approval, persistence and isolation

The server stores an immutable review. The browser submits only its IDs/version
and explicit `confirm_preview` authorization through the shared outbox. It cannot
edit write values in that request. New turns supersede pending reviews; changed
session state, stale source revisions, another owner, deleted chat or modified
approval JSON are rejected. Concurrent identical confirmations create one event;
an old approval cannot resurrect a subsequently corrected/voided row.

The local queue persists the new operation across tabs and reloads and reports
pending status until server acknowledgement. The confirmation card stays in the
chat; there is no additional dashboard or navigation surface. Historical chat
prose is not a reusable approval token. Deleting a chat erases its unconfirmed
review prose and focus; applied record/audit evidence remains with the confirmed
fitness data. Runtime deletion cannot erase an applied review.

The additive migration grants only the server workout role the needed operations.
`anon` and `authenticated` have no direct access to either new table. Both tables
force owner RLS, preview payloads cannot be updated by the runtime role, and only
unapplied reviews can be deleted. Apply after a private backup and before deploying
the caller; never replay the legacy schema into production.

## Verification boundaries

Real-model acceptance uses the configured DeepSeek provider, product SDK/tools,
fresh local PostgreSQL and the same approval store as the HTTP route. Twenty
unchanged originals run in one conversation with six-turn prompt history; three
predeclared replies provide missing actual quantities. The driver confirms only
matching returned previews and checks no actuals changed before approval. These
are explicit **test-driver confirmations**, not physical UI clicks.

Browser acceptance separately uses a scripted loopback provider and synthetic
Auth with real API/database persistence. It checks visible approval, duplicate
clicks, switching tabs, reload, correction, inheritance, void/redo and unchanged
prescriptions. It cannot stand in for real-model natural-language accuracy.

One extraction repair is allowed for a malformed current-message quote/list;
the same guards still run and a second failure asks for clarification. This does
not retry missing facts, approval failures or uncertain/ambiguous targets.

Every failed real-model run is retained with its source hashes; a repair rerun is
not substituted for it. The originals and raw model traces are private, excluded
from Git and training. Aggregate results, limitations and rollout status are in
the [product log](PRODUCT_LOG.md). Existing phone-width Chromium/WebKit and WeChat
user-agent simulations are not physical-phone or mainland-network measurements.

The [v3 regression analysis](../../research/m4-parser/results/20261022-regression-analysis/README.md)
explains why the on-device candidate still fails. Do not enable it from a cloud
conversation result or from quantization agreement alone.
