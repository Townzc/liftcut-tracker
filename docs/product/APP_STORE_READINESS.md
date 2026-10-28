# App Store preparation — not submission approval

Initial build audit: 2026-10-26 against `ad8fdbc` and the existing simulator build.
Account-release status updated 2026-10-27 for `ab7fb3c`; the verified web/API
rollout is recorded separately below. FIG planning stays in its own repository.
No Apple enrollment, new paid service, signed-device acceptance or M4 training
is claimed. The simple UI and existing write protocol are unchanged.

## Build and configuration checks

`ios-store` is a separate explicit Release/device/store profile with production
environment selection. `preview` remains ad hoc/internal; `ios-simulator` remains
simulator-only. There is no submission profile, automatic upload or invented
App Store Connect ID. All profiles currently share one bundle ID: installing a
different signed variant can replace the app; do not assume parallel installs.

Run the read-only local check from the repository root:

```sh
node scripts/check-ios-store.mjs
# Optional JSON object containing ONLY the three reviewed EXPO_PUBLIC_* variables:
node scripts/check-ios-store.mjs --public-env /outside-repo/reviewed-public-only.json
node --test tests/ios-store-preflight.test.mjs
```

No `.env` is loaded, network request sent, secret value printed or build started.
Exit 1 means configuration inputs are missing/invalid; exit 2 means configuration
is valid but the release gates below remain open. This command never grants
permission to submit. The public key check validates format/role, not authenticity.
Verify current project/environment values independently before a real build.
Only EAS **preview** variables have been read back so far; production is unverified.
Changing a reviewed endpoint/project requires explicit re-review of the checker.
Skipped signing, custom workflows/prebuild commands/archive paths and a changed
email callback scheme also require review; valid Release flags alone are insufficient.

## Remaining gates and free work queue

