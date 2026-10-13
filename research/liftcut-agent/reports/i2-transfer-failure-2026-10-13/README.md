# I2 pre-upload failure, 2026-10-13

These are real operational evidence, not model results. `events.jsonl` records the
sole failed launch, and `inspection/` contains a read-only SSH probe and its raw
response. `previous-execution.json` preserves the failed execution's116-source
freeze. `original-local-reservation.json` and `controlled-continuation.json` retain
the original reservation and the evidence-based continuation decision.

`regression-old-writer.txt` is deliberately a failing synthetic regression when
the original callback is substituted; it is not a failed cloud experiment.
`validation.json` records the fixed version's actual test results. `sha256.json`
covers the captured raw files; this README and later validation are authored
metadata. No passwords, model weights, paid API calls or held-out tasks appear.

The original04:27 UTC opening proxy and15:00 final power deadline remain fixed.
The instance stays on under the user's explicit overnight authorization.
