# Mobile email authentication — staged preparation

Baseline `421bac6`, 2026-10-27. No production Auth changes, external mail, new
account/service, paid build or M4 run. The existing `liftcut` scheme is retained.

## PR 1: callback contract and handoff

- `/auth/mobile-callback` returns raw bilingual HTML, not the React/AuthProvider
  tree. It never exchanges a code, reads an account, sets a session or signs out
  an existing account. Only this exact path bypasses page authentication.
- A manual button targets only `liftcut://auth/callback`; parameters are bounded
  `code`, UUID `attempt` and optional `lang`. Duplicate/unknown parameters,
  tokens, error strings and arbitrary `next` destinations fail closed. Values
  are escaped; no script, auto-redirect, form, external asset or health data.
- Responses are `no-store`, `no-referrer`, `noindex` with a restrictive CSP.
  A valid-looking code is not proof of verification; the app must verify it.
  Codes still travel through the callback URL; do not log them or claim no
  infrastructure URL retention merely because response caching is disabled.
- Shared pure helpers define the pending email/attempt/state and isolated SDK
  storage namespace. The 30-minute local pending limit is not the provider's
  code lifetime. Tests cover serialization, expiry, cancellation, replay,
  changed attempts, existing login and verified-email mismatch.
- These helpers do not persist/lock native storage or adopt a session. No mobile
  registration button or callback screen is wired in this PR.

## PR 2: native adapter and minimal UI

1. Use one serialized registration controller and an isolated PKCE client with
   `detectSessionInUrl: false`, per-attempt storage key and persisted verifier.
   Persist only pending email/attempt/state/time, never passwords. Preserve it
   across cold starts; cancelling removes its verifier and prevents resumption.
2. Persist `exchanging` before the one-use code exchange. Repeated or interrupted
   claims must not silently retry/adopt; offer a fresh request or password login.
3. Accept only the exact app scheme/host/path, with no fragments or token payload.
   Match the local attempt, expiry and verifier namespace. Obtain identity using
   Auth `getUser` after exchange and compare its confirmed email to the pending
   email. Never install tokens supplied by the URL.
4. Recheck cancellation/expiry and current session before adoption. Coordinate
   password login, signup and sign-out to prevent async account-switch races.
   Refuse existing login without signing that account out or loading another's data.
5. Add bilingual register/wait/cancel/callback screens within the existing simple
   auth flow; no change to training confirmation, source or idempotency rules.

## Configuration and verification boundaries

Use the fixed HTTPS web callback on the approved LiftCut host. Existing hosted
redirect entries cover the two web domains; no `liftcut://` entry or production
configuration is changed here. Real production email remains blocked by the
separate SMTP preparation gate. Signed-iPhone installation/routing is untested.

Run `npx playwright test --config playwright.mobile-email.config.ts` against a
fixture build. The raw-response/browser cases run in quality CI. The local PKCE
case is skipped unless `LIFTCUT_LOCAL_AUTH_FIXTURE` explicitly points to a local
fixture JSON (`url`, synthetic `anonKey`/`serviceKey`), with `captured-mail/` beside
it. It rejects any Auth URL except `http://127.0.0.1:55460`; callback is port 3110.
It reads only newly captured messages for its random `@local.test` address and
removes its synthetic user. It exercises real email confirmation, PKCE rejection,
identity and code replay; in-memory adapter recreation is not a native cold start.

Official docs checked: [Expo SDK 58 Linking](https://docs.expo.dev/versions/v58.0.0/sdk/linking/),
[Expo authentication](https://docs.expo.dev/guides/authentication/),
[Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) and
[signUp](https://supabase.com/docs/reference/javascript/auth-signup).
Custom-scheme acceptance needs a development/standalone build; Expo Go is not
proof of that route. Actual commands and unrun items are in [PRODUCT_LOG](PRODUCT_LOG.md).
