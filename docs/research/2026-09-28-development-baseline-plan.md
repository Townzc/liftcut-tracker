# Hosted development baseline: pre-run plan

This plan is committed before executing the full hosted reference run. It does
not freeze an unseen test set. All 14 scenarios are public development fixtures.

## Question and protocol

Does the already integrated hosted reference complete the existing interactive
development suite, and which failures occur beyond the single-case pilot?

- Run every row of `benchmark/interactive-dev.jsonl` once, in its existing order.
- Use `deepseek-flash`, non-thinking mode, temperature 0 and the existing versioned
  prompt/tool interface; do not tune prompts or scoring during this run.
- Give each task its unchanged 24-step environment limit. Require one native
  function call per request. Keep existing strict parsing and no API retries.
- Compare paired task outcomes with the deterministic fixed workflow. Report
  task success, clean completion, category failures, blocked actions, request
  counts, token usage, latency and estimated cost, retaining all selected tasks.
- Replay all saved responses and environment transitions offline. Preserve any
  failed trajectories, rather than rerunning until a passing result appears.

## Resource envelope

Use the [baseline profile](../../research/liftcut-agent/configs/deepseek-flash-dev-baseline.json).
The aggregate request ceiling is 336; each request reserves up to 1024 output
tokens. The shared $0.75 reservation guard can stop the run earlier. Request bytes
and response sizes stay bounded. An unaccounted request halts subsequent calls.

Rates were rechecked against the [official pricing page](https://api-docs.deepseek.com/quick_start/pricing/)
on 2026-09-28: $0.30 per million input tokens and $1.20 per million output tokens,
using peak/cache-miss rates conservatively. The byte-based monetary reservation
is not a provider billing guarantee. The estimate is not a reconciled bill.
No GPU/server rental is required or authorized by this run plan.

```sh
python research/liftcut-agent/model.py preflight --config research/liftcut-agent/configs/deepseek-flash-dev-baseline.json --base-url https://api.deepseek.com/v1
```

## Interpretation decided before results

One run on 14 authored development cases cannot estimate generalization or
training gains. The hosted alias does not pin immutable weights. Temperature 0
does not establish repeatability. Report the earlier one-case pilot separately;
do not pool it with this run as 15 independent tasks.

If performance saturates, expand independently reviewed task families and remove
incidental hints before training. If it fails, inspect the first failing action,
its observed context and the terminal scorer before proposing a repair. Keep
protocol changes and later measurements in a separate versioned experiment.

Select a trainable small-model baseline before making a Base/SFT comparison.
Renting compute requires a concrete model/configuration, dataset readiness,
compatibility pilot, cost envelope and shutdown plan presented to the maintainer.
