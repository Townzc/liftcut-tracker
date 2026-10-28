# AI recipient consent rollout

Prepared 2026-10-28 from `9a63a88`. The first step added a public descriptor and
request contract without enforcement. The subsequent server change below must
deploy after the matching client updates and live descriptor check. No real
model call, production configuration change or retention promise is made here.

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
- Deployment fields remain pending until the release owner records the actual
  status readback time, sanitized origin/configured model, enforcement source SHA
  and READY deployment. Do not fill these from defaults or a local build.
- The policy token is publicly readable and is not a server-side consent receipt.
  Clients require an explicit saved choice; a matching request token only proves
  configuration compatibility. Existing write confirmations remain separate.

Official endpoint references checked 2026-10-28:
[DeepSeek API](https://api-docs.deepseek.com/) and
[OpenAI API reference](https://developers.openai.com/api/reference/overview).
