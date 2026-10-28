# Privacy disclosure preparation

Original source baseline: `421bac62846b925c11f9073a151ed857a7d7987a`, checked 2026-10-26.
Deletion disclosure reconciled against `4437c95` on 2026-10-27; activation evidence
belongs in [account release gates](ACCOUNT_RELEASE.md), not an assumed policy claim.
This is free release preparation, not App Store approval. No real records, model
calls, migrations, mail, paid services or M4 work are part of this change.

## Implemented scope

- Public bilingual `/privacy?lang=zh-CN|en`, maintained by LiftCut Tracker project
  author Zhice Tang; confirmed contact: `townzc1@gmail.com`.
- Web auth forms and settings link to the current interface language. Exact
  `/privacy` bypasses server auth/profile reads, client profile bootstrap and
  Agent prefetch. It does not weaken protected or lookalike routes.
- AI data categories render from `MODEL_DATA`; the public notice is not consent.
  Existing consent/revoke, confirmation, provenance and idempotency stay intact.
- Web/native self-service deletion now shares one confirmation/recovery controller
  behind a server gate. The policy describes the conditional entry, recent
  reauthentication, explicit confirmation and owner-only local cleanup.
- Historical migration/provider backups, exports, other-device copies and
  unattributed legacy drafts are outside immediate cleanup; retention is not
  invented. Mobile sign-in/settings privacy links are implemented with the current
  UI language; signed-device opening remains open. Recipient consent now binds the
  reviewed technical API origin, configured model and data policy on web/mobile;
  see the staged [recipient rollout and evidence](AI_RECIPIENT_CONSENT.md).

## Source-backed inventory

| Data / behavior | Source | Disclosure consequence |
| --- | --- | --- |
| Auth/session and local persistence | `apps/mobile/src/lib/supabase.ts`; web auth provider | Do not claim app-level encrypted local storage or that logout erases everything |
| Body, food, workout, preferences and plan context | `packages/core/src/model-data.ts`; shared record tools | Model category list includes sensitive notes and free text, not just anonymous numbers |
| Recent conversation window | `packages/core/src/coach-chat.ts` | Six turns bounds a request, not server history retention |
| Chats and pending clarification | `src/services/ai/coach-history-store.ts`; coach context store | Chat/preview persistence can precede business confirmation |
| Sources, previews, receipts and revisions | Workout review store; `src/services/agent/store.ts` | Confirmation is not the first time every item is stored; undo retains history |
| Configurable AI provider/endpoint | `src/services/ai/config.ts`, `recipient-policy.ts` | The descriptor resolves the actual configured API base, not its SDK label; it does not establish contractual processing/retention terms |
| Guest records/import, local drafts and queues | `src/services/guest-fact-migration.ts`; mobile outbox/history | Cloud AI requests leave the device even when guest records are local |
| Error/timing paths and infrastructure | AI route diagnostics, hosting/auth services | Do not infer no logs, no tracking or a retention period from absence of an analytics SDK |

## Runtime facts and open checks

- Parent task read-only checks: Supabase project region `ap-northeast-2`, Free
  plan; built-in email service, no custom SMTP. The dashboard warns its built-in
  mail service is unsuitable for production. No account/token values belong here.
- The additive public status descriptor allows sanitized runtime verification
  without exposing keys or server URL paths. Record the actual production
  readback and enforcement deployment in [the rollout record](AI_RECIPIENT_CONSENT.md)
  before treating this source implementation as live. Model aliases do not
  establish the backend checkpoint; no default source URL is runtime proof.
- Verify applicable API terms, any downstream processing or relay,
  retention/training controls, function regions, logs/drains, database backups,
  avatar objects and mail handling before final release disclosures.
- Project region is not a guarantee that every provider processes all data in
  that country. No global business TTL was found; do not invent a duration.
- Apple privacy labels still need the complete pipeline assessment: email/user
  ID, health/fitness, content/avatar and diagnostics are candidates, not submitted
  questionnaire answers. SDK manifests alone do not describe server processing.

## Bounded next steps

1. Verify the staged recipient rollout and signed-device consent behavior. Web,
   mobile and legacy plan requests now bind to a reviewed recipient; unreviewed
   endpoints fail closed, changed policies require a new choice and requests are
   not automatically resent. The public token is not proof of a click or a write
   approval, and does not establish provider retention/training terms.
