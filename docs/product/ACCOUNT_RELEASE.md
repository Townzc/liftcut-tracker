# Account lifecycle release gates

Prepared 2026-10-27. Free code preparation is not a signed iOS or public email
delivery acceptance. No M4 work, Apple enrollment or paid service is needed here.

## Self-deletion API

The default-disabled `/api/account/deletion` is shared by web and native clients.
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

Activation prerequisites (not executed by this change):

1. Back up affected production tables, verify restore material, apply the reviewed
   account deletion migration and verify grants, RLS and Auth trigger.
2. Explicit maintainer approval is required by `AGENTS.md` before adding the
   server-only `SUPABASE_SERVICE_ROLE_KEY` or changing production secrets.
   Never expose it through `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*` or a browser bundle.
3. The existing signing secret is domain-separated by the required signed purpose
   `account-deletion-v1`. The receipt grants no read, training or account-selection
   permissions. Keep `FEATURE_ACCOUNT_DELETION` off until all gates pass.
4. Test real GoTrue + Storage with synthetic accounts, including concurrent upload,
   old JWT/refresh rejection, complete dependency cleanup, retry and another owner.
5. Ship web/native confirmation, reauthentication and owner-scoped local cleanup;
   then check an independently installed signed iPhone build before App Store claims.

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
