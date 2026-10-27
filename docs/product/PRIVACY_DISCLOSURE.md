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
  UI language; signed-device opening and verified recipient-bound consent remain open.

## Source-backed inventory

| Data / behavior | Source | Disclosure consequence |
| --- | --- | --- |
| Auth/session and local persistence | `apps/mobile/src/lib/supabase.ts`; web auth provider | Do not claim app-level encrypted local storage or that logout erases everything |
| Body, food, workout, preferences and plan context | `packages/core/src/model-data.ts`; shared record tools | Model category list includes sensitive notes and free text, not just anonymous numbers |
| Recent conversation window | `packages/core/src/coach-chat.ts` | Six turns bounds a request, not server history retention |
| Chats and pending clarification | `src/services/ai/coach-history-store.ts`; coach context store | Chat/preview persistence can precede business confirmation |
| Sources, previews, receipts and revisions | Workout review store; `src/services/agent/store.ts` | Confirmation is not the first time every item is stored; undo retains history |
| Configurable AI provider/endpoint | `src/services/ai/config.ts`, `coach-config.ts` | Public provider/model labels do not prove the receiving endpoint or contractual processor |
| Guest records/import, local drafts and queues | `src/services/guest-fact-migration.ts`; mobile outbox/history | Cloud AI requests leave the device even when guest records are local |
| Error/timing paths and infrastructure | AI route diagnostics, hosting/auth services | Do not infer no logs, no tracking or a retention period from absence of an analytics SDK |

## Runtime facts and open checks

- Parent task read-only checks: Supabase project region `ap-northeast-2`, Free
  plan; built-in email service, no custom SMTP. The dashboard warns its built-in
  mail service is unsuitable for production. No account/token values belong here.
- Production public coach status identifies `deepseek` / `deepseek-flash` /
  `coach-model-v2`. The model name is a UI alias. The sensitive base-URL value
  could not be read back; do not treat the default source URL as runtime proof.
- Verify the actual endpoint origin/operator and any relay, applicable API terms,
  retention/training controls, function regions, logs/drains, database backups,
  avatar objects and mail handling before final release disclosures.
- Project region is not a guarantee that every provider processes all data in
  that country. No global business TTL was found; do not invent a duration.
- Apple privacy labels still need the complete pipeline assessment: email/user
  ID, health/fitness, content/avatar and diagnostics are candidates, not submitted
  questionnaire answers. SDK manifests alone do not describe server processing.

## Bounded next steps

1. Disclose a reviewed actual AI recipient before requests, reusing existing
   category consent; bind subsequent changes to renewed consent. Do not label a
   custom endpoint as OpenAI merely because an OpenAI-compatible SDK is used.
2. Verify each deletion rollout: migrations, configured gate, online ledgers,
   Storage objects, owner-only local cleanup, partial failures and safe retries.
   Verify old tokens/queues cannot restore deleted data; record actual evidence.
3. Keep both policy languages aligned with the available flow. Support is a
   fallback for unavailable entry or unresolved outcomes, not instant deletion
   or an App Store-compliant substitute for in-app initiation.
4. Verify the implemented mobile privacy links on a signed device, separately from browser,
   Expo Go, JS bundle and unsigned simulator results.

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
