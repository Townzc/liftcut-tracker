# M4 v4: fixed data × prompt comparison

**Completed result:** [v4 run and verified shutdown](../results/run-20261022T034000Z-v4/README.md).
Candidate D failed the unchanged gates; native remains off. This document records
that experiment's frozen design and operation, not authorization for another run.

The [runner](../run_v4.py) and [protocol](protocol-v4.json) are a new experiment;
v2/v3 failures remain closed. [Data changes](../DATA_CARD_V4.md) replace only
720 boundary rows, retaining 5,680 rows/order, 740 dev and the short SFT prompt.
The 20 private originals, paraphrases, numeric variants and outputs are never
training seeds and are not accepted as inputs by this runner.

| Arm | Weights | Inference prompt | Role |
| --- | --- | --- | --- |
| A | Archived v3 Q8 | Original short | Exact archived outputs, no new calls |
| B | Same archived v3 Q8 | Short + legal clarification reasons | Prompt diagnostic |
| C | New v4 Q8 | Original short | Data diagnostic |
| D | Same new v4 Q8 | Short + legal clarification reasons | **Preselected candidate** |

A→B and C→D isolate the prompt factor; A→C and B→D compare the data factor.
Report gains/losses per family and split, invalid reasons, correct reasons and
false refusals. No cell replaces D after results. One training only: pinned
original Qwen3-0.6B, two epochs/800 steps, batch 16, rank 16, lr 0.0002,
seed 20261019, max length 512, activation checkpointing. No grammar constraints,
output repair, teacher labels, retries, sweep or old fine-tuned initialization.

Inputs are the same **observed** 740 dev + 240 challenge + 60 handwritten rows.
This is not independent generalization evidence. New streams B, D-HF, D-F16, C
and D each have 1,040 rows (**5,200 new predictions**); A reuses 1,040 archived
predictions. Missing/tampered A stops the run, never silently recomputes it.
Archived A's timing is historical and cannot support a controlled speed claim.
HF/F16 references use D's exact enum input bytes/token IDs; A/C use the same
short inputs. Different prompt factors intentionally have different token hashes.
All decoding stays greedy, 256 new tokens, four GGUF generation/prefill threads,
independent KV state. Source, input, base, converter and baseline hashes are pinned.

## Gates fixed before GPU outcomes

All original gates apply to D: Q8 agreement ≥95% with both HF and F16, challenge
exact ≥90%, schema ≥99%, invented fields 0, truncation 0, guarded unsafe 0 and
challenge correct acceptance ≥90%. Original source-v1 remains mandatory;
source-v2/source-only comparisons are additional and cannot substitute a pass.

Additional checks: each of the three target negative challenge families must
give the **correct clarification reason** on ≥90% (at least 14/15); each paired
positive family must retain ≥90% exact (14/15), and all 120 positive challenge
cases ≥90% exact (108/120). D must emit zero invalid clarification reasons across
all 1,040 rows. The original evaluator resolves valid reasons to one clarify
action; the extra reason metric closes this blind spot without rewriting old scores.
All-clarify output and legal-but-wrong reasons are explicitly tested failures.

Even passing sets `releaseReady=false`. A passing candidate still needs the
continuous application contract, useful coverage beyond deterministic parsing,
native integration and physical-device acceptance. No UI, confirmation, app flag,
deployment model or user data is changed by this runner.

## Operation after CPU and exact-head CI pass

Notify the maintainer to open the existing AutoDL RTX 4090; verify the current
connection information. Do not treat an old SSH session or OFF observation as
current. Cached runtime: torch 2.8.0, transformers 5.20.1, peft 0.21.2,
llama-cpp-python 0.3.36; ≥22 GiB GPU memory and ≥20 GiB free disk. No downloads.
The original base's seven files and cached converter must match their manifests.

Use a clean checkout of the exact reviewed commit. Its own workspace package
bindings must pass `scripts/check-workspace.mjs`; never use stale core bindings
from another checkout. `BASELINE` is the restored v3 run directory with its five
pinned files, including `gguf/parser-q8_0.gguf`. `CACHE` contains `base/`,
`venv/bin/python` and `src/llama_cpp_python-0.3.36.tar.gz`. A fresh output directory
must be outside the checkout/cache/baseline. Preserve the archived baseline.

```bash
python research/m4-parser/run_v4.py \
  --cache "$CACHE" --baseline "$BASELINE" --out "$NEW_RUN_DIRECTORY" \
  --commit "$VERIFIED_COMMIT" --stop-at "$STOP_AT"
```

Work deadline: at most **3 hours**, plus **1 hour reserved** for off-instance
backup, hash/restore checks and shutdown inside the four-hour operating window.
Schedule a platform shutdown backstop at opening; program exit is not power-off.
Old per-stream timings suggest roughly two hours but enum overhead is unmeasured;
this is a planning estimate, not a promise or permission to extend the deadline.
GNU timeout stops child process groups. Exit 3 is a failed development gate;
retain all outputs and stop. On failure/timeout, back up partial results too.
Never start a second candidate, silently extend time or publish weights to Git.

Collect all outputs, audits, weights, logs, run state and SHA inventory. Restore
and hash-verify off-instance copies before shutting down early; verify platform
OFF even after failures. Keep remote assets until backup validation completes.
If collection fails, use the reserved hour, preserve remote state and obey the
original shutdown deadline; report incomplete backup explicitly.

## Actual CPU evidence

[Tokenization/two-step SFT](../DATA_CARD_V4.md) and [assembly replay](../results/data-v4-20261022/assembly-report.json)
verify 1,040 unique inputs, byte-identical archived A, the two prompt hashes and
all baseline files. Re-scoring archived A reproduces 187/240 and 153 invented
fields. Cloned cells only exercise report wiring, not new B/C/D model results.
Four new Linux runner regressions and 13 existing budget/timeout tests pass;
full process dispatch is mocked, while GNU timeout really kills its test worker.
Full root suite: 9 JS + 233 TS; type/lint checks pass (two existing lint warnings).
At this preparation stage GPU metrics and phone performance were unmeasured.
The completed GPU result is linked above; physical-device performance remains unmeasured.
