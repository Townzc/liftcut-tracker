# M4 v3: one development candidate, not a release

The [runner](../run_v3.py) and [protocol](protocol-v3.json) use the unchanged
[6,400-row v3 training data](../DATA_CARD_V3.md). The 20 private utterances and
their rewrites are not added to training. Observed scenarios are regressions,
not unseen acceptance. Frozen v1/v2 results and runners remain unchanged.

## Fixed experiment

Train from the pinned original Qwen3-0.6B base, not a prior fine-tuned model:
2 epochs, batch 16, rank 16, learning rate 0.0002, seed 20261019, max length 512,
activation checkpointing. No search/retry. Greedy decoding, no G1. Compare previous
v2 Q8, new HF, new f16 and new Q8 on identical input tokens: 740 development +
240 observed challenge + 60 handwritten rows; 1,040 per arm / at most 4,160
predictions. The runtime/base/converter must already be cached; no downloads.

Original gates remain: raw Q8 agreement ≥95% with both HF and f16; challenge
exact ≥90%, schema ≥99%, invented fields 0, truncation 0, guarded unsafe 0 and
challenge correct acceptance ≥90%. The original source-v1 gate is retained.
Source-v2 and independent source-only results are separate comparisons, never
a substituted pass. Their equality-based coverage cannot prove model utility.

Even if all development checks pass, `releaseReady` remains false. Full continuous
Agent acceptance, per-hand load storage, confirmation UI and physical-device
behavior still need verification. The new pending-draft context keeps uncertain
values, symbolic load references and per-hand basis distinct; no app caller is
enabled by this preparation.

## Operation

After the exact PR commit has all required CI checks, notify the maintainer to
open the authorized AutoDL RTX 4090 (24 GB). Verify current connection details,
≥20 GiB free disk, cached runtime versions and pinned base/previous-Q8 hashes.
Do not reuse an old SSH session or treat an old OFF observation as current.

The work deadline is within **10,800 seconds (3 hours)**. Reserve another hour
within the existing four-hour operational window for off-instance backup,
byte/hash verification and shutdown. This is a limit, not a measured duration.
GNU timeout bounds each child by the remaining absolute budget. Program exit
does not shut down the platform: the operator must collect evidence, verify
backups, shut down even after failure, and verify platform OFF. Never extend the
deadline for a score or silently start another candidate.

From a clean checkout of the reviewed commit, with verified paths and an absolute
UTC epoch `STOP_AT` chosen before the backup/shutdown reserve:

```bash
python research/m4-parser/run_v3.py \
  --cache "$CACHE" --previous-gguf "$PREVIOUS_Q8" \
  --out "$NEW_RUN_DIRECTORY" --commit "$VERIFIED_COMMIT" --stop-at "$STOP_AT"
```

`CACHE` contains `base/`, `venv/bin/python` and `src/llama_cpp_python-0.3.36.tar.gz`.
Previous Q8 must match the protocol hash. The new output directory must be outside
checkout/cache and must not exist. Exit 3 means a missed gate: stop and retain
evidence. Exit 0 is only a development result. No weights/private data enter Git.

## Actual preparation

Real generated files assemble into 1,040 unique eval IDs; every byte/count matches
the manifests. The 20 originals are absent from the unchanged training file.
Canonical manifest hashes work across CRLF/LF checkouts. Real-token auditing and
two-step CPU SFT/export are already recorded in DATA_CARD_V3; no new training is
claimed here. Four new runner checks pass on Linux; Windows passes three and
explicitly skips the GNU-timeout entry. Full orchestration is mocked, not a GPU
rehearsal. Existing Budget timeout tests still run. GPU quality/time are unmeasured.
