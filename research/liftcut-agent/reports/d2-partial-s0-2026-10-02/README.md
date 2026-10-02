# Historical D2 partial window: completed S0 only

S0 completed 80 cases and 84 actual model generations. T/M/TM did not start after
the controller's per-arm archive registration raised a duplicate `path` argument
error. All 240 unrun cases remain missing, not observed model failures.

| Panel | Correct | Defer | Denominator/unit |
| --- | ---: | ---: | --- |
| Memory | 26 | 0 | 48 first responses |
| Identity | 7 | 0 | 12 first responses |
| Consent | 6 | 4 | 12 first responses |
| Repair | 1 | 0 | 4 continuations |
| Infeasible | 3 | 0 | 4 continuations |

Do not pool these units or claim four-arm treatment effects. G1 was not evaluated
because its prespecified T arm is absent. The 48 reserved tasks remain unused.

- `run/`: unchanged restored raw inventory, S0 trace/generation/token files,
  forecasts, original opening/status, and the real S0 archive created before the
  index-registration failure. No model weights or credentials are included.
- `backup-index.json`, `partial-receipt.json`: unchanged actual partial backup
  index and genuine restorer receipt. The receipt claims integrity only and is
  never upgraded to complete-study proof.
- `review.json`: subsequent independent S0 native/environment/token replay and
  actual local original-weight recheck, plus exact behavior/factor analysis.
- `operations.jsonl`, `operations-summary.json`: actual transfer events and
  explicit limits of shutdown/billing observations. Compute proxy CNY0.2620
  excludes storage and is not an inspected provider bill.
- `figures/`: rendered from that reviewed S0 report, not model predictions.

Reproduce using `analyze_d2_partial.py --public-dir THIS_DIRECTORY --prepared-dir
PREPARED --tokenizer-dir TOKENIZER --metadata-only --check`. CI can replay public
traces/tokens and verify archive inventory; it cannot recheck private weights.
The historical v1 contract is retained and the amended v2 contract must have
identical scientific parameters. No new inference occurs in this review.

[Full analysis, incident repair and next window](../../../../docs/research/2026-10-02-d2-partial-results-and-repair.md)
