# M4 next acceptance preparation

Current state: **the [fixed v3 experiment](results/run-20261021T222100Z-v3/README.md)
completed inference, was backed up and shut down, and failed quality gates after
offline scoring recovery. Native integration is not started.** Q8 challenge exact
fell from 213/240 to 187/240; invented fields increased from 50 to 153. Quantization
agreement passed. The original scoring environment failure remains recorded.
[Data v3](DATA_CARD_V3.md) passed preparation checks;
[G1](results/closed-decode-20261021/README.md) fixed format while increasing
invented fields and is not automatically the next decoding configuration.

Before another GPU experiment, finish the application contract: a server-owned
pending preview and a confirmed row have distinct IDs/revisions; explicit inherited
load binds an exercise-specific confirmed source; per-hand basis survives storage;
void and redo are separate confirmed operations. Connect these to a real Agent
caller and test continuous dialogue with reads, clarifications and approval actions.
The 20 originals remain private regressions, never training data or paraphrase seeds.
An atomic parser replay plus scripted approvals does not satisfy this requirement.

The next runtime must pass `scripts/check-workspace.mjs` from its own reviewed
checkout before any model invocation. Reusing dependency files is allowed only when
workspace imports resolve to that checkout. The v3 runner now enforces this; no
failed-run file or score was overwritten. Consider moving future GGUF CPU evaluation
off the GPU instance after verified export/backup, in a separately frozen protocol.

1. Collect new natural utterances separately from training and development.
   The maintainer supplied 20 scenario utterances; spontaneous human collection
   or authorship is not verified. The fixed CPU pilot has now observed these cases;
   they are diagnostic evidence, not unseen final acceptance. Keep raw text
   private unless publication is authorized. AI-authored paraphrases remain
   synthetic and must not be labelled human data.
2. Before inference, freeze raw inputs, interpretation labels, ambiguity decisions,
   IDs and hashes. Unknown stays null; plans/negation/uncertainty are not actuals;
   corrections must not acquire absent fields. Where the text cannot determine a
   target, ask for clarification instead of guessing. Never label from model output.
3. Use this small pilot to identify coverage gaps and compare original rules,
   source-v2 rules, raw model and guarded model separately. If it guides changes,
   it becomes development evidence; do not reuse it as unseen final acceptance.
   Ten or twenty examples alone cannot establish broad deployment quality.
   Contextual corrections and mixed query/write requests also need a separate
   continuous Agent workflow test; the six-intent parser cannot establish those
   end-to-end capabilities by itself. Never count a scripted harness as model behavior.
4. Freeze the next single-candidate protocol before opening a GPU window: original
   base/data/source hashes, prompt and decoding configuration, bounded schedule,
   independent evaluation provenance, backup/shutdown deadlines and all CI checks.
   Keep the [existing quality and quantization gates](train/GPU_V2.md); changing
   an implementation or evaluation set must not turn the old failure into a pass.
5. Demonstrate useful coverage beyond the deterministic baseline before carrying
   model download/runtime cost into the app. The current equality-based guard
   cannot by construction accept an action the source-only baseline cannot parse.
   Guard safety, correct acceptance and raw model quality are distinct metrics.
6. Only a qualified candidate proceeds to native integration and physical-device
   tests for cold start, offline parsing, memory, interrupted download and matching
   confirmation behavior. No benchmark timing replaces those measurements.

No automatic model requests, training, server opening or product activation are
scheduled by this document. Notify the maintainer when a concrete GPU window is ready.

The [numeric-role/continuous-context replay](results/context-20261021/README.md)
preserves the 20 originals and distinguishes archived model predictions from
scripted DB approvals. Pending workout previews now have a separate versioned
contract: approximate values stay approximate; unknown and previous-confirmed
load are different; per-hand basis cannot silently disappear into scalar storage.
Compound input is routed away from the atomic parser. These internal components
do not yet have an app caller and cannot be claimed as full Agent acceptance.
