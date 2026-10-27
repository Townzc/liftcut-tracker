# Pending production steps

## Account deletion — production web/API enabled; native acceptance pending

The reviewed backup/restore rehearsal and three migrations passed on 2026-10-27.
After isolated synthetic GoTrue/Storage/API acceptance and cleanup, the exact
`ab7fb3c` canary was promoted. Public `available:true` was verified at 10:12:54 UTC.
See [the rollout evidence](ACCOUNT_RELEASE.md#production-rollout-evidence--2026-10-27)
for source, deployment, checks and limitations. These migrations and server
activation are completed work, not instructions to repeat.

Keep `EXPO_PUBLIC_MOBILE_ACCOUNT_DELETION` and `EXPO_PUBLIC_MOBILE_EMAIL_SIGNUP`
off pending their separate signed-device gates. Existing owner-bound deletion
intents/receipts retain recovery. No real user may be deleted for release testing.
Future production-secret changes still require explicit maintainer approval.

Custom SMTP and signed iPhone email-return acceptance are still pending; local
captured mail and Expo/JavaScript checks cannot substitute for them.

## Avatar ownership — independent security boundary

`20261027082130_avatar_owner_write_boundary.sql` is applied and verified, after
the lifecycle migrations and reviewed backup. Preflight checked existing avatar
owner metadata against path prefixes. Restrictive policies close legacy bucket-only
write permissions; an all-role metadata trigger also checks signed uploads.
The app uses ordinary upload/upsert, but signed-upload APIs are separately callable.
Local real Storage tests covered a B-signed A-path token issued under the old
policy, own uploads/upserts, moves, reads and null-owner admin behavior. Hosted
synthetic acceptance additionally verified cross-owner write/delete/sign denial,
pending ordinary/signed-upload blocking and API cleanup. The hosted runner did
not reproduce the old vulnerable policy or inspect the physical storage backend.
This does not revoke public reads or trusted admin-issued null-owner signed URLs.
The metadata behavior is checked against [Storage v1.81.0](https://github.com/supabase/storage/blob/v1.81.0/src/storage/database/pg.ts)
and [its signed-upload route](https://github.com/supabase/storage/blob/v1.81.0/src/http/routes/object/uploadSignedObject.ts);
do not assume an unverified hosted Storage version behaves identically.
