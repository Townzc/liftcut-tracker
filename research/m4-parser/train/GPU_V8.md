# M4 v8: training × inference contract comparison

V7 remains rejected. [V8 data](DATA_V8.md) tests whether explicit schema/policy
instructions help during training, inference, or both. The two factors use a
fixed enum system and one fixed contract system.

| Arm | Training system / weights | Inference system | Work |
| --- | --- | --- | --- |
| A | Archived v7 enum-trained HF | Enum | 1,040 cached predictions |
| B | Same archived v7 HF weights | Contract | 1,040 fresh HF predictions |
| C | New original-base contract-trained HF | Enum | 1,040 fresh HF predictions |
| D | Same new contract-trained weights | Contract | 1,040 fresh HF; sole candidate |

A→B and C→D isolate inference text within fixed weights. A→C and B→D compare
training text under the same inference text. Report their interaction as well;
do not substitute v7 Q8's 180 for cached HF A's 185. One seed and a cached A do
not establish statistical significance or controlled latency.

[Protocol](protocol-v8.json) and [runner](../run_v8.py) fix one training from pinned
Qwen3-0.6B: original token-mean loss, seed 20261019, two epochs/800 steps, batch 16,
rank 16, lr 0.0002, max length 512, activation checkpointing. All 6,400 tuples stay
fixed. Train once; generate B, C, D in that order. A/B/C never replace D. No retries,
extra seed, epochs, examples, labels, grammar or threshold relaxation.

## Two-stage evaluation

First score four HF arms against identical 740 dev, 240 challenge and 60 old
handwritten cases. Preserve original raw/resolved scores; separately report strict
reasons, useful positives and wrong available exercise identities. There are
**3,120 fresh HF predictions**. D must pass every unchanged semantic gate and the
new explicit training/input checks before any conversion or GGUF inference:

- Challenge exact ≥90%, schema ≥99%, raw unsupported fields 0.
- Guarded unsafe 0 and original source-v1 challenge coverage ≥90%.
- Each focus family: ≥14/15 correct negative reasons and ≥14/15 useful positives;
  overall useful-positive challenge exact ≥108/120.
- Legal clarification labels across all 1,040 outputs; no candidate truncation.
- Exact training parameters, reviewed train/dev token masks, payload bytes/token
  hashes, and all four factorial input audits.

HF failure finishes as `semantic-rejected`, `rawAgreement=null` and
`quantization=not-run-semantic-rejection`. This is a completed rejected experiment,
not an unmeasured quantization pass or an invitation to retry.

Only a passing D is exported to F16/Q8 and produces **2,080 additional predictions**.
Q8 must pass the same semantic gates and agree ≥95% with both HF and F16, with no
missing items or candidate-format truncations. Outcomes are `quantization-rejected`
or `development-passed-not-release`. Maximum fresh predictions: **5,200**; cached
A: **1,040**. Greedy decoding, 256 output tokens, four GGUF threads and KV reset
remain fixed. HF uses GPU, GGUF server CPU; none is a phone latency measurement.

`releaseReady` stays false even after a development pass. The actual candidate
then needs continuous-dialogue acceptance, useful incremental coverage, native
integration and physical-device acceptance. Private originals/derivatives stay
out of training; existing UI, write safeguards and confirmation flows stay intact.

## Provenance and bounded operation

The runner checks 61 source hashes (all 53 old hashes unchanged), regenerated data,
14 archived-control files, pinned base/converter/runtime and full token receipts
before loading weights. Original-base train/dev tokens must reproduce CPU audits.
Gold, reasons and reference labels never enter inference payloads.

Complete CPU tests, every exact-head CI and full/incremental source restoration
before notifying the maintainer to open a new server window. Record a fresh window
ID, reviewed commit, opening time, original three-hour work deadline and four-hour
power deadline; verify the platform shutdown backstop. Do not reuse v7's opening.

After source setup require ≥22 GiB GPU memory and **6 GiB live output-filesystem
space**. [Recovery](RECOVERY_V8.md) requires staging full weights off-instance before
packing, avoiding a duplicate full-weight archive. Measured four-weight size
3,070,186,192 bytes + 3 GiB converter/transfer/log/temp reserve fits within 6 GiB.
Verified old transfer-cache copies may be removed using the private exact-file
allowlist; primary models, datasets, predictions and logs are retained. If live
capacity still fails, stop; no paid expansion or deletion of retained experiments.

```sh
python research/m4-parser/run_v8.py --cache "$CACHE" --baseline "$VERIFIED_V7_RUN" \
  --out "$FRESH_OUTPUT" --commit "$REVIEWED_COMMIT" --stop-at "$ORIGINAL_WORK_DEADLINE"
```

GNU timeout bounds children. Exit 3 means quality rejection. Preserve partial
outputs after interruption. Finish early after verified off-instance restoration;
obey the original power deadline even if transfer fails, retaining remote assets.
Confirm platform OFF before clearing the completed backstop. No helper powers on
or activates a model automatically.
