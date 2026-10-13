# Overnight closing observations — 2026-10-13

The original guard1552 was actually verified at server time14:53:13.390252 with the
unchanged15:00UTC deadline. The single observer's SSH channel ended at local time
14:59:59.230673 with status-1 and inactive transport. Its local exit0 means logging
ended normally. One subsequent unauthenticated TCP connection was refused.

**Shutdown request and command return were not captured. Provider power and billing
status remain unknown pending one requested user confirmation.** The captured event
file contains only the earlier armed event; it is a pre-shutdown snapshot, not a
complete final server log. Different host clocks do not establish subsecond ordering.

- `local-events.jsonl`: exact captured local connection, dispatch and end events.
- `server-stream.jsonl`: exact captured remote stdout, including guard identity and snapshot text.
- `stderr.log`: exact empty captured remote stderr.
- `remote-observer.py`: exact saved read-only source dispatched over the existing SSH channel.
- `local-observer.py`: exact executed local observer source; no embedded credential.
- `connectivity-observation.json`: one later TCP reachability check, no login or retry.
- `last-captured-events.jsonl`: UTF-8 text extracted from the stream snapshot, without an independent final remote-file hash.
- `summary.json`: derived facts, explicit unknowns, duration proxy and seven evidence-file hashes.

The observer did not modify the lease, send a new shutdown request, create an ACK or
restart an experiment. No reboot was performed to recover missing logs. At ¥2.18/hour,
this continuous04:27 opening through observed disconnect has a **¥22.998534** duration
proxy (planned through15:00: ¥22.999; reserve¥25). This is not an invoice. Trial windows
overlap this total and must not be added again; previous setup openings are separate.

See the [closing report](../../../../docs/research/2026-10-13-overnight-closure.md),
[morning report](../../../../docs/research/2026-10-13-morning-agent-report.md) and
[original guard evidence](../i2-overnight-preflight-2026-10-13/lease.json).
