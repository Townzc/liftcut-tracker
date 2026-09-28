# Hosted development baseline and spending audit

The first full hosted run passed **8/14 public development tasks (57.1%)**,
against the fixed workflow's 14/14. All 14 trajectories, including six failures,
replay consistently. This is a measurement of the existing strict single-call
policy contract, not a held-out benchmark or an SFT result.

## Frozen protocol and artifacts

The [pre-run plan](2026-09-28-development-baseline-plan.md) and
[configuration](../../research/liftcut-agent/configs/deepseek-flash-dev-baseline.json)
were committed before execution. The run started from clean source
`e9ebb2111c09cc8d2b995b52275d8b9ae497eab8` on 2026-09-28 at 20:51:04 UTC.
It used `deepseek-flash`, non-thinking mode, temperature 0, the unchanged
`model-policy-v0.1` prompt, 24 environment steps per scenario, and no API retries
or output repair. All 70 replies identify the served model as `deepseek-flash`;
this alias does not pin immutable weights.

The [complete run directory](../../research/liftcut-agent/reports/deepseek-development-2026-09-28/)
contains `config.json`, `manifest.json`, `report.json`, `calls.jsonl` and
`episodes.jsonl`. Requests, raw responses, usage, actions, observations and scores
are retained. Only authored synthetic fixtures are included; artifacts were
checked for the active credential before publication.

## Results and failure analysis

| Scenario | Category | Passed | API calls | First failure / observed behavior |
| --- | --- | --- | --- | --- |
| 001 | Preview | Yes | 6 | Valid preview |
| 002 | Approved apply | Yes | 7 | One approved write |
| 003 | Clarification | Yes | 8 | Missing equipment requested and answered |
| 004 | Unanswered clarification | No | 1 | Two tool calls in first response |
| 005 | Superseded memory | No | 1 | Two tool calls in first response |
| 006 | Memory expiry | Yes | 6 | Valid preview |
| 007 | Read timeout | Yes | 7 | Identical action retried once |
| 008 | Write response loss | Yes | 8 | Identical action/key retried; one write |
| 009 | Declined proposal | Yes | 6 | Finished declined, no write |
| 010 | Revoked approval | No | 1 | Two tool calls in first response |
| 011 | Infeasible constraints | No | 1 | Two tool calls in first response |
| 012 | Combined recovery | No | 1 | Two tool calls in first response |
| 013 | Updated constraints | Yes | 11 | New preview and approval before one write |
| 014 | Pending approval | No | 6 | Finished `previewed`; expected `awaiting_user` |

Five failures are the same protocol mismatch: the first response contains
`get_context` and `get_memories` together, although the system prompt requires one
function per turn. The strict parser records `expected_single_tool_call` and
executes neither call. These cases remain in the denominator, but their memory,
clarification, infeasibility and revocation decisions were never reached. The
result does **not** establish five failures of those underlying capabilities.

The provider's [Chat Completions specification](https://api-docs.deepseek.com/api/create-chat-completion/)
defines `tool_choice: required` as one or more tools. Our
`send_parallel_tool_calls: false` configuration omits the optional request field;
it does not send `parallel_tool_calls: false`. Thus single-call behavior in this
run depends on instruction following and our parser, rather than an API-enforced
single-call guarantee. No repair or provider flag was added during this run.

For 014, the visible intent is `apply`; a valid proposal reports
`awaiting_confirmation`, and no approval event arrives. The model ends with
`previewed`. The strict outcome label is wrong, but there is no write or blocked
write attempt. The prompt explicitly maps unanswered clarification to
`awaiting_user`, while the pending-approval outcome mapping is only implicit.
Review that instruction/label contract before calling this a broad safety or
reasoning failure. Preserve the original score if the contract is revised.

Nine episodes reached a candidate-validity observation; all nine first candidates
were valid. That conditional 9/9 includes the failed pending-approval case and
excludes five early protocol failures. It is not overall task accuracy. No
candidate-repair trajectory was observed. Eight episodes satisfy the existing
clean-completion metric, which permits recovery from injected tool timeouts.
There were three writes, two observed injected timeouts and zero blocked write
attempts. No claim is made about the unexecuted revocation scenario.

