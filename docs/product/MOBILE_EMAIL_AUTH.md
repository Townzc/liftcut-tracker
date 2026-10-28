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

## PR 2: persistent controller and isolated SDK adapter

1. Use one serialized registration controller and an isolated PKCE client with
   `detectSessionInUrl: false`, per-attempt storage key and persisted verifier.
   Persist only pending email/attempt/state/time, never passwords. Preserve it
   across adapter recreation; cancelling removes its verifier and prevents resumption.
2. Persist `exchanging` before the one-use code exchange. Concurrent identical
   callbacks share one promise; completed/interrupted claims cannot exchange again.
3. Accept only the exact app scheme/host/path, with no fragments or token payload.
   Match the local attempt, expiry and verifier namespace. Obtain identity using
   Auth `getUser` after exchange and compare its confirmed email to the pending
   email. Never install tokens supplied by the URL.
4. Recheck cancellation, expiry and current session after network/cleanup. The
   confirmation session stays in memory and is best-effort revoked, never moved
   into the main client. Successful verification returns the email for ordinary
   password login; an existing account is never signed out or replaced.
5. Storage writes use a separate queue so cancellation is durable while a network
   request is slow. Persist only pending metadata and the isolated verifier; no
   password, callback code or temporary session tokens. Storage failures surface.
6. The web SDK path refuses registration before any request if RNG, WebCrypto digest, TextEncoder
   or base64 capability is missing or broken. Exercise RNG and the SHA-256 `abc`
   known vector; this detects obvious broken implementations, not proof of entropy.
   Before network I/O, verify the pinned SDK's actual signup request uses S256
   matching its persisted verifier. A missing/changed verifier or plain fallback
   fails closed. Node support does not establish Hermes/iPhone capability. Native
   capability remains a release gate; no partial global crypto shim is installed.

## Scoped native S256 preparation

Native bindings now supply Expo Crypto's `getRandomBytesAsync(32)` and SHA-256
`digestStringAsync` directly. The synchronous random-byte API's development
fallback is not used. No WebCrypto global is installed. A scoped public Auth
signup request uses S256 only, after the verifier is durably stored and checked;
the same isolated SDK still exchanges the code, verifies identity and closes its
temporary session. An unexpected immediate session is rejected and best-effort
signed out with local scope, using the public key, never an admin secret. This
revokes refresh capability; an issued access JWT may remain valid until expiry.
No response token is adopted by the main account or persisted by the controller.
All adapter requests reject redirects and omit cookies. Native binding explicitly uses `expo/fetch`,
so the legacy global-fetch override cannot silently change this transport. Real
loopback HTTP 307 tests cover passwords, code exchange and temporary signout;
native redirect enforcement still belongs in signed-device acceptance.

Local GoTrue acceptance covers both SDK and scoped paths with captured mail,
wrong-verifier rejection, identity and replay; a separate auto-confirm fixture
verifies immediate-session refusal and refresh-token revocation. The scoped test
uses Node crypto primitives, not Expo/Hermes. iOS/Android JavaScript exports also
do not prove native runtime behavior. The flag remains off until public SMTP and
independently installed signed-iPhone secure-crypto/cold/warm/replay tests pass.

## PR 3: native binding and minimal UI preparation

The controller is bound to AsyncStorage and current main-session ownership. Main
Auth events invalidate pending registration, and explicit password login awaits
cancellation. Bilingual register/wait/cancel/callback screens keep the existing
layout; the callback supplies the original `useLinkingURL()` value, including its
scheme, rather than reconstructing query values. Existing accounts are not replaced.
Pending account deletion keeps its public recovery route and blocks registration,
password-login navigation and email return until the deletion state is resolved.
Confirmation returns to password login. Cancelling local verification does not
delete an account already created by Auth. Training approval/source/idempotency
remain unchanged. Native encrypted storage is not claimed.

`EXPO_PUBLIC_MOBILE_EMAIL_SIGNUP` must equal `true` to expose registration or
process a callback. It is absent/off by default and explicitly false in the
example. Ordinary password login remains available. No EAS or production variable
was changed. Keep the flag off until real SMTP delivery, native secure crypto and
signed-iPhone cold/warm/repeated-link acceptance pass; Expo Go is not that evidence.

The opt-in web UI check exports `apps/mobile` with `EXPO_NO_DOTENV=1`, signup flag
`true`, Auth `http://127.0.0.1:55438`, key `mobile-signup-fixture-only` and API
`http://127.0.0.1:3109`, then runs `npx playwright test --config
playwright.mobile-signup.config.ts`. Auth responses are intercepted synthetic
fixtures: the tests inspect S256, bilingual pending restore, cancellation and HTTP
callback refusal, not real delivery or native routing. CI runs it after the normal
default-off mobile web regression suite; the prior local-GoTrue test stays separate.

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
removes its synthetic user. It calls the same application controller and SDK adapter
with asynchronous storage and exercises real email confirmation, PKCE rejection,
identity and code replay; in-memory adapter recreation is not a native cold start.
The separate rejection case runs only with fixture `autoConfirm:true`; normal
email-confirmation cases skip in that mode. Never enable auto-confirm on hosted
Auth to run this test.

Official docs checked: [Expo SDK 58 Linking](https://docs.expo.dev/versions/v58.0.0/sdk/linking/),
[Expo authentication](https://docs.expo.dev/guides/authentication/),
[Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) and
[signUp](https://supabase.com/docs/reference/javascript/auth-signup).
Custom-scheme acceptance needs a development/standalone build; Expo Go is not
proof of that route. Actual commands and unrun items are in [PRODUCT_LOG](PRODUCT_LOG.md).
