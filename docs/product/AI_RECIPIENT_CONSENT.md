# AI recipient consent rollout

Prepared 2026-10-28 from `9a63a88`. The first step added a public descriptor and
request contract without enforcement. The server change followed the matching
client updates and live descriptor check; exact rollout evidence is below.
No real model call, production configuration change or retention promise is made here.

## Contract and resolution

`GET /api/ai/coach` already uses `Cache-Control: no-store`. Its new `recipient`
field is either `{id, name, origin, model}` or `null`. Resolution uses the actual
configured endpoint, not the SDK/provider label. Only reviewed direct HTTPS API
bases on `api.deepseek.com` and `api.openai.com` are recognized. A relay, local
endpoint, nonstandard path, URL credential, query or fragment returns `null`.
Neither API keys nor server URL paths are included in the public descriptor.

The opaque SHA-256 policy ID covers the reviewed policy version, current category
consent version, category-list hash, endpoint origin/path and configured model.
Changing any of those requires a fresh consent value. Rotating an API key does
not identify a new recipient. The token is public and is not authentication,
proof of a click, permission to save data or a model-output trust signal.
The configured name is not a claim about a provider's currently served checkpoint;
server aliases and provider-managed aliases remain separate from this binding.

Coach and review schemas accept an optional bounded `recipient` token so an old
request reaches the renewal response, rather than failing schema validation.
The enforcement release rejects a missing/stale token; it does not treat an old
`coach-model-v2` stored value as consent to an arbitrary recipient.

## Model call inventory and next release gates

| Entry | Actual model path | Implemented binding |
| --- | --- | --- |
| `/api/ai/coach` | `runCoach` → AI SDK; tools include plan preparation | Web/mobile saved consent and body token bind to the current descriptor before reads/quota/model calls |
| `/api/workout-review` without an action | `reviewWorkout` → `callAiProviderForJson` | Web/mobile review cards send the body token; acceptance/rollback creates previews without calling a model |
| `/api/ai/generate-training-plan` | `generateStructuredTrainingPlan` → `callAiProviderForJson` | Legacy page discloses the recipient/data and sends the header token, including guest profile inputs |
| `/api/ai/generate-nutrition-plan` | `generateStructuredNutritionPlan` → `callAiProviderForJson` | Same legacy-page gate, independent of the coach availability flag |

The approval ledger endpoints store, approve or execute proposals; they are not
an extra model transport. `/api/ai/parse-log` is the read-only rule parser.
No separate mobile approval ledger or altered confirmation rule is needed.

Before enforcing the binding, deploy this additive status response and inspect
its sanitized production descriptor without reading a key or invoking a model.
The server enforcement change checks all four listed routes before profile/tool
reads, quota reservation or model work (authentication may run first). Coach and
review use body `recipient`; legacy plan routes use `X-LiftCut-AI-Recipient`.
Accepting or rolling back an existing review uses no model and keeps its ledger
rules. One checked provider config is retained through the actual call, and model
HTTP redirects are refused so they cannot silently change the recipient.
Missing/stale tokens return HTTP 409 `AI_CONSENT_REQUIRED`
and an actionable renewal/update message, and unreviewed recipients with
`AI_RECIPIENT_UNREVIEWED`. Do not silently resend a user's request after renewal.

Test opt-out, recipient/model changes, stale tabs, old clients, guest/account
separation and renewal before quota/data/model access. Browser and native tests
remain distinct. A matching endpoint establishes the technical recipient, not
provider retention/training terms, processing locations or App Store approval.

## Evidence and deployment record

- Integrated local checks: root TypeScript, 20 JavaScript + 310 TypeScript tests,
  full lint (zero errors, two pre-existing research warnings), and Next/Turbopack
  production build passed. A temporary dependency-junction root override was restored.
- Focused W1b API browser check passed 1/1 with local PostgreSQL 16 and real Next
  routes, using synthetic Auth-contract and model doubles. It checked all four
  missing/stale-token boundaries, no quota/model work, and explicit resending
  of the previously rejected request ID after renewal. It is not GoTrue or
  real-provider evidence. Client UI and mobile results are in the product log;
  Expo web, JavaScript export and simulator builds do not prove signed-device behavior.
- Additive status rollout: #204 merged as
  `244f5af38b62aa8fac124a0397f73437c6b2e089`; exact-source Vercel deployment
  `dpl_8z2amjVeYi5bX3UhcBq8TQH7KGAh` was READY with production aliases.
  On 2026-10-28 at 11:15:23 UTC, public `/api/ai/coach` returned HTTP 200,
  `Cache-Control: no-store`, `available:true`, `consentVersion:coach-model-v2`,
  recipient `DeepSeek`, origin `https://api.deepseek.com`, configured model
  `deepseek-v4-flash`, and policy ID
  `b38390ef7bad1c3d530820bffb7941115a6997f5e14b9b97e23f5aff261b4da2`.
  This was public status readback only, with no model call or secret read.
- Client/enforcement releases below passed every required check before merge;
  each merge tree matched its tested head. The exact-source deployments were
  READY with production aliases. Deploying shared/mobile source on Vercel is
  not distribution or acceptance of an independent iPhone installation.

| PR / scope | Merge source | READY deployment |
| --- | --- | --- |
| #206 mobile recipient client | `098b5bb676558b886e32ffbabc2c8e00b1a23691` | `dpl_DJ8Tcbi5ZvB9BLDyBJmNxGC99URk` |
| #207 web recipient client | `94c3c98d38879ced9fb52be04542675a03fa871e` | `dpl_ADwAcFdgrLhbkebF6nyZVJJWANzH` |
| #208 scoped native S256 | `ce0f0b07c5280d2425edb65136018348ba0976fd` | `dpl_AggMkKhYkdVDtr4fkyh9Tdb2PUJx` |
| #209 server enforcement | `503c6782fa1066ae822e43785e8913c52afd18d3` | `dpl_9ARSNv2PjMu4ozz7ZoNPNTUKyVCF` |

- At 2026-10-28 11:54:03 UTC, six production refusal checks passed:
  coach/training-plan/nutrition-plan routes, each with missing and stale recipient,
  returned HTTP 409 `AI_CONSENT_REQUIRED` with `Cache-Control: no-store`.
  These used synthetic guest mode only: no real account, signed guest session,
  valid-recipient model request or write endpoint. Production workout-review was
  not called because it requires authenticated identity; its boundary is covered
  by the separate local four-route test above. No positive real-model, native
  interaction or complete production conversation flow is claimed by this smoke.
- The policy token is publicly readable and is not a server-side consent receipt.
  Clients require an explicit saved choice; a matching request token only proves
  configuration compatibility. Existing write confirmations remain separate.

Official endpoint references checked 2026-10-28:
[DeepSeek API](https://api-docs.deepseek.com/) and
[OpenAI API reference](https://developers.openai.com/api/reference/overview).
