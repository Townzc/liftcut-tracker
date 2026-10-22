# M4 v4 controlled boundary-data preparation

This is preparation, not a candidate accuracy result. The [paired v3 regression](results/20261022-regression-analysis/README.md)
found 42 losses and 16 gains: missing-unit/RPE over-acceptance and invalid clarification
labels dominate. HF, F16 and Q8 all scored 187/240, so quantization is not the main
explanation. Template dependence is a hypothesis, not an isolated causal finding.

The [generator](scripts/build-v4.ts) replaces exactly **720 of 6,400 training rows**:
120 positive/negative pairs each for missing units, RPE scope and unknown exercises.
The other **5,680 rows retain their bytes and positions**. Labels come first; no
model guesses or evaluation outputs supply targets. The short SFT prompt, original
base requirement, optimizer configuration and 740 development rows remain unchanged.

- Missing units: 60 implicit and 60 explicit omissions, including 40 corrections.
  Positive partners explicitly state their units; negatives never default to kg.
- RPE: last-set/every-set scopes balanced across three sentence positions (20 pairs
  per cell). Other sets stay null for last-only RPE. Ambiguous scope requires clarification.
- Exercise names: 40 plausible absent names, 40 ambiguous names and 40 explicit
  absence cues. Positives use exact catalog names; no absent name is force-matched.

The planned 2×2 comparison uses archived v3/new v4 weights and short/closed-reason-list
inference prompts. Only one new model is trained. The reason list is an inference
factor, never a changed SFT prompt. D (new model + reason list) is the preselected
candidate; other arms diagnose causes, not alternate winners chosen after results.
The runner and bounded protocol must be reviewed separately before any GPU request.

Evaluation remains the **observed** 740 dev + 240 challenge + 60 handwritten rows.
These are not blind tests. Concepts and some lexical components are shared with
training; no generalization claim follows from different template IDs or numbers.
The 20 private originals, their rewrites, numeric variants and outputs are excluded
as training seeds. An exact/substring isolation audit is an additional check, not
proof of semantic independence. [Manifest](data/v4-manifest.json).

Actual CPU results: four new data regressions; full root suite **9 JS + 232 TS**,
TypeScript and production build pass; lint has zero errors/two existing warnings.
Real tokenizer maxima: 296 train/295 dev tokens (including targets); short/enum
evaluation inputs 179/231, with zero truncation. [Token audit](results/data-v4-20261022/token-audit.json).

Two actual CPU optimizer steps used 12 representative training and six dev rows;
training/dev metric time 22.5 seconds, finite adapter values, nonzero LoRA B and
exported `use_cache=true`. This uses the **saved v1 merged model**, not the original
pretrained base; it checks the workflow, not model quality or GPU time.
[CPU evidence](results/data-v4-20261022/cpu-smoke.json). No GPU or model generation ran.

Generate: `node --import tsx research/m4-parser/scripts/build-v4.ts`; `--check`
reproduces the committed manifest. Generated rows and all weights stay outside Git.
Original raw/source-v1 gates remain mandatory; source-v2 is additional. Native
integration, continuous acceptance of a passing candidate and physical-device tests
remain release prerequisites. No UI or confirmation behavior changes here.
