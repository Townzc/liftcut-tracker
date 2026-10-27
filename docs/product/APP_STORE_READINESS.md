# App Store preparation — not submission approval

Audited 2026-10-26 against `ad8fdbc` and the existing simulator build. FIG planning
lives in its separate repository; this document concerns the released LiftCut
product. No Apple enrollment, paid service, new build, migration or M4 run is
part of this preparation. The simple UI and existing write protocol are unchanged.

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

## Remaining gates and free work queue

| Gate | Actual state and next bounded change | Evidence required |
| --- | --- | --- |
| Native account lifecycle | Only email/password login exists; the hint tells users to register on the web. Add in-app registration and recovery in a focused PR. | Synthetic-account success, validation, expired links, cancellation and existing-login regressions |
| Account deletion | No account deletion API/UI found. Implement authenticated self-deletion with a separate explicit confirmation and truthful failure states. | Isolated test accounts only; cross-owner denial, retry recovery and old-owner queue/session cleanup; do not execute deletion on real users during preparation |
| Privacy/support | Dedicated public pages and mobile entry points are absent. Confirm operator contact, retention and actual recipients, then publish accurate bilingual pages reachable before login and from settings. | Public URLs, rendered device-width checks, working contact and matching in-app disclosures |
| AI permission | Category allowlist and opt-in/revoke exist, but the recipient is described generically as a model. Disclose the actual configured recipient before sending. | Code/payload/disclosure agreement; opt-out sends nothing; no guessing provider retention terms |
| Privacy labels | Draft inventory below; SDK manifests do not cover server processing. | Complete app + processor/logging/backup inventory, linked-data and tracking assessment |
| Export compliance | `ITSAppUsesNonExemptEncryption` is unset. Assess actual cryptography/SDKs and applicable exemption before answering. | Reviewed declaration and any required documentation; do not set a value just to silence EAS |
| Store metadata | Bilingual draft below; screenshots, support/privacy URLs, rating questionnaire and review account remain missing. | Screenshots from the actual signed build; synthetic reviewer account and reproducible steps |
| Signed device | Simulator compilation and Expo Go evidence exist; standalone installation matrix is unrun. | [IOS_BUILD gates](IOS_BUILD.md#independent-installation-gate), artifact/source/signing identity and iPhone observations |
| Store distribution | Apple membership and App Store Connect record are absent. No signing or submission attempted. | Maintainer enrollment when ready; registered App ID, valid profile/certificate, reviewed quota/environment |
| Mainland availability | Existing website filing is not proof of APP filing or AI application paperwork. | Verify relevant APP/AI requirements and filed identity before selecting mainland availability |

Email/password login does not itself require Sign in with Apple. Opening an
external registration webpage does not remove Apple's account-deletion
requirement. A support email or a sign-out button is not account deletion.
Do not put real review credentials or user data in this file or a public PR.

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
how to reach privacy/account deletion once implemented. Provide final working
steps and credentials in App Store Connect only after release testing.

## Official references checked

- [EAS profile schema](https://docs.expo.dev/eas/json/) and [iOS submission](https://docs.expo.dev/submit/ios/).
- [Apple account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).
- [Review guidelines](https://developer.apple.com/app-store/review/guidelines/) and [privacy details](https://developer.apple.com/app-store/app-privacy-details/).
- [Privacy manifests](https://docs.expo.dev/guides/apple-privacy/) and [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/).
