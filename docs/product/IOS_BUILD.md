# Independent iOS build preparation

## Status and evidence boundaries

The maintainer has a free Expo account and has tested continuous training in
Expo Go on an iPhone 16 Pro. They do **not** have Apple Developer Program
membership and requested free preparation first. No signing enrollment, paid
build, store submission, new M4 training or production migration is authorized
by this preparation. [Existing device evidence](MOBILE_ACCEPTANCE.md) remains
Expo Go evidence, not acceptance of a standalone installation.

- `com.liftcuttracker.app` is the local iOS bundle identifier, derived from the
  project's domain. It has not been registered with Apple; verify availability
  and ownership before creating the permanent App ID.
- `preview` builds an internal Release application with its JS embedded, not a
  development client requiring Metro. On iOS it requires an ad hoc signature.
- `ios-simulator` inherits Release configuration but targets a simulator. It is
  not an IPA and cannot be installed on an iPhone.
- `ios-simulator.yml` uses a standard GitHub-hosted Mac runner for this public
  repository, Xcode 26.6, and no signing credentials. It generates the native
  project, installs Pods, compiles Release and checks for an embedded JS bundle.
  Artifacts expire after three days. This is compilation evidence only, not a
  runtime, login, network or physical-device test. The job refuses private repos.
- Simulator CI uses an invalid test API URL and no Supabase credentials. Its
  artifact deliberately cannot sign in to production. Do not redistribute it as
  a usable test release. The actual phone build must embed the reviewed public
  HTTPS configuration and go through the acceptance gates below.

## Free preparation and local archive check

From `apps/mobile`, with the maintainer's existing Expo login:

```sh
npx eas-cli@latest whoami
npx expo-doctor
npm run typecheck
npm test
# Commit source first. Use a new directory OUTSIDE the repository; no --force.
npx eas-cli@latest build:inspect --platform ios --profile ios-simulator --stage archive --output <new-directory>
```

The root `.easignore` replaces all nested gitignore rules. Its allowlist retains
the mobile config, source, assets, lockfile and `packages/core`, while excluding
web/research trees, credentials, local environments, health data, weights,
dependency trees and generated native projects. Inspect the **actual** copied
archive, including untracked files: ignore patterns alone are not proof. No
archive inspection command starts a cloud build.

For a Mac with Xcode 26.6 and CocoaPods, reproduce the native CI commands in
`.github/workflows/ios-simulator.yml`. Never hand-edit generated `ios/` files.
Windows can inspect/configure/export JS but cannot run Xcode. A simulator
compile must not be relabeled as acceptance on iOS 27.0.1.

## Accounts, signing and costs

Checked against official documentation on 2026-10-26; verify again before any
purchase or cloud build. No purchase is necessary to finish the steps above.

| Item | Current status / next requirement |
| --- | --- |
| Expo account | Existing free account is logged in. EAS project ownership/ID and preview environment still need linking before cloud builds. No new account needed. |
| EAS Build | Published Free plan includes 15 iOS builds/month in the low-priority queue; account's remaining quota is not yet verified. Do not upgrade or consume paid overflow automatically. |
| Apple Developer Program | Missing. USD 99/year or local currency; required for normal EAS ad hoc distribution and TestFlight. Purchase only after explicit maintainer authorization. |
| Ad hoc signing | After enrollment: Apple Team, registered App ID, distribution certificate, provisioning profile and this iPhone's UDID. Additional devices require a new profile/build. |
| TestFlight | Later alternative: App Store Connect app and upload authorization. External testers may require Apple review. No store submission in this preparation. |
| Free personal signing | A Mac with compatible Xcode and a personal Apple Account can install on one's own device; profiles expire after seven days. This Windows workstation cannot perform that path. |

Sources: [Expo pricing](https://expo.dev/pricing),
[Expo internal distribution](https://docs.expo.dev/build/internal-distribution/),
[Apple membership](https://developer.apple.com/programs/whats-included/),
[Apple personal team](https://developer.apple.com/help/account/basics/about-your-developer-account),
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Before a phone build, link the intended existing Expo owner/project; review its
remaining free quota. Set only `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_SUPABASE_URL` and the public anon/publishable key for the preview
environment. They ship in the binary. No service-role, database, model key,
account session or loopback test relay belongs in a release. Verify the actual
resolved build configuration before starting the signed build.

## Independent installation gate

Record source SHA, build ID, signing Team/profile/expiry, bundle ID/version,
artifact SHA-256, device/OS/network and observations. A download link alone is
not installation evidence. Keep test credentials and full health records local.

1. Install the signed app, stop Metro and Expo Go, cold launch, sign in with the
   isolated synthetic account, and verify token refresh and streaming.
2. Run preview → explicit confirm → eight intervening turns → same-ID correction
   → inherit confirmed load → void → separately confirmed redo. Read server
   IDs/revisions/counts; prose saying "saved" is insufficient.
3. Restore chat, draft and locale after screen switching and force-close; history
   restores text with old confirmations disabled. Unknown data remains unknown.
4. With a cached active workout, confirm offline, terminate the app and cold
   launch still offline. Pending data must remain pending. Reconnect while on
   Agent; automatic sync writes exactly once, including a lost-success-response
   retry. No manual sync should be needed for a transport failure.
5. Expired proposals and another owner's data are rejected. Account switching
   cannot replay the old owner's queue. Check keyboard, units and both languages.

The corresponding [full matrix](MOBILE_ACCEPTANCE.md) stays open until each
signed-app result has evidence. UI structure, shared approval/outbox semantics,
source checks and parser defaults are unchanged by build preparation.
