# Pending production steps

## Account deletion — disabled until verified

Do not set `FEATURE_ACCOUNT_DELETION=true` yet. The private lifecycle migration,
all-role avatar write guard, real Auth/Storage tests and client cleanup must all
pass first. Back up affected tables before applying additive migrations and verify
their grants/RLS/triggers afterwards. Confirm legacy avatar key compatibility.
Adding the server-only Supabase admin secret requires explicit maintainer approval.
No real user may be deleted for release testing. See [the rollout and email
checklist](ACCOUNT_RELEASE.md) for the exact sequence and outstanding evidence.

Custom SMTP and signed iPhone email-return acceptance are still pending; local
captured mail and Expo/JavaScript checks cannot substitute for them.
