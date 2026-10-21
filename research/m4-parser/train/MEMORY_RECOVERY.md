# M4 v2 operational memory recovery — 2026-10-21 UTC

The maintainer opened the RTX 4090 window again. Frozen source `8520b9d`
completed all 1540 old-model/new-prompt predictions in 1138.71 seconds, then
training failed in backward with `torch.OutOfMemoryError`. It requested another
2.64 GiB with 837.75 MiB free. There is no exported adapter, merged model or
training metrics. Logs occur only every ten steps: the exact completed optimizer
step count is **unknown**, not asserted to be zero. No new candidate quality
result exists from this attempt.

The failed run is immutable. Its ten files were downloaded, safely extracted and
individually SHA-256 checked off-instance. Archive SHA-256:
`80ac2eb6b6ab9311b339cad2d35de0fbb40070463ca6e8cb742961d21fe9928b`.
Manifest SHA-256:
`a5b0f414a4f4152759bc780a0877085aa6bdffa15863b3e9ef374b7476bfc393`.
Full local evidence is in the task's `2026-10-19-m4-grounding` deliverable,
outside Git; public hashes alone are not a public full replay dataset.

## Repair and preserved conditions

The revised protocol explicitly records an operational recovery, not a successful
rerun of the unchanged original protocol. Non-reentrant activation checkpointing
recomputes activations during backward and preserves RNG state. Batch 16,
6400 training rows, 800 steps, base, seed, rank, optimizer, learning rate, Q8,
evaluation inputs and gates stay fixed. There is no quality-driven candidate
selection or additional hyperparameter search. See
[PyTorch 2.8](https://docs.pytorch.org/docs/2.8/checkpoint.html).

The trainer atomically records completed steps, marks an optimizer update in
progress separately, and records CUDA peak allocated bytes. It restores the
original KV cache configuration before export; a training memory optimization
must not silently slow subsequent generation.

Only an explicit `--baseline-run` plus independently recorded
`--baseline-sha256` can reuse the completed baseline. Recovery checks the frozen
source, prediction implementation, file hashes, complete ordered IDs, input/audit
hash, data and protocol identity, failed OOM state, and absence of an exported
candidate. It starts training from the original base in a new output directory,
not from an unknown partial optimizer state. Nothing is overwritten. Partial or
modified predictions, extended deadlines and other hyperparameter changes fail.

The original experiment stop is epoch `1792564454.4402533` (06:34:14 UTC);
the independent power deadline is `1792567488.2061505` (07:24:48 UTC).
Recovery does not extend either. The power guard must bind to the recovery run
while retaining the original opening/deadline; all attempts must be backed up
before its acknowledgement. Process exit is not proof of platform power-off.

## Actual verification and limits

- Linux: all 13 runner/recovery/gate regressions passed, including a real
  TERM-ignoring process timeout, tampering, input/source drift, partial output,
  exported candidate rejection and no overwrite.
- Actual CPU checkpointed backward/export: 8 training and 8 dev rows, two
  optimizer steps, batch 2, 46.6 seconds including export (training/dev metrics: 42.7 seconds); finite nonzero LoRA B weights and restored
  `use_cache=true` verified. This uses saved v1 weights solely for an operational
  smoke test, not candidate training or quality measurement.
- CUDA memory fit, candidate quality and full conversion consistency remain
  pending. CPU success does not prove that batch 16 fits the RTX 4090.
- Require every CI check on the reviewed recovery commit before dispatch.
  A failed or timed-out recovery remains a failure; do not change gates or add
  another retry automatically. Product integration remains disabled until all
  original quality, safety, coverage and real-device checks pass.
