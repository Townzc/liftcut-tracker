# M4 next acceptance preparation

Current state: **GPU not ready; native integration not started.** The v2 quality
failure remains recorded. [Data v3](DATA_CARD_V3.md) passed preparation checks;
[G1](results/closed-decode-20261021/README.md) fixed format while increasing
invented fields and is not automatically the next decoding configuration.

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
