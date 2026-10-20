# M4 v2 — single-candidate GPU window

This is a new M4 experiment. Do not rerun the v1 `run_all.sh` with v2 expectations.
The maintainer opens the AutoDL RTX 4090 24 GB and supplies current SSH details.
The agreed compute price is ¥2.18/hour; complete collection then shut down the
instance. No new GPU has been opened for this preparation. Do not reuse the old
connection or treat a stopped training process as platform power-off.

## Frozen design

- Original Qwen3-0.6B base revision and all seven original SHA-256 checks.
- Preserve 4,000 old training labels; add 2,400 contrastive examples. Train 6,400,
  dev 740; evaluate 740 dev + 240 new synthetic challenge + 500 old test + 60 old
  handwritten = 1,540 unique IDs. The challenge is compositional synthetic data,
  not independent human acceptance. Old tests have already guided diagnosis.
- One seed (20261019), fresh base, LoRA rank 16/alpha 32/dropout .05, batch 16,
  lr .0002, two epochs (800 optimizer steps), maximum 512 tokens, answer-only loss.
  No hyperparameter sweep, best-checkpoint selection or automatic retry.
- Baseline: saved v1 merged weights with the same new prompt on all 1,540 inputs.
  Compare to the new merged checkpoint to separate prompt and training effects.
- Same-token greedy inference, max 256 new tokens, four decode/prefill threads,
  reset between samples. Compare the new quantized model to both new HF and f16
  GGUF outputs. Quantization choice is fixed in `protocol-v2.json` before any new
  challenge inference: Q8_0. Saved-weight Q4 exceeded the 53 disagreements
  allowed by the original 1,060-case 95% gate even after input/runtime alignment.
  The full Q8 diagnostic is still running and is not claimed to have passed yet.

Candidate advancement requires raw parsed-JSON agreement >=95% against **both**
references, no truncated quantized answers, challenge exact rate >=90%, schema
validity >=99%, zero raw invented fields on the challenge, zero unsafe/invented
accepted outputs on all four sets, and >=90% correctly accepted challenge
actions. These engineering gates are fixed before inference; failures remain
failures. Report all old-test/handwritten coverage, raw errors and rejected-correct
counts, even when a gate passes. Guards must never replace raw agreement.

`candidatePassed` is **not** release permission. Current bounded grammar itself
is a parser, so no incremental model benefit over an updated grammar baseline is
established. Independent natural-language acceptance, adequate old-phrase
coverage, native integration and real-device measurements remain required.
The interface and user confirmation flow stay unchanged. There is no activation
switch in this runner.

## Before running

1. Record the instance ID, GPU, opening time and an immutable power-off deadline
   no later than opening +4h. Install an independent power guard **before** setup.
   Inspect the actual platform shutdown command and interpreter first: the prior
   instance's bare `/usr/bin/shutdown` failed with an exec-format error. Confirm
   the platform reports OFF after use; a guard PID or SSH disconnect is not proof.
2. Limit setup to 20 minutes. Check out the reviewed, fully green commit in a
   clean directory; install Node dependencies with the committed lockfile. Avoid
   symlinking another checkout's workspace packages. Reuse the preserved model,
   Python and pinned llama source caches; this runner installs nothing and fails
   on wrong hashes, package versions, missing CUDA or insufficient disk.
3. Use a new output directory outside both checkout and cache. Work is capped at
   3h and also by `--stop-at`; set it at least 40 minutes before the fixed power
   deadline. Do not extend the original deadline when retrying setup.

```sh
python3 research/m4-parser/run_v2.py \
  --cache /absolute/path/to/verified-v1-work \
  --out /absolute/path/to/new-v2-run \
  --commit <reviewed-commit> --stop-at <fixed-UTC-epoch>
```

Exit 3 means the candidate failed the fixed gates, not a reason to retry. Any
other failure keeps logs and partial artifacts for collection. The output folder
must be new, so attempts cannot overwrite each other. The run manifest records
commit/tree, protocol, stage times and exits; source/data/model hashes bind the
evidence. A total timeout kills a TERM-ignoring child after ten seconds.

## Collection and shutdown

Collect `run.json`, acceptance, all metrics, raw predictions, input token audits,
logs, data manifest, adapter, merged weights, GGUF and `sha256.json`. Keep weights
outside Git. Copy to the local machine, verify every SHA-256, restore into a new
directory and replay scoring/ID completeness before shutdown. A quality failure
still requires collection. Reserve the remaining time for transfer; do not start
another candidate or consume the backup reserve to improve a score.

After verified collection, use the pre-authorized shutdown and confirm OFF in
AutoDL. Do not delete/release the instance or old artifacts. If collection cannot
finish by the deadline, preserve the data disk, stop compute, and report exactly
what remains uncollected. Computing-price estimates exclude storage and must not
be presented as a bill.

Validation to date: actual eight-row/two-step CPU SFT and export, actual two-row
HF/Q4 inference, plus eight runner/gate tests including complete mocked dispatch
and a real TERM-ignoring process timeout. These are harness checks, not a v2 GPU
result or a fresh-base full CPU training run.
