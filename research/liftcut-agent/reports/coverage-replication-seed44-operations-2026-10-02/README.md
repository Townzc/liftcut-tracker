# Seed44 closure and cost observations

The frozen four-arm window completed. The authentic restorer verified five archives,
100 inventory entries, actual adapter weights, 124 native/environment episodes and
358 recorded generations before the local collector published its genuine receipt.
See [observations](observations.json), [events](events.jsonl) and the
[core publication](../qwen-coverage-replication-seed44-2026-10-02/README.md).

At 03:06:32 UTC the temporary receipt was uploaded and read back with the expected
hash. At 03:06:33 the server confirmed the atomic rename. SSH then disconnected;
the collector exited with SSHException. The supplemental read-only observer returned
exit -1 with empty stdout/stderr. Neither service-side ACK consumption nor the
shutdown command's return was captured. Do not turn those unknowns into ACK records.

One subsequent network-permitted TCP check received socket error 10061. That is
connection evidence, not provider billing evidence. The user subsequently checked
AutoDL and [confirmed the instance was off and this run cost CNY4.60](user-platform-confirmation.json).
This is direct user confirmation; no provider API or invoice was inspected, and no
exact power-off/billing-stop timestamp or storage breakdown was supplied.

The boot-proxy-to-disconnection estimate is CNY4.6201 at the previously supplied
CNY2.18/hour, distinct from the reported CNY4.60 actual run cost. The reserve was
CNY8; original work/hard deadlines were retained. No reboot, extra paid API, seed45,
D2/G1 execution or reserved-task evaluation occurred.

Events retain the parsed local records; publication only normalizes CRLF to LF
(the actual source already used LF). Hashes in observations bind the published
events, user report and frozen window status. Remote run paths are historical
provenance; SSH endpoint, credential, private weights and local config are excluded.
