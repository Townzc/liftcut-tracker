# M4 v7: one prompt-alignment candidate

The v6 candidate remains rejected. [V7 data preparation](DATA_V7.md) tests one
hypothesis: aligning train/dev system instructions with the existing inference
reason enumeration. It does not assume this is the cause of the three focus failures.

| Arm | Source | New work |
| --- | --- | --- |
| H | Archived v4 D carried in the verified v6 backup | None; historical context |
| T | Archived v6 T, repaired labels and original catalogs | None; hash-bound control |
| S | Pinned original Qwen3-0.6B, original token-mean trainer | One training; HF, F16 and Q8 predictions |

The [protocol](protocol-v7.json) fixes S as the only candidate. Every one of T's
6,400 sentences, labels, catalogs and row positions is unchanged. S train/dev
alone use the frozen enum system. Dev loss under that system is not directly
comparable to historical T's differently prompted loss and cannot select a model.
Keep original base, seed 20261019, two epochs/800 steps, batch 16, rank 16,
lr 0.0002, 512-token limit and activation checkpointing. No new examples,
catalog augmentation, sample-mean loss, grammar, repair, retries or extra epochs.
The private 20 originals and every derivative remain outside this experiment.

One training and three 1,040-item streams mean **3,120 new predictions**. H/T's
2,080 cached outputs are identified separately. Cached controls cannot establish
speed improvements, and these observed development sets are not independent
acceptance. Four threads, greedy decoding, 256 new tokens and reset KV remain
fixed. HF uses server CUDA; GGUF uses server CPU, not a phone.

## Input and result verification

[Control assembly](../run_v7_control.py) checks 14 archived files, including
model weights, predictions, input tokens, training metrics, manifests and run
provenance before copying H/T. [The runner](../run_v7.py) verifies original base,
runtime/converter, source hashes, regenerated data and full train/dev token/mask
receipts before loading weights. Only system/user messages enter inference.

The frozen v6 assessor keeps every numeric gate: challenge exact ≥90%, schema
≥99%, raw unsupported fields 0, guarded unsafe 0, original source-v1 challenge
coverage ≥90%, and Q8 agreement ≥95% with both HF and F16. Each focus family
needs ≥14/15 strict negative reasons and ≥14/15 useful positive results; overall
positive challenge exact needs ≥108/120. All 1,040 candidate outputs must use
legal clarification reasons; S/HF/F16 must never truncate. T/H failures stay
visible and never substitute for S. The summary retains the legacy filename
`catalog-summary.json` for the frozen assessor, but describes the v7 intervention.

Even a pass sets `releaseReady=false`. Continuous acceptance with the actual
candidate, useful coverage, native integration and physical-device acceptance
still precede activation. Existing UI and confirmation/write paths stay intact.

## Storage and a fresh window

CPU and all exact-head CI plus full/incremental source restoration must pass
before an opening notice. V6 is OFF; no old opening/deadline is reused. Once the
maintainer opens the RTX 4090, record a fresh window ID and original deadlines:
three hours for work, the fourth reserved for verified backup and shutdown.
Install a platform shutdown backstop and finish early when possible.

V7 needs **10 GiB live free on the selected output filesystem**, recalculated
for one candidate: measured four-weight set 3,070,186,192 bytes, an equally large
full archive duplicate, 1 GiB converter allowance and 3 GiB source/log/dependency/
temporary reserve (10,435,339,680 bytes total). V6's two-model 16 GiB preflight is
unchanged. Last observed data-disk usage was 78.57%; it is not live evidence of
available bytes. Check both existing filesystems after setup and choose a new,
separate output directory only where ≥10 GiB remains. Stop if neither qualifies;
do not delete retained assets or purchase storage. Require ≥22 GiB GPU memory.

```sh
python research/m4-parser/run_v7.py --cache "$CACHE" --baseline "$VERIFIED_V6_RUN" \
  --out "$FRESH_OUTPUT" --commit "$REVIEWED_COMMIT" --stop-at "$ORIGINAL_WORK_DEADLINE"
```

GNU timeout bounds children. Exit 3 is quality rejection, not a retry request.
Preserve partial/failed outputs and keep the original power deadline. Use
[backup_v7.py](backup_v7.py) with explicit window/commit/deadline to pack and
restore all logs, source, five streams (three new, two cached) and **four S weights**.
Full artifacts must be hash-verified off-instance before early shutdown; if a
transfer fails, retain remote assets and still obey the power deadline. Confirm
platform OFF before clearing the completed timer. This helper never powers off.

## Why subsequent continuous acceptance stays separate

[Anthropic's agent evaluation guide](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
distinguishes a conversation trace from the resulting environment state.
[OpenAI's Structured Outputs report](https://openai.com/index/introducing-structured-outputs-in-the-api/)
also notes that valid structure does not guarantee correct values. Our application
of these principles is to retain semantic and useful-positive gates now, then
check actual confirmed-record identity and compensating undo in continuous
acceptance. These reports do not establish that our candidate passes either
stage; no extra examples or decoding intervention are added to this comparison.
