# Mobile acceptance handoff — 2026-10-26

## Evidence boundaries

The base was main `a2b27dc`. One independent synthetic account was created in
the existing Supabase project; only its synthetic plan/session/chat was used.
No production migrations, new paid service, M4 training or model-default switch.

| Layer | Actually exercised | Limit |
| --- | --- | --- |
| Real auth | Password login, server getUser, refresh; invalid token 401, different owner 409 | One test account, not all login providers |
| Real model | Production DeepSeek via mobile askCoach, 216 text events; one greeting first text 3.09s, complete 4.51s | Single sample, not latency percentiles |
| Real API/outbox | Confirmed one set; dropped successful response, reloaded queue, replayed identical bytes: one row/revision | Node file adapter, not native SQLite |
| History | Nine-turn conversation and draft restored; UI switched to settings and back, then reloaded | Expo web export in desktop Chrome |
| Weak network | One history POST interrupted before upstream; UI showed retry state then synchronized; read-only reply cited actual session | Injected 503, not a mainland cellular network |
| Continuous correction | Initial run failed after eight intervening turns; future statement polluted pending actual state | Fixed separately in #174; retain failed evidence |
| Native | SDK dependency/JS/type/lint checks | No signed APK, Gradle/Xcode execution or device pass yet |

Auth files, response payloads and complete local logs stay outside Git in the
task's `deliverables/2026-10-26-mobile-native-acceptance`. Never publish session
tokens, signed previews or the user's private acceptance phrases. A restored
chat is prose only; its old proposals cannot execute again.

## Build prerequisites and next commands

The workstation has no logged-in Expo identity (`eas whoami`: Not logged in),
no Android SDK and no current Android JDK. Existing EAS preview/development
profiles specify internal APK distribution. The maintainer must provide their
Expo login/project and approve the permanent Android package identifier before
we set `owner`, `extra.eas.projectId` and `android.package`. No paid build or new
account has been started. Device model/OS and test network remain to be supplied.

After login and configuration, from `apps/mobile`:

```sh
npx eas-cli@latest whoami
npx expo-doctor
npm run typecheck
npm test
# A new output folder, outside the repository; no --force deletion.
npx eas-cli@latest build:inspect --platform android --profile preview --stage archive --output <new-archive-directory>
# Inspect the archive: includes apps/mobile + packages/core, excludes credentials,
# model weights, private local outputs, dependency trees and build artifacts.
npx eas-cli@latest build --platform android --profile preview
```

Only use the account's available free capacity; ask before any paid service.
The build must use public HTTPS Supabase/API settings, never the loopback test
relay. Service-role, database and model secrets never enter the app or archive.
Record the exact Git SHA, build ID, package/version, APK hash, signing identity,
artifact link, build logs and install result. Do not call JS export an APK.

## Device gates (all pending)

1. Install the signed APK; cold launch, password login and token refresh. Record
   device/OS/network and real first-text/full-response timings separately.
2. Start a synthetic workout. Produce a review, inspect quantities and sources,
   and prove zero writes before confirmation. Unknown weight/RPE stays unknown.
3. Confirm, add eight intervening turns, correct the same confirmed record, reuse
   its load, void and separately confirm a redo. Check IDs, revisions, audit
   events and counts on the server; completion prose is not a write receipt.
4. Switch screens, background/foreground, force-stop and relaunch. Restore chat,
   draft and conversation ID. Open cloud history; old cards remain closed.
5. With a cached active session, disconnect, confirm an operation, force-stop,
   relaunch and reconnect. The SQLite queue must retain the exact request and
   synchronize once. Also lose the response after a successful commit and retry.
6. Switch accounts while a request waits; the old queue must never use the new
   token. Reject stale/cross-owner proposals; retain recoverable pending work.
7. Verify real Android keyboard/insets/back navigation, notification permission,
   rest timer/background behavior, haptics and resume from weak connectivity.

Keep the existing screen structure and explicit confirmation/source/idempotency
rules. Report each gate as pass/fail/not run with evidence. Native availability
and mainland-device usability remain separate release gates from a Vercel web
deployment. iOS/TestFlight waits for the maintainer's Apple account decision.

References: [EAS archive inspection](https://docs.expo.dev/build-reference/easignore/),
[APK distribution](https://docs.expo.dev/build-reference/apk/),
[CLI reference](https://docs.expo.dev/eas/cli/).