| Gate | Actual state and next bounded change | Evidence required |
| --- | --- | --- |
| Native account lifecycle | Password login remains available. Registration and email callback code are prepared behind default-off `EXPO_PUBLIC_MOBILE_EMAIL_SIGNUP`; [handoff plan](MOBILE_EMAIL_AUTH.md) records the stages. | Local captured mail/controller tests are not signed-device acceptance. Verify real SMTP, native secure RNG/SHA-256, cold/warm/repeated links, cancellation and existing-account protection before enabling; recovery remains separate |
| Account deletion | Production web/API enabled after reviewed migrations, real synthetic hosted acceptance and cleanup; see [release evidence](ACCOUNT_RELEASE.md#production-rollout-evidence--2026-10-27). New mobile deletion independently requires default-off `EXPO_PUBLIC_MOBILE_ACCOUNT_DELETION=true`; prior confirmed intents/receipts retain recovery. | Hosted HTTP/Auth/Storage and earlier local browser checks are separate from native acceptance. Keep the mobile gate off until signed-device deletion, storage, cold restart and recovery pass. Never delete real users for release tests |
| Support | Bilingual `/support` with explicit language and mobile login/settings links are implemented. Maintainer confirmed `townzc1@gmail.com` for public contact. | Local browser/Expo web checks passed; both production page languages returned 200 with the expected contact on 2026-10-27. Signed-device link opening remains unrun |
| Privacy | Public bilingual `/privacy`, web auth/settings entries and mobile sign-in/settings links are implemented; links preserve the selected language and send no account data. Verified processor/retention details remain open; see [disclosure preparation](PRIVACY_DISCLOSURE.md). | Four synthetic Expo web link checks (Chinese/English × sign-in/settings) passed; signed-device opening and final in-app/recipient disclosures remain unverified. A policy page alone does not complete AI-recipient or deletion requirements |
| AI permission | Category allowlist and opt-in/revoke exist, but the recipient is described generically as a model. Disclose the actual configured recipient before sending. | Code/payload/disclosure agreement; opt-out sends nothing; no guessing provider retention terms |
| Privacy labels | Draft inventory below; SDK manifests do not cover server processing. | Complete app + processor/logging/backup inventory, linked-data and tracking assessment |
| Export compliance | `ITSAppUsesNonExemptEncryption` is unset. Assess actual cryptography/SDKs and applicable exemption before answering. | Reviewed declaration and any required documentation; do not set a value just to silence EAS |
| Store metadata | Bilingual draft, support and public privacy pages exist; signed-build screenshots, rating questionnaire, final Store form entries and review account remain missing. | Screenshots from the actual signed build; final disclosure review, synthetic reviewer account and reproducible steps |
| Signed device | Simulator compilation and Expo Go evidence exist; standalone installation matrix is unrun. | [IOS_BUILD gates](IOS_BUILD.md#independent-installation-gate), artifact/source/signing identity and iPhone observations |
| Store distribution | Apple membership and App Store Connect record are absent. No signing or submission attempted. | Maintainer enrollment when ready; registered App ID, valid profile/certificate, reviewed quota/environment |
| Mainland availability | Existing website filing is not proof of APP filing or AI application paperwork. | Verify relevant APP/AI requirements and filed identity before selecting mainland availability |

Email/password login does not itself require Sign in with Apple. Opening an
external registration webpage does not remove Apple's account-deletion
requirement. A support email or a sign-out button is not account deletion.
Do not put real review credentials or user data in this file or a public PR.

### Current free preparation and remaining activation gates

- Web password recovery is deployed. Actual local Next/GoTrue/SMTP-capture/browser
  tests cover new-tab PKCE, verified identity, password update and preserved B
  login while recovering A. Captured local mail does not prove public delivery.
- Production web/API deletion is enabled, with a
  one-hour write receipt, completion-only verification after expiry, avatar API
  cleanup and owner fences. Reviewed backup/restore, three migrations, approved
  server-only configuration, isolated hosted acceptance and cleanup passed before
  exact-deployment promotion. New mobile
  initiation has its own default-off build gate; prior owner-bound intent/receipt
  recovery remains usable even when it is off. See
  [account release evidence and native gates](ACCOUNT_RELEASE.md); no real-user
  deletion or hosted browser/native interaction was part of that runner.
- Native registration/callback code is behind an off-by-default build flag. Slow
  local storage now preserves the original cold-start URL. Real SMTP, native
  secure crypto and signed iPhone warm/cold/replayed links still gate activation.
- Resend Free is a prepared option, not an opened account or configured sender.
  Verify the sending domain, authorized credentials and delivery when approved;
  do not ask for passwords or API keys in a public chat.
- Verify the actual AI recipient, processor terms, logging and backup retention,
  then bind recipient changes to renewed consent before final Store disclosures.
  Historical migration backups and exported copies are not instantaneously
  erased by online account deletion; no unverified retention period is promised.
- Apple membership/signing and a standalone phone acceptance remain later gates.
  No paid enrollment, signed IPA, App Store submission or M4 training ran here.

## Data inventory draft

This is a source audit for preparing disclosures, not the finished privacy policy
or App Store privacy questionnaire. Provider contracts and live logging/retention
settings have not been audited here.

| Data | Observed path / purpose | Disclosure work |
| --- | --- | --- |
| Email, account ID, auth session | `apps/mobile/src/lib/supabase.ts`, `session.tsx`; sign-in/refresh, account-owned API requests | Supabase authentication; sessions currently persist through AsyncStorage; do not claim encrypted application storage |
| Workout/body/food/goals | `packages/core/src/model-data.ts`, mobile API/outbox and shared server tools | Identify Fitness/Health/User Content categories and linkage; server data remains separate from chat history |
| Chat, drafts, sources, proposals | `coach-history.ts`, `coach-history-context.tsx` and web history services | Distinguish local unsent drafts from synced chats and selected model context; chat deletion is not account-data deletion |
| AI context | `MODEL_DATA`, coach consent and `src/services/ai/config.ts` | Explicit field allowlist; disclose actual recipient/configuration and purposes; six turns is a context window, not a retention limit |
| Device-local preferences/queue | Locale and SQLite outbox, `outbox-store.ts` | Offline pending state, logout/account switching and deletion behavior need signed-device verification |
| Infrastructure diagnostics | Hosting/auth/model providers and app timing/error paths | Verify identifiers, IP/log fields, retention and subprocessors before privacy answers; no unsupported "no collection" claim |

## Existing native artifact audit

Read-only inspection of EAS simulator build
[`8e216aa6`](https://expo.dev/accounts/zhicetang/projects/liftcut/builds/8e216aa6-d5bb-4903-b8d7-7084d394a04d),
source `f3a0a80326180a23c61a40ff231f5f4ff027bfc6`:

- Bundle `com.liftcuttracker.app`, version 0.1.0/build 1, platform iPhoneSimulator,
  SDK 27.0, minimum OS 16.4; no device provisioning profile.
- ATS blocks arbitrary HTTP and permits local networking. No `NS*UsageDescription`
  entries were present. This does not prove the absence of every permission/API.
- Fourteen `PrivacyInfo.xcprivacy` files include app/RN/Expo/AsyncStorage declarations
  for UserDefaults, FileTimestamp, SystemBootTime and DiskSpace required-reason APIs.
  Empty SDK collected-data arrays do not describe LiftCut's server data handling.
- Encryption declaration is absent. No new native build or phone test ran for
  this audit; repeat against the final signed artifact before submission.

## Draft store copy and screenshot plan

Not uploaded. Reconcile all claims against the eventual signed release.

| Field | English draft | 简体中文草稿 |
| --- | --- | --- |
| Name | LiftCut | LiftCut |
| Subtitle | Record, confirm, keep control | 记录训练，确认每一次改变 |
| Description | Keep your workout records in one conversation. Review proposed changes, confirm what you completed, and correct a saved set with its source intact. Pending sync stays visible when the connection drops. | 在一段对话里整理训练记录. 先查看修改，再确认实际完成的内容；更正时保留来源. 网络中断时，待同步状态清晰可见. |

Capture actual screens in each language: today's training with unknown values;
an unconfirmed proposal; a confirmed receipt with source; a correction preview;
and pending sync. Use synthetic data; keep kg/cm/RPE abbreviations. Do not label
Expo Go screenshots as standalone-app evidence or advertise an on-device M4 model.

Review-note draft: sign in using the privately supplied synthetic reviewer
account; choose its prepared workout; inspect a proposal before confirming;
verify a receipt and same-record correction. Explain offline pending state and
how to reach privacy and the available account-deletion entry. Provide final working
steps and credentials in App Store Connect only after release testing.

## Official references checked

- [EAS profile schema](https://docs.expo.dev/eas/json/) and [iOS submission](https://docs.expo.dev/submit/ios/).
- [Apple account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).
- [Review guidelines](https://developer.apple.com/app-store/review/guidelines/) and [privacy details](https://developer.apple.com/app-store/app-privacy-details/).
- [Privacy manifests](https://docs.expo.dev/guides/apple-privacy/) and [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/).