2. Verify each deletion rollout: migrations, configured gate, online ledgers,
   Storage objects, owner-only local cleanup, partial failures and safe retries.
   Verify old tokens/queues cannot restore deleted data; record actual evidence.
3. Keep both policy languages aligned with the available flow. Support is a
   fallback for unavailable entry or unresolved outcomes, not instant deletion
   or an App Store-compliant substitute for in-app initiation.
4. Verify the implemented mobile privacy links on a signed device, separately from browser,
   Expo Go, JS bundle and unsigned simulator results.

## Provider facts checked 2026-10-28

This is a bounded public-source review, not a legal conclusion or verification of
this account's contracts/settings. Clarifying the applicable agreement and allowed
data scope remains a Store release gate, particularly for injury/health notes.
No provider was contacted and no account, setting, service or runtime was changed.

- **DeepSeek direct API:** [Open Platform terms](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html)
  sections 3.5/5.5 require downstream disclosure and distinguish the developer's
  and end users' processing. They do not establish API-specific zero retention or
  no-training guarantees. The [public privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
  describes improvement/training, rights to request training opt-out, processing
  and storage in China, variable retention, and restrictions on sensitive data
  including health. Do not assume these general statements settle every API
  payload's treatment, or that an app opt-in changes provider controls. Confirm
  API-specific scope, supported controls and the injury-note use case before
  claiming a provider guarantee.
- **Supabase:** the [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum)
  limits covered processing to instructions/purposes and describes selected-region
  storage/primary processing with exceptions. Its 30-day post-agreement return/
  deletion term is not a per-user deletion SLA. It separately requires a BAA for
  HIPAA PHI; ordinary fitness data must not automatically be called HIPAA PHI.
  The [Free log window](https://supabase.com/kb/troubleshooting/check-usage-for-monthly-active-users-mau-MwZaBs)
  is one day of user access, not proof of physical erasure. [Backup documentation](https://supabase.com/docs/guides/platform/backups)
  recommends exports for Free projects and states database backups exclude
  Storage object bytes. Verify actual copies and settings before promising a
  retention/deletion period; this review did not read production configuration.
- **Vercel:** [runtime log windows](https://vercel.com/docs/logs/runtime) vary by
  plan (Hobby one hour, Pro one day, Observability Plus 30 days); exported drains
  and other copies are separate. Its [DPA](https://vercel.com/legal/dpa) permits
  US/global processing, lacks a fixed per-user deletion deadline and restricts
  sensitive/special-category Customer Data. Clarify the applicable agreement and
  injury/health scope; do not infer that consent alone resolves it. [Infrastructure backups](https://vercel.com/docs/security/compliance)
  have a documented 30-day window but do not prove every API body is backed up.
  The [optional training program](https://vercel.com/changelog/updates-to-terms-of-service-march-2026)
  has Team/Project Data Preferences for code, agent chats and build/usage data;
  this is not proof that LiftCut fitness conversations are training inputs.
  Actual preferences are unverified. AI Gateway retention controls do not apply
  automatically to our direct DeepSeek transport.

## Official references checked 2026-10-26

- [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/):
  accessible privacy policy and explicit permission before sharing with third-party AI.
- [Apple deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion):
  in-app initiation; ordinary apps cannot require an email/support request instead.
- [Apple privacy labels](https://developer.apple.com/app-store/app-privacy-details/):
  disclose actual app and third-party collection, purposes and linkage.
- [Supabase user deletion](https://supabase.com/docs/guides/auth/managing-user-data):
  outstanding JWTs and owned Storage objects need separate handling.
- [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum):
  its 30-day contract-termination period is not a per-user deletion SLA.
- [DeepSeek platform terms](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html)
  and [privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html):
  downstream applications must disclose their own processing; consumer terms do
  not establish an API-specific no-training or zero-retention promise here.

## Verification

Actual commands, outcomes, limitations and screenshot locations are recorded in
the corresponding [product log](PRODUCT_LOG.md) entry. The browser fixtures use
synthetic sessions and intercepted auth refresh; no production identity is used.
