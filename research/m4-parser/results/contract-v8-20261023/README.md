# M4 v8 preparation evidence

No v8 GPU experiment or efficacy result exists here. V7 remains rejected and the
native parser remains disabled. [History analysis](HISTORY.md) verifies the v2
peak 213/240 and v7 180/240 on byte-identical challenge gold; 53 losses and 20 gains
explain the net decline. [Protocol](../../train/GPU_V8.md) separately compares
training and inference prompts, fixes D before outcomes and retains all gates.

| Evidence | What actually ran | Limit |
| --- | --- | --- |
| [history.json](history.json) | Seven hash-bound saved prediction/score sets, original failure IDs and strict diagnostics | Retrospective, observed challenge; no new inference |
| [cpu-smoke.json](cpu-smoke.json) | All A/D tokens/masks, paired 1,040-item inputs, two real CPU optimizer steps and exports | Saved v1 merged base; not original-base GPU training or model quality |
| [assembly-replay.json](assembly-replay.json) | 36 scoring reports, cloned historical HF streams, cached provenance and wrong-prompt-audit rejection | Wiring fixtures, not fresh factorial outputs |
| [artifact-restore.json](artifact-restore.json) | Real full weights restored for both completed-state branches and independently hashed | Historical weights plus synthetic state fixtures; no v8 result |

All 6,400 training tuples/catalogs/order remain fixed. D's maximum train/dev
lengths are 511/510 with no truncation; enum maxima remain 348/347. The shared
contract contains policy/schema only. No private 20 originals or derivatives,
failed-case rewrites or new examples enter training or this CPU experiment.

Local verification passes: root 9 JS + 252 TS, lint (zero errors/two existing
warnings), production build, 23 Python tests (one additional Linux-only test
skipped on Windows), four window tests and three exact-cache-cleanup tests.
Every exact-head CI and full/incremental reviewed source recovery must also pass
before a fresh opening notice. Readiness receipts
for the final commit are kept in the private operations backup to avoid claiming
a checked commit can include its own final CI result. A development pass would
still require candidate continuous, native and physical-device acceptance.
