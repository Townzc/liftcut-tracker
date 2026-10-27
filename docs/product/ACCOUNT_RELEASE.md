# Account lifecycle release gates

Updated 2026-10-27 after the verified production web/API rollout. Signed iOS
installation and public email delivery remain separate, unfinished acceptance
gates. No M4 training, Apple enrollment or new paid service was used.

## Production rollout evidence — 2026-10-27

Release source: `ab7fb3cec60aca2902f09937a14e45da5f5d479a`, after all 11 checks
passed for [#199](https://github.com/Townzc/liftcut-tracker/pull/199).
Production deployment `dpl_2F6J4iMo4g8t1izhsytHtKX8zAWd` was first tested as an
isolated, protected canary without assigning the custom domains. The same READY
deployment was promoted; public availability was verified at **10:12:54 UTC**.
Automatic domain assignment was restored and temporary share access revoked.
The public `www.liftcuttracker.com` alias was verified on that exact deployment.

| Checkpoint | Observed result |
| --- | --- |
| Backup and restore rehearsal | Six affected ledger/avatar-metadata snapshots matched source and same-database restore copies, with zero row differences. This is not an Auth-identity/file-byte backup or offsite disaster recovery. |
| Three migrations | The lifecycle boundary, all-role avatar lifecycle guard and legacy avatar ownership boundary were applied in order. Each combined source-invariant and phase assertion passed; the full catalog was captured after phase 3. |
| Auth and confirmation | Two new synthetic accounts logged in through real GoTrue. Missing/false confirmation, changed caller/expected owner and a revoked session could not initiate deletion. |
| Storage and recovery | A uploaded 105 tiny avatars, including a 30-level path; B uploaded one. Cross-owner overwrite/delete/signing was refused. Discarding the POST acknowledgement recovered the same request ID; pending status blocked ordinary and previously signed uploads. Tampered proof and active B could not complete A's deletion. |
| Completion and isolation | A's deletion and same-proof retry succeeded; old credentials/uploads were rejected and representative deleted objects were no longer readable. B's selected profile/settings fields and file bytes remained unchanged. An independent SQL checkpoint found A's audited dependencies absent, while B's seeded rows and file remained. |
| Cleanup and baseline | Both synthetic accounts were then deleted through the API. The independent audit found zero remaining synthetic Auth/session/profile/settings/avatar/ledger/pending rows. The original seven-user identity digest and affected ledger/avatar baseline matched; phase 3 assertions passed again. |
| Public smoke | `/api/account/deletion` returned `available:true` with `no-store`; reset/delete pages and both languages of privacy/support returned 200. Privacy/support showed the expected support contact. |

The hosted migration registry uses execution versions: backup `20261027100648`;
source `20261027065932_account_deletion_boundary.sql` → `20261027100700`;
`20261027071408_account_storage_write_guard.sql` → `20261027100712`;
`20261027082130_avatar_owner_write_boundary.sql` → `20261027100722`.
These are recorded mappings, not a change to migration history.

Sanitized operator evidence is kept outside Git under
`deliverables/2026-10-27-storage-runtime/`: `production-backup-verified.json`,
`production-migration-{1,2,3}-verified.json`, `production-acceptance-{login,run,cleanup}-evidence.json`,
`production-synthetic-{seed-verified,checkpoint,cleanup-audit}.json`,
`production-final-baseline.json`, `production-public-enabled-smoke.json`,
`production-migration-registry.json` and `production-public-alias.json`.
No credentials, receipts, user identifiers or account contents belong in this document.

The hosted runner tested HTTP/Auth/Storage, not production browser interaction or
a native app. It did not inspect physical storage media or prove backup erasure.
Earlier local browser tests remain separate evidence. No public SMTP delivery or
new signed-device acceptance was performed; mobile registration and new deletion
retain their independent default-off build gates.

## Self-deletion API

The shared `/api/account/deletion` remains default-disabled in configuration;
the production server flag was explicitly enabled for the rollout above.
GET returns availability. POST requires `{requestId, confirmed:true}`, a verified
owner and authentication within five minutes. A refreshed JWT is not a new login.
The database verifies that the signed session still exists before starting.
The server returns a one-hour receipt scoped only to that deletion. Store it
locally before DELETE; never put it in URLs, logs, analytics or chat messages.
DELETE accepts `{receipt}` and reconciles retries. Network failure is unknown,
not proof that the account was retained or deleted. Reauthentication can recover
the existing request when a receipt expires or another device resumes the flow.
An expired, signature-valid receipt may only verify that its own account is already
absent (lost success response); it cannot continue deletion or read account data.
Active or explicitly expected owners must match the receipt. Native recovery uses
`X-LiftCut-Deletion-Receipt: 1` with no Origin/fetch metadata, never a fake Auth
bearer. Browser requests still use same-origin checks; no CORS access is granted.

Storage files are removed through the Storage API, in bounded offset-zero batches,
before Auth deletion. Auth deletion and private-ledger cleanup are transactional;
Storage is not. A partial failure retains pending status for retry. No real user
deletion belongs in release tests. Local device queues are a separate client gate.

Operational rules after activation:

1. Back up affected tables and verify restore material before future migrations.
   The three reviewed migrations above are already applied; do not rerun them as
   pending work. Roll back availability by disabling the feature while retaining
   the guards and recovery records; this cannot undo a completed account deletion.
2. Explicit maintainer approval is required by `AGENTS.md` before adding the
   server-only `SUPABASE_SERVICE_ROLE_KEY` or changing production secrets.
   Never expose it through `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*` or a browser bundle.
3. The existing signing secret is domain-separated by the required signed purpose
   `account-deletion-v1`. The receipt grants no read, training or account-selection
   permissions. Do not treat server activation as permission to enable a mobile build.
4. Future acceptance must use isolated synthetic accounts and preserve other
   owners. Stop for baseline drift review rather than restoring over legitimate data.
5. Keep `EXPO_PUBLIC_MOBILE_ACCOUNT_DELETION` off until an independently installed
   signed iPhone build passes confirmation, reauthentication, storage, cold restart
   and recovery. Existing owner-bound intents/receipts remain recoverable while off.

## Free email setup prepared; no account created

Read-only production inspection found Supabase's built-in SMTP, not custom SMTP.
It only sends to authorized organization-member addresses and is not a production
sender. The current website-domain redirect allowlist already covers reset pages.

Candidate: Resend Free. Its current official pricing lists 100 messages/day and
3,000/month; check current limits before activation. No paid upgrade or billing
permission is implied. The maintainer chose preparation only on 2026-10-26.

When authorized, use an existing-domain sending subdomain such as
`auth.liftcuttracker.com`; verify ownership with the provider-issued DNS records,
without replacing the site's or mailbox's existing records. Review SPF/DKIM/DMARC
and disable click/open tracking for security emails. Confirm the sender address
and scoped sending credential, then configure Supabase custom SMTP with
`smtp.resend.com:465`, user `resend`, and the credential as password. The SMTP
credential stays in Supabase; no client or app-server mail key is needed.

After configuration, test a dedicated test inbox: registration, recovery,
expired/reused links, resend limits, Gmail and mainland mailbox delivery, and
mobile warm/cold return. A local mail capture cannot prove inbox delivery.
Record actual delivered mail and user observations without publishing tokens.

Sources checked 2026-10-27: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[Resend pricing](https://resend.com/pricing),
[Supabase SMTP integration](https://resend.com/docs/send-with-supabase-smtp).
