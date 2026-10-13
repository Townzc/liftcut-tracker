# Actual I2 no-GPU preparation evidence

Run `20261013-014645`, fixed execution `32fbbac18d48493a8f37221a3e4b090e3b431cf2`.
All 53 captured/generated evidence files listed in `sha256.json` retain their original
bytes. No credentials or model-weight bytes are published.

- `operations/`: actual command outputs/events, verified preparation record, shutdown
  observations, one unauthenticated TCP probe, user power confirmation and summary.
- `continuation-inspection/`: read-only proof of the original guard and known failed
  preparation state before explicitly continuing within the same CPU deadline.
- `continuation-decision/`: preserved failed local reservation, decision, local-only
  PowerShell date-coercion failure and actual subsequent invocation binding.
- `stage.json`, `offline-installation.json`: the exact staged commit and independent
  installation rehearsal, both using the actual unchanged historical checkpoint.
- `pr47-*`: final exact-head checks and merge evidence, before actual installation.

The shutdown helper's original stdout contains returncode 0; SSH channel status is
-1. The collector marked its command return unobserved because of the channel status.
Preserve this distinction. Provider OFF is confirmed by the direct user reply; no
exact billing-stop timestamp or invoice is inferred from transport behavior.

These files prove CPU deployment readiness only. GPU runtime and I2 model performance
remain untested; the genuine preparation record is not an experiment backup ACK.
