# Overnight closing observations — 2026-10-03

These are actual captured observations, not a generated shutdown acknowledgement.
The original 14:00 UTC guard was verified at server time13:50:44.383397. The existing
SSH channel closed at local time13:59:59.254246 with exit status-1 and inactive transport.
The local observer exited0 after saving that event. A single later TCP probe timed out.

**Shutdown request and command return were not captured. Provider power and billing
status remain unknown pending the single requested user confirmation.** The last
captured server event snapshot predates shutdown; absence there does not prove that
the guardian failed. Different hosts' clocks must not be used for subsecond ordering.

- `local-events.jsonl`: exact local capture of connection, dispatch and channel end.
- `server-stream.jsonl`: exact remote stdout, including guard identity and file bytes.
- `remote-observer.py`: exact dispatched read-only source; hash matches the dispatch event.
- `stderr.log`: exact empty remote stderr capture.
- `connectivity-observation.json`: one unauthenticated TCP reachability check after disconnect.
- `last-captured-events.jsonl`: bytes extracted from the embedded snapshot and checked against its SHA.
- `summary.json`: derived observations, explicit unknowns, cost proxy and six file hashes.

The observer did not alter the lease, request shutdown, restart training or create any ACK.
No reconnection or reboot was performed to obtain missing logs. At ¥2.18/hour, original
boot-to-disconnect plus the earlier failed opening gives **¥18.7106**. This is a duration
proxy, not an invoice. G4/I1 window costs overlap it and must not be added again.

See the [Chinese closing report](../../../../docs/research/2026-10-03-overnight-closure.md)
and [morning capability report](../../../../docs/research/2026-10-03-morning-agent-report.md).
