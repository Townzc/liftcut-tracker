# Model-policy adapter: protocol, accounting and reproducibility

Date: 2026-09-28. The adapter connects the existing eight-tool environment to
native Chat Completions function calls. It supports an explicit compatible HTTP
endpoint and a credential-free mock transport. The mock wraps the fixed workflow;
its scores, tokens and latency are synthetic and do not measure a model.

## Request and execution contract

Each turn sends the versioned system prompt, public observations, accumulated
assistant/tool messages, external user events and the existing tool schemas.
Scenario labels, future simulator responses and fault schedules remain outside
the policy. A tool result is paired with its `tool_call_id`; subsequent user
confirmation is a separate user message, not invented by the model.

The request requires tools and the parser accepts exactly one function call.
Unsupported/multiple calls, duplicate JSON argument keys, non-finite values,
refusals and truncated output fail the episode. There is no regex extraction,
JSON repair or automatic model retry. Syntactically valid arguments reach the
environment unchanged; invalid or unauthorized actions are logged and the model
can respond to their tool feedback. It cannot grant user approval.

HTTP requests have a configured socket timeout, response-size bound and no
redirect or retry. Socket timeout is not an absolute run wall-clock deadline.
Remote endpoints require HTTPS; explicit loopback HTTP supports local serving.
An API key is read only from the explicitly named environment variable. The CLI
does not load the website's `.env.local` automatically. Request artifacts omit
headers, and response bodies redact an echoed active credential. A body cut by
the response-size limit is identified as such and never executed.

The API wire contract follows [OpenAI's Chat Completions reference](https://developers.openai.com/api/reference/resources/chat)
and [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling).
`max_completion_tokens` and the legacy compatible `max_tokens` are explicit,
exclusive configuration choices. Optional provider thinking/temperature settings
and the parallel-call flag are recorded rather than silently patched on failure.

## Budgets and cost interpretation

Budgets are shared across the whole ordered run, including failed requests and
all episodes. Before each request, the runner checks request byte size, remaining
request count, reserved output tokens and the monetary reservation limit.
Reservations are not refunded when actual usage is lower.

Input token reservation is UTF-8 serialized request bytes plus 4096 for framing;
output reservation is the configured output limit. This deliberately conservative
estimate is **not a universal tokenizer bound or provider billing guarantee**.
Rates are explicit USD per million tokens with provenance and date. No provider
price is guessed at runtime. Provider-level spend controls are separate.

Reports keep the reservation, observed usage, rate-based estimated cost and
unknown usage separate. Cache/time-of-day discounts are not inferred. Missing or
invalid usage, transport failures, malformed envelopes and provider overruns halt
future requests. Remaining scenarios stay in the denominator as failed/unattempted.
An uncertain request is never recorded as free. `estimated_cost_usd` is null when
any request has unknown usage; `known_usage_cost_usd` remains a partial estimate.

Cost per success includes all accounted requests, including failed episodes.
P50/P95 use nearest-rank request latency. These are not whole-task latency or
provider billing reconciliation. Raw response usage details, returned model IDs
and provider fingerprints remain available for later analysis. A configured alias
is explicitly unpinned when no immutable model revision is available.

## Run offline from the repository root

```sh
python research/liftcut-agent/model.py mock --output-dir research/liftcut-agent/outputs/model-smoke
python research/liftcut-agent/model.py replay --config research/liftcut-agent/outputs/model-smoke/config.json --episodes research/liftcut-agent/outputs/model-smoke/episodes.jsonl
```

Use a new output directory each time. The runner produces:

| Artifact | Contents |
| --- | --- |
| `config.json` | Exact model, protocol options, limits and rate configuration |
| `manifest.json` | Start time, code commit/dirty state, endpoint, selected IDs and input file hashes |
| `calls.jsonl` | Flushed after every request: full payload, credential-redacted response, usage, latency, parsed action/failure and reservation |
| `episodes.jsonl` | Flushed after every episode: calls, policy failure and original environment trace |
| `report.json` | Every scenario, category failures, accounting and paired fixed-workflow outcomes |

Interrupted runs can leave call records and completed episodes without a final
report. They must not be treated as completed experiments. Replaying requires the
full ordered run because its budget spans scenarios. An incomplete file reports
zero verified episodes with the original scenario denominator.

Replay regenerates API messages from observations, checks saved requests, parses
the saved raw responses again, re-executes tools and recreates fixture user events.
It also compares recorded accounting and final state. It cannot prove that a
response came from a provider, or independently verify latency/billing. A failed
episode may replay consistently; `task_passed` and `replayed` remain separate.

Exit codes: `0` all tasks pass (or all replays are consistent), `1` task failures
or incomplete replay, `2` invalid inputs/configuration or inconsistent artifacts.

## Prepared hosted-model pilot

The checked-in [pilot configuration](../../research/liftcut-agent/configs/deepseek-flash-pilot.json)
selects `deepseek-flash`, non-thinking mode and temperature 0. The official
[pricing/version page](https://api-docs.deepseek.com/quick_start/pricing/) identified
that alias as DeepSeek-V4.1-Flash on 2026-09-28, with the old `deepseek-v4-flash`
alias routed to the same model. This is a hosted capability reference, not the
trainable small-model baseline for a future same-base SFT comparison.

The profile uses `max_tokens` and disables thinking because the provider documents
that required tool choice is unsupported in thinking mode. The undocumented
parallel-call request flag is omitted; the parser still rejects multiple calls.
See [DeepSeek's API reference](https://api-docs.deepseek.com/api/create-chat-completion/).

Preflight is local and performs no network requests:

```sh
python research/liftcut-agent/model.py preflight --config research/liftcut-agent/configs/deepseek-flash-pilot.json --base-url https://api.deepseek.com/v1 --scenario interactive-008
```

This selects only the response-loss-after-write scenario. Limits are 24 requests,
1024 output tokens per request, 24,576 reserved output tokens and a $0.30 monetary
reservation guard. At the checked rates ($0.30 input / $1.20 output per million,
peak cache-miss pricing), the configured worst-size reservation totals $0.2749824.
Recheck prices before use; the guard is an estimate, not a billing cap.

After the spending scope is authorized and `LIFTCUT_AGENT_API_KEY` is set locally:

```sh
python research/liftcut-agent/model.py live --allow-live --config research/liftcut-agent/configs/deepseek-flash-pilot.json --base-url https://api.deepseek.com/v1 --scenario interactive-008 --output-dir research/liftcut-agent/outputs/deepseek-pilot
```

`--api-key-env` can explicitly select another existing environment variable. Keep
credentials out of config files and commands. The generic example contains
placeholders and is intentionally rejected by live mode until reviewed.

## Evidence and next step

96 tests cover the existing environment plus parser failures, preserved user
events, shared budgets, unknown-cost accounting, local HTTP behavior, credential
redaction, request/trace tampering and CLI operation. The offline smoke completes
14/14 scenarios through 97 synthetic replies; all replay. CI repeats this without
credentials. This is adapter validation, not a live model result.

The [progress log](../AGENT_RESEARCH_PROGRESS.md) records whether a live pilot has
actually run. First inspect its failures, model identity, usage and replay. Broader
rollouts require an explicit budget and should be paired with the same fixed
workflow. Then select an accessible trainable small model, expand independently
reviewed scenario families and freeze grouped evaluation before trajectory SFT.
