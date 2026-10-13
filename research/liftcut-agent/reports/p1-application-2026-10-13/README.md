# P1 application evidence — 2026-10-13

Synthetic development users and drafts; actual PostgreSQL16.15 transactions and restricted runtime role. **No new model calls, GPU/cloud session, production migration or real user trial.**

- [Final 22 engineering checks](p1-db-final-role.log) (earlier [22 check run](p1-db-final.log)), [first 15 checks](p1-db-first.log).
- [Final browser checks including saved-plan navigation](p1-browser-final-cache.log) (earlier [approval-only run](p1-browser-final.log)): synthetic auth/profile HTTP contract double, actual Next route and PostgreSQL. Response genuinely aborted after the transaction in the browser loss test.
- [Applied after reload](p1-browser-applied.png), [old proposal expired after context update](p1-browser-revoked.png), and [actual saved-plan page](p1-browser-plan.png), all rendered and inspected. The plan list includes earlier independent browser test runs; SQL assertions verify this run itself committed exactly once.
- [Full lint](p1-lint-final.log) and [production build](p1-build.log); lint retains only two pre-existing source warnings.
- [Existing application regression](p1-app-regression.log): 8 + 39 checks.
- [24 workflow summary](workflows/summary.json), [each raw workflow hash](workflows/sha256.json). Each JSON records input, scripted external user events, Store responses and exact database rows. 18 execution attempts, 9 real commits. Scripted response loss and object recreation are explicitly separate from browser fault and actual process-termination tests.
- [Actual dump/restore record](database-restore.json): new local database, all24 snapshots and restricted reads matched; not a model backup acknowledgement.
- [Implementation, failures, reproduction and limits](../../../../docs/research/2026-10-13-p1-application-transactions.md).
- [Next model preparation and remaining gates](../../../../docs/research/2026-10-13-p1m-preparation.md).

`sha256.json` at this directory covers captured evidence; the README is explanation, not an original run record. Database dump remains local and synthetic. No private database URL or live credential is published.
