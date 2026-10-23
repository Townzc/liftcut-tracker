# V8 artifact and source recovery

[backup_v8.py](backup_v8.py) requires a fresh v8 window ID, exact reviewed commit
and original work deadline. Old helpers and their historical contracts stay fixed.

| Completed state | Required full weights | Complete 1,040-row streams | Quantization evidence |
| --- | --- | --- | --- |
| semantic-rejected | D adapter + merged HF | A/B/C/D | Explicitly unmeasured, agreement null; GGUF artifacts forbidden |
| quantization-rejected / development-passed-not-release | D adapter + HF + F16 + Q8 | A/B/C/D/D-F16/D-Q8 | Both measured agreement reports and consistent HF/final decisions |
| stopped | Every available partial artifact | Partial bytes preserved, never reported complete | No inferred pass |

All completed full weights must be staged off-instance and hash-verified before
packing. The archive contains source, manifests, provenance, metadata, logs and
predictions; external mappings point to verified complete weight files. Lossless
transport encodings are optional transfer caches, never the only recovery copy.
Restore writes independent full weight files, verifies all part/archive/manifest
and file hashes, checks state consistency and stream counts, then emits a receipt.
Do not acknowledge backup success based only on archive existence or transfer exit.

The 6 GiB server free-space check budgets the measured 3,070,186,192-byte complete
weight set plus 3 GiB for converter, staging and temporary/log overhead, without a
second full-weight archive. Private cleanup preparation identifies only 12 old
v6/v7 `.xor.gz` transport copies (3,034,866,845 bytes), each matched to local payload
and independently restored primary-weight evidence. Cleanup is read-only by
default, verifies all paths/hashes before removing any exact eligible file, and
requires a fresh confirmed opening for apply. No remote cleanup ran during CPU
preparation. No directories, current-window assets or primary files qualify.

Actual CPU rehearsals restored both completed shapes using real archived v7
weights and streams. Synthetic status metadata exercises the two branches; it is
not a v8 prediction, quality result or release pass. All two/four restored full
weights match hashes and are independent copies. [Receipt](../results/contract-v8-20261023/artifact-restore.json).
Fault tests also cover missing weights/streams, corruption, wrong windows,
traversal, archive symlinks, false quantization claims and interrupted JSONL bytes.

Final reviewed source needs separate full and incremental Git bundle restoration,
tree equality, 61 source hashes, own-workspace binding, builder and token audits
and relevant tests. Artifact rehearsal's earlier source bundle cannot replace that
final proof. Preserve the tested head and the equivalent production squash.

During the new window, stop work by opening+3h, reserve the fourth hour for backup
and shutdown, and shut down early after full verification. Retain remote assets
if any backup fails and still honor the original power deadline. Confirm platform
OFF before removing the completed timer. No old authorization/deadline is extended.
