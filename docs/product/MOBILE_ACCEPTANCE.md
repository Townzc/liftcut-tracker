# Mobile acceptance handoff — 2026-10-26

## Evidence boundaries

### Physical iPhone session, 2026-10-26

Maintainer-operated iPhone 16 Pro / iOS 27.0.1 / Expo Go 58.0.5 (versions reported
by the maintainer), using the independent synthetic account and real HTTPS API.
Baseline `b147760`; subsequent local sync fix is identified by this PR. The LAN
connection timed out; the official temporary Expo tunnel worked. Both Expo
clients are now logged in. No paid build, EAS project or signing identity created.

| Gate | Observed evidence |
| --- | --- |
| Login and preview | Native login displayed 2/6; server read proved preview alone wrote nothing |
| Confirm / correct | Explicit phone confirmation plus server receipt; correction kept the same ID, advanced revision, and preserved unknown RPE |
| Inherit / void / redo | Inherited confirmed 39 kg; void advanced the same ID; separately confirmed redo created one new set; 4 done, 2 voided |
| Persistence | Maintainer force-closed/reopened and reported conversation, unsent draft and Chinese preference retained |
| Offline before fix | SQLite-backed queue survived restart and never said saved; automatic sync failed, manual sync created one record |
| Offline after fix | Offline correction left server at 6 reps; reopen online and stay in Agent without manual retry applied 5 reps to the same ID, revision 2 → 3; still 4/6 done |
| Stream / keyboard | Maintainer observed ordinary read-only reply growing progressively and an unobscured input; no measured phone latency distribution |

The first reported correction did not match server evidence; it was repeated
explicitly and verified. That initial mismatch is not counted as a successful
write. Histories and raw receipt evidence remain in the local task deliverables.

The retry defect came from screen-scoped scheduling: leaving Home removed its
timer and foreground listener. The signed-in provider now owns queue recovery on
every screen; a fresh foreground can retry transport failures, while auth/version
conflicts remain paused. No new write path, ledger, UI structure or model default.

Still unrun on device: eight-turn interval positioning (passed in real API and
browser rehearsal), account switching/expired previews, dropped successful reply,
standalone offline launch, Android, signed IPA/APK, notification/background timer
matrix and mainland cellular network. Expo Go is native runtime evidence, not
signed application or store-release acceptance. Language consistency cleanup is
next; explicit Chinese selection worked, but technical labels need localization.

### Earlier desktop / protocol evidence

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
| Native (before phone session above) | SDK dependency/JS/type/lint checks | JS checks alone did not establish native behavior |

Auth files, response payloads and complete local logs stay outside Git in the
task's `deliverables/2026-10-26-mobile-native-acceptance`. Never publish session
tokens, signed previews or the user's private acceptance phrases. A restored
chat is prose only; its old proposals cannot execute again.

## Build prerequisites and next commands

The workstation is now logged into the maintainer's free Expo account. It has
no Android SDK or current Android JDK. Existing EAS preview/development
profiles specify internal APK distribution. The maintainer must provide their
Expo login/project and approve the permanent Android package identifier before
we set `owner`, `extra.eas.projectId` and `android.package`. No paid build or new
account has been started by the agent. The iPhone test used a temporary tunnel;
an independently signed application still needs its own build and installation.

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

## Standalone application gates (still required)

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
