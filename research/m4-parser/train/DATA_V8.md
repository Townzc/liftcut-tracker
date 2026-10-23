# M4 v8 data: one shared schema/policy contract

[Historical audit](../results/contract-v8-20261023/HISTORY.md) confirms the 213→180
regression on identical challenge bytes. V8 tests an intervention defined after
those results, not a preregistered explanation of them.

[The builder](../scripts/build-v8.ts) calls the frozen v7 builder, retains every old
file byte and creates A/D train/dev variants. All 6,400 training IDs, sentences,
labels, catalogs and row positions remain identical. Only D's system message
changes to [one shared contract constant](../src/contract-v8.ts). That same constant
is used for contract inference; enum inference stays byte-identical to v7. There
are no new examples, paraphrases, model outputs or acceptance-derived content.
The private 20 originals **and all derivatives** remain excluded.

The contract contains the six output shapes, exact catalog/alias binding, explicit
weight units and numeric roles, completed-set limits, RPE range and per-set scope,
sparse corrections, and the ten legal clarification reasons. It says not to
substitute actions by equipment or list position. These are schema/policy rules,
not the private examples or rewrites of failed public examples.

The first compact draft exceeded 512 tokens (maximum 521). Redundant wording was
removed using token counts only, before any new inference. The frozen final D
train/dev maxima are **511/510**, A maxima **348/347**. No rows were dropped or
truncated. Full token IDs, assistant-only masks, inference-prefix equality, payload
allowlists and order are checked by [audit_v8_inputs.py](audit_v8_inputs.py).

Two actual CPU optimizer steps using 12 training/six dev rows produced finite,
changed adapter weights and a merged export with cache enabled. The smoke uses
saved v1 merged weights, batch 2/rank 4; it verifies execution, not original-base
training or model quality. The GPU run uses the pinned original base and unchanged
800-step token-mean training. [CPU evidence](../results/contract-v8-20261023/README.md).

Both 1,040-item inference variants contain only ID, system and the allowed user
sentence/catalog payload. Their payloads, IDs and order match; only system text
differs. Gold remains in separate scoring files. Enum input bytes/token IDs
reproduce v7. The original tokenizer serialization differs from the saved CPU
copy; complete token sequences, rather than filenames, establish equivalence.

Dev loss under different prompts is not directly comparable and cannot select
the candidate. No data replacement, objective change, catalog augmentation,
grammar, output repair, retry or prompt search using new model outputs is added.
