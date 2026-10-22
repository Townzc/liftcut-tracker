# M4 v5 CPU preparation · 2026-10-22 UTC

**No v5 GPU run or model-quality result. Native remains off.** This prepares the
[fixed loss-reduction comparison](../../train/GPU_V5.md) after v4's failed gates.
The private 20-utterance acceptance and all derivatives remain outside training.

What actually ran:

- Ten real CPU/autograd tests cover independent per-example CE/gradients, padding
  invariance, prompt/final-logit zero gradients and learned EOS, equal/unequal
  lengths, partial/noncontiguous batches, float16/bfloat16 inputs, invalid inputs
  and actual random tiny-Qwen3 gradients versus separate forwards. The initial
  tiny-model probe's maximum gradient difference was 2.98e-8; it is not a quality
  test of a pretrained parser. [Tests](../../test_sample_mean_loss.py).
- Real CPU SFT smokes for both objectives, two steps each, batch 2, gradient
  checkpointing, the same 12 synthetic training / six dev examples and saved v1
  merged base. Initial control/candidate training reported 82.4/77.2 seconds.
  Both exported finite, updated adapters and merged models with KV cache enabled;
  adapter hashes differ. Candidate verification then removes an unnecessary
  previous-batch logits reference. One subsequent merged-model export hit a full
  C drive; its log and partial output are preserved. A fresh E-drive replay
  completed (73.7 training seconds) and its adapter is byte-identical to the initial
  candidate adapter. There were three complete CPU smokes and one failed export;
  the receipt distinguishes them instead of hiding the failed attempt.
  These tiny timings/losses do not estimate GPU speed, effectiveness or final quality.
  The GPU runner still requires the pinned original pretrained base.
  [Metrics, source/input/export hashes](cpu-smoke.json).
- Seven Linux runner tests cover frozen conditions, input/history byte identity,
  altered history/assistant leakage, candidate selection, original positive and
  strict-reason gates, truncation scope, two trainings/four streams and stopped
  partial evidence. Process dispatch is mocked; no model result is fabricated.
  [Tests](../../test_v5_runner.py).
- The exact 1,040 inputs and H bytes were assembled from the restored v4 run.
  Historical H was cloned under T/S names **only to exercise report wiring**;
  strict-reason statistics match v4 and all artificial pair differences are zero.
  No new T/S inference occurred. [Assembly receipt](assembly-replay.json).
- Eight backup tests use byte fixtures: real tar packing/restoration of both sets
  of eight staged weights and five 1,040-row streams, partial-state preservation,
  corruption, missing complete files, wrong binding/deadline, traversal and symlink
  rejection. These are not actual v5 trained weights. [Tests](../../test_v5_backup.py).

Local runtime: torch 2.8.0+cpu, transformers 5.20.1, peft 0.21.2. New TS reporting
passed type-check and lint. Final exact-head CI and source restoration are separate
opening gates; local checks do not stand in for them. The new `m4-loss` CI job uses
CPU torch and a randomly initialized tiny model without downloading weights.

The loss-normalization change gives examples equal coefficient mass within a
batch. It does not prove equal gradients, fewer invented fields or better RPE
scope detection. The fresh control, positive-case floors and unchanged safety
gates are needed to test those outcomes. All v4 frozen sources/data stay unchanged.

Learning checkpoint: explain token mean versus example mean, why a fresh control
helps interpret historical drift, why CPU/autograd success is not a model pass,
and why a passed candidate still needs continuous and physical-device acceptance.
