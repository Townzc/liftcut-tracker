# Explicit Data API privileges

2026-10-20 (Los Angeles). Supabase's [announced change](https://github.com/orgs/supabase/discussions/45329)
removes automatic grants for newly created public tables. Existing tables keep
their privileges. RLS controls rows; it does not make a table accessible.

The initial schema previously omitted API grants. With automatic exposure off,
the signed-in page proxy received `42501` from `user_settings`, then incorrectly
treated the error as an incomplete profile. Explicit grants now accompany the
fresh schema and an additive migration. An unavailable/denied profile read returns
a non-cached 503 retry page, preserving refreshed session cookies; only a
successful empty/incomplete read goes to onboarding.

## Permission map

All entries below are for `authenticated`, under the existing owner RLS policies.
Sources are `src/services/data-repository.ts`, `src/services/ai/persistence.ts`,
`src/app/api/ai/history/route.ts` and the page proxy.

| Table | Operations | Reason |
| --- | --- | --- |
| profiles, user_settings | SELECT, INSERT, UPDATE | Read/create/edit profile; settings upsert and onboarding |
| training_plans | SELECT, INSERT, UPDATE, DELETE | Import, activate, edit and explicitly delete saved plans |
| training_plan_weeks | SELECT, INSERT, DELETE | Replace week tree; child deletion is an FK cascade |
| training_plan_days, training_plan_exercises | SELECT, INSERT | Read/insert nested plan; no direct update/delete calls |
| workout_logs | SELECT, INSERT, UPDATE | Legacy import/upsert and history |
| workout_log_exercises | SELECT, INSERT, DELETE | Replace legacy log children |
| food_logs, body_metric_logs | SELECT, INSERT, UPDATE, DELETE | Confirmed manual save, update and delete |
| ai_training_plan_generations, ai_nutrition_plan_generations | SELECT, INSERT, DELETE | Generation history and explicit history deletion |
| nutrition_plans | SELECT, INSERT, UPDATE | Owner policy lookup, insert and active-plan update |
| nutrition_plan_days, nutrition_plan_meals | SELECT, INSERT | Owner policy lookup and insert nested menu |

No new `anon`/`service_role`, sequence, function, default, ALL TABLES or schema
CREATE privileges. These tables use explicit text/UUID IDs. Later workout tables
stay read-only to authenticated users; coach/quota tables and approval ledgers
remain on their existing restricted server roles. Agent approval semantics do
not change. The migration supplies missing grants without revoking old custom
or historical grants on existing databases; it is not a global privilege cleanup.

## Verification

- Actual PostgreSQL 16: eight checks passed across separate fresh-schema and
  upgrade databases with default API table/sequence/function grants revoked.
  The upgrade reproduces `42501` before the migration. Tests assert the exact
  operation matrix, no anonymous/service-role grants, protected transaction and
  private-table access, upsert, nested ownership, FK cascade and cross-user denial.
  Both applications of the additive migration succeed. CI runs these checks.
- Local real GoTrue 2.197.0 + PostgREST 16.5 + PostgreSQL 16: one mobile-width
  Playwright flow passed without intercepted responses: password sign-in →
  missing profile/onboarding → authenticated settings upsert → home → settings
  and refresh → login route returns home. Revoke SELECT in that disposable DB →
  real `42501` and 503 retry page → restore SELECT → same session and data recover.
- Root tests: 191 passed. Production build/type check passed. Lint: zero errors,
  two pre-existing research warnings. The 42501/503 and missing-row page decisions
  also run in the regular authentication regression.
- Docker Desktop failed to start. The local acceptance used hash-verified official
  standalone Auth/PostgREST release binaries, a loopback routing adapter and an
  actual empty database. An initial local Auth search-path configuration failed;
  a new isolated DB with the correct auth search path passed. Storage metadata
  was stubbed, and storage delivery, hosted OAuth, mobile hardware and production
  user login were not tested by this check.

Run SQL tests with `API_GRANTS_TEST_DATABASE_URL` pointing to a local disposable
`liftcut_p1_grants_*` database name (the test creates `_fresh`/`_upgrade` databases
and refuses to overwrite existing ones). For the browser check, set
`API_GRANTS_SUPABASE_URL`, `API_GRANTS_ANON_KEY`, `API_GRANTS_BROWSER_DATABASE_URL`
to the local Auth/Data API stack; build with matching `NEXT_PUBLIC_SUPABASE_*`,
then run `npx playwright test --config playwright.api-grants.config.ts`.

## Hosted migration

PR #142 passed all nine checks and merged as `06c1e92`; the tested and merged
file trees match. Its exact production deployment is READY with the live domain
aliases. Anonymous requests to home, Agent and settings redirect to login and
finish with HTTP 200. This availability check is separate from the real local
fresh-database authenticated acceptance above.

Applied the exact additive SQL to the existing LiftCut project after a private
off-database backup of all 15 affected tables. Before/after ordered JSONB row
digests match for all 1,715 rows. Existing table grants already included the
needed operations; no user data or production secrets changed. Security advisor
reports no missing RLS on public tables; the two intentionally denied backup
tables and existing [password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remain. Private row backups are outside the repository.

Local evidence: `deliverables/2026-10-20-supabase-api-grants/` in the parent
workspace (backup verification, migration receipt, row digests and mobile screenshots).
Do not replay the full schema against production or auto-push historical migrations.