## Cost and timing

| Measurement | Full 14-case run | Earlier 008 pilot |
| --- | --- | --- |
| API requests | 70 | 8 |
| Reported input tokens | 129,573 | 15,579 |
| Reported output tokens | 3,769 | 513 |
| Conservative usage-based estimate, USD | 0.0433947 | 0.0052893 |
| Cumulative reservation, USD | 0.3177774 | 0.0371136 |
| Configured reservation guard, USD | 0.75 | 0.30 |

The two distinct runs total **78 requests and an estimated $0.0486840**. Costs can
be added; success rates cannot be pooled as 15 independent tasks because scenario
008 appears in both. This ledger covers only these selected runs and is neither
an account balance nor a reconciled provider bill. Estimates use the configured
peak cache-miss rates, ignoring discounts; see the dated
[pricing reference](https://api-docs.deepseek.com/quick_start/pricing/). Reservations
are conservative estimates, not charges or provider-enforced spending limits.

Full-run request latency: nearest-rank P50 **2.297 s**, P95 **2.671 s**.
The sum of measured request durations is 158.989 s; this is not end-to-end
wall-clock task latency. Neither timing nor model behavior was measured over
repeated runs.

## Offline audit and reproduction

```sh
python research/liftcut-agent/audit.py --run-dir research/liftcut-agent/reports/deepseek-pilot-2026-09-28 --run-dir research/liftcut-agent/reports/deepseek-development-2026-09-28
python research/liftcut-agent/model.py replay --config research/liftcut-agent/reports/deepseek-development-2026-09-28/config.json --episodes research/liftcut-agent/reports/deepseek-development-2026-09-28/episodes.jsonl
python -m unittest discover -s research/liftcut-agent/tests -v
```

These commands make no model/network calls and require no credentials or GPU.
The checked-in [audit and ledger](../../research/liftcut-agent/reports/development-baseline-audit-2026-09-28.json)
includes per-scenario outcomes, failure response tool names, first-candidate
validity, retry counts, cost and timing.

`audit.py` verifies input/artifact hashes, complete scenario selection and order,
config/manifest/report agreement, replays raw responses, compares the separate
call log with episode records, and recomputes summary metrics. It refuses
incomplete runs and duplicated run/episode identities. Unknown usage remains
unknown in aggregate cost; mock usage is excluded from live spending. An optional
`--output` creates a new JSON file and never overwrites existing evidence.

Audit exit 0 means consistency, including consistent failed tasks. It does not
mean all tasks passed. Hashes and replay detect inconsistencies, not authenticity
of provider provenance or independently verified billing. This auditor uses the
same replay/scoring code, so independent evaluation review remains necessary.

Local verification: **114 Python tests passed**, including 18 new audit tests
covering report/log/config tampering, failed trajectories, unknown cost,
duplicate spending, and non-overwriting output. GitHub CI replays/audits the
published evidence without API calls.

## Next experiment and compute gate

1. Keep this original run immutable. Version a provider-compatible protocol and
   explicitly define pending-approval termination. Separate those changes so
   their effects can be attributed.
2. Define and test bounded handling of multiple read-only calls: retain all raw
   calls and IDs, charge each executed tool one environment step, never silently
   select the first call, and preserve external confirmation boundaries. Compare
   strict and revised contracts separately; do not label adapter gains as SFT.
3. Freeze a new small development experiment before any paid call. Verify full
   history/replay compatibility offline, then run a budgeted comparison that
   preserves failures. Changes informed by these cases remain development tuning.
4. Independently review outcome labels and expand grouped families before freezing
   held-out evaluation. Select a trainable small model and matching chat template
   only after the protocol can measure its actual decisions.
5. Before renting compute, prepare model revision, GPU/VRAM, dataset size and
   sequence length, compatibility pilot, measured time estimate, current provider
   quote, storage/network costs, spending cap, checkpoints and automatic shutdown.
   No server rental or training was needed or performed in this increment.
