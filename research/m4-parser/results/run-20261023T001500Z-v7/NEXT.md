# Next CPU design draft after v7 observations

This is a post-result proposal, not a frozen protocol or a GPU-opening notice.
The complete HF stream was inspected before writing it; F16/Q8 were still running.
Do not treat these hypotheses as predictions made before v7.

## Question and proposed control

The aligned short instruction names legal reasons but does not spell out the
per-intent required JSON fields, an unnamed exercise's null value, or numeric
field roles. Test a compact self-contained contract derived from the existing
schema and existing training policy, without adding sentences or editing labels.
Do not add failed evaluation examples, templates, numeric substitutions, private
20 originals, paraphrases, outputs or other derivatives to training.

A proposed train × inference design separates teaching the contract from merely
showing it at inference:

| Cell | Weights | Inference system | Evidence |
| --- | --- | --- | --- |
| A | Verified v7 S | Current enum | Cached v7 HF, not a new timing control |
| B | Verified v7 S | New contract | Proposed fresh HF |
| C | One fresh original-base candidate | Current enum | Proposed fresh HF |
| D | Same fresh candidate | New contract | Proposed fresh HF; sole candidate |

Keep all 6,400 sentence/label/catalog/order tuples, token-mean objective, base,
seed and hyperparameters. Do not choose B or C after seeing their scores.
Three new HF streams would mean 3,120 model calls. Quantization checks add 2,080
only if D first meets the unchanged semantic, schema, source-coverage, legal-reason,
useful-positive and zero-truncation gates. This conditional sequence would save
the long GGUF CPU evaluations for viable candidates. Unrun quantization is
explicitly **not measured**, never counted as passing. Freeze this change before
any future GPU opening; v7's running unconditional protocol stays untouched.

## CPU prerequisites still pending

1. Define one shared system contract for both the builder and predictor. Include
   exact output shapes, required record fields versus sparse corrections,
   available-exercise identity and null handling, explicit units, set/repetition
   roles, and explicit RPE scope. Reason vocabulary must match the existing schema.
2. Preserve every original training tuple and all evaluation bytes. Hash the
   complete paired sequence, input allowlist, tokens and answer masks. Fit the
   existing 512-token bound without dropping rows or truncating answers. A
   read-only audit found the legacy full cloud prompt exceeds it on 54 train and
   six dev rows; it is not a ready replacement.
3. Use CPU fixtures drawn independently of private acceptance and no model-driven
   prompt search. Exercise failures in input, provenance and stop/deadline checks;
   run the real CPU train/export smoke with its limited meaning stated.
4. Add explicit completed-semantic-rejection and quantization-not-run states to
   the new runner and recovery contract. Back up the exact artifacts actually
   required by each state; do not silently waive missing weights or streams.
5. Verify the fresh window's actual output and backup space with old assets
   retained, full/incremental source recovery, and every exact-head CI check.
   Only then notify the maintainer to open a new server.

Passing development still leaves candidate-based continuous dialogue acceptance
with the private 20, useful incremental coverage, native integration and physical
device checks. Existing UI and confirmation/write paths remain unchanged.
