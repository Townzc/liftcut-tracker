# Fixed-state development diagnostics

Existing recovery-v2 adapters; 19 authored development states per arm, one greedy run each.
These are first-decision diagnostics, not full-task success or held-out evaluation.

| Arm | Consent decision | Memory decision | Real model generations |
| --- | ---: | ---: | ---: |
| clean | 5/10 | 2/9 | 22 |
| mixed | 6/10 | 1/9 | 22 |

Every accepted tool batch is fully executed. Only its first substantive decision is scored.
Scripted prefixes have zero model usage; live prompts include the prefix tokens.
All failed decisions, parse failures and absent decisions remain in the denominator.

- `comparison.json`: recorded server replay and native-generation audit, reproduced on CPU.
- `review.json`: exact first actions, same-state consent contrasts, value matches and usage.
- `adapter-verification.json`: actual saved v2 adapter files checked before publication; weights omitted.
- `backup-source.json` and `off-instance-verification.json`: archive SHA and complete restore/replay receipt.
- `operations.json`: observed timing/cost proxy and limits of shutdown/billing observation.
- `publication-manifest.json`: exact public file inventory and hashes.

Value matches are not proof of internal causal attribution. These related probes provide no independent generalization estimate.
[Research journal](../../../../docs/research/EXPERIMENT_LOG.md)
[Diagnostic design](../../../../docs/research/2026-09-29-state-diagnostic-plan.md)
