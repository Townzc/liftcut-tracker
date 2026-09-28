# Protocol comparison: frozen pre-run plan

Run four fresh, single-pass arms on all 14 public interactive development cases.
This is development diagnosis after inspecting earlier failures, not held-out
evaluation. Do not tune or rerun an arm after observing its score.

| Arm / config suffix | Tool protocol | Prompt |
| --- | --- | --- |
| `single-original` | Exactly one call | Original v0.1 |
| `batch-original` | Up to four read-only calls; mutating/terminal calls alone | Original v0.1 |
| `single-clarified` | Exactly one call | Original + pending-approval outcome instruction |
| `batch-clarified` | Up to four read-only calls; mutating/terminal calls alone | Original + pending-approval outcome instruction |

Execute in the listed order, using configurations in
`research/liftcut-agent/configs/protocol-comparison/`. Hold model alias,
non-thinking mode, temperature 0, scenario order, tools, scoring, 24 environment
steps, max output tokens and provider options constant. The original prompt's
single-call preference remains in every arm: the batching factor changes parser
acceptance, not that instruction. The clarified prompt adds only the explicit
mapping from apply intent with no approval to `awaiting_user`.

Each batch retains raw calls and IDs, validates all members before execution,
and executes in returned order. Each tool uses one environment step; one response
can therefore cost fewer API requests without granting more tool steps. Batches
are limited to `get_context`, `get_memories`, `search_exercises`, `validate_plan`.
Reject mixed mutation/clarification/termination batches, duplicate IDs, malformed
arguments, oversized batches or batches exceeding remaining steps. Do not repair
arguments, select only the first call, or manufacture user approval.

Every tool response is matched to its call ID before the next model request.
User events remain external and follow the full tool-response block. Preserve
all failures and compare final states, protocol failures, tool errors, requests,
executed tool steps, writes, usage, latency and cost. Replay all records offline.
Report paired outcomes for each factor at each setting of the other factor.
One run per cell does not establish repeated reliability or causal statistical
significance; sequential execution may confound time/provider variation.

## Budget and stop rules

Each arm reserves at most **$0.60**, at most 336 requests and at most 344,064 output
tokens, with the existing 30,000-byte request and 1 MB response limits. The four
arm guards sum to **$2.40**. Actual usage-based estimates are reported separately;
reservations are not bills or provider hard caps. Use conservative peak/cache-miss
rates ($0.30/M input, $1.20/M output), rechecked at the
[official pricing page](https://api-docs.deepseek.com/quick_start/pricing/) on
2026-09-28. Historical experiments stay separate and are added only to the spending
ledger, never pooled as independent accuracy observations.

If a request has unknown usage, halt that arm and do not start later arms. A
known-usage protocol/task failure remains a result and does not trigger an API
retry. Save each arm to a new output directory. Never overwrite partial evidence
or rerun silently. This experiment requires no GPU or rented server.

## Before execution and after interpretation

Commit this plan, all four configs and tested implementation before live calls.
Verify both legacy saved runs still replay and bounded batches cannot bypass
confirmation or step budgets. Record a clean source commit in every run.

After the comparison, export only replay-verified successful development decisions
as a **pipeline smoke sample**, with scenario/family lineage and assistant-only
target annotations. Keep failed decisions out of positive demonstrations while
retaining their original raw evidence. This sample is not an independently
reviewed training set, a frozen test set or evidence of SFT. Actual tokenizer loss
masks and held-out grouping still require validation before any training job.
