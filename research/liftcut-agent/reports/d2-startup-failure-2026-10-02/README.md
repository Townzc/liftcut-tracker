# D2 prelaunch failure evidence

This directory records an operational failure on 2026-10-02 UTC, not model
evaluation. No controller, training or model generation was launched. The
reserved tasks were not read.

- `startup-b.jsonl` and `startup-c.jsonl`: unchanged local startup/recovery events.
- `arm-guard.json`: unchanged remote setup response captured locally.
- `live-preflight.json`: unchanged remote hardware/package/presence probe.
- `closure.jsonl`: unchanged shutdown snapshot, request and RPC observation.
  Its original Windows CRLF bytes are retained with a scoped Git attribute, so
  the recorded hash survives Linux checkout without rewriting the evidence.
- `observations.json`: explicit operator interpretation, source hashes and cost
  calculation. The initial local ABI error was observed in process output, not
  preserved as a raw traceback; the report makes that limitation explicit.

The shutdown helper printed 0, while its SSH channel returned −1. Connection loss
is not proof that AutoDL stopped billing. Platform-off status and actual cost are
unconfirmed; the approximately CNY0.6463 compute proxy excludes storage.

The regression suite verifies the raw hashes, absence of launch/run in the
captured snapshot and the proxy calculation. It does not newly inspect the
provider or establish continuous historical GPU utilization. See the
[incident review](../../../../docs/research/2026-10-02-d2-startup-review.md).
