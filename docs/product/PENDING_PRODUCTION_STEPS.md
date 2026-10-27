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

## Avatar ownership — independent security boundary

Apply `20261027082130_avatar_owner_write_boundary.sql` after reviewed backup and
local verification. Its restrictive policies close legacy bucket-only write
permissions; an all-role metadata trigger also checks previously signed uploads.
Verify actual `storage.objects.owner`/`owner_id` match the path prefix first.
The app uses ordinary upload/upsert, but signed-upload APIs are separately callable.
Real Storage acceptance must cover a B-signed A-path token issued before migration,
own uploads/upserts, moves, public reads and trusted null-owner admin cleanup.
This does not revoke public reads or trusted admin-issued null-owner signed URLs.
The metadata behavior is checked against [Storage v1.81.0](https://github.com/supabase/storage/blob/v1.81.0/src/storage/database/pg.ts)
and [its signed-upload route](https://github.com/supabase/storage/blob/v1.81.0/src/http/routes/object/uploadSignedObject.ts);
do not assume an unverified hosted Storage version behaves identically.
