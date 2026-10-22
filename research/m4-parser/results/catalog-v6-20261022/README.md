# M4 v6 CPU preparation · 2026-10-22 UTC

**No v6 GPU training or quality result. Native remains off.**
The [versioned data policy](../../train/DATA_V6.md) repairs the registered aliases
in both arms and changes only the candidate's model-visible catalogs.

Actual checks so far:

- Both 6,400-row arms and 740 dev rows pass real tokenizer encoding without
  truncation. Maximum sequence lengths: T 296, S 294, dev 295; limit 512.
  Both training arms contain 208,114 answer tokens. The [public preflight](../../train/audit_v6_inputs.py)
  reproduces all token hashes from the independently executed CPU receipt.
- Two real CPU SFT/export smokes, two steps each, batch 2/rank 4 with activation
  checkpointing. Twelve synthetic training rows cover alias repair, missing-unit
  and RPE-scope positive/negative cases and ordinary recording; six existing dev
  rows check the loop. Both use the same saved **v1 merged** model for workflow
  validation, not the original pretrained GPU initialization. T/S take 46.1/44.7
  internal training seconds and export finite, updated adapters/merged weights
  with KV cache enabled. These timings/losses are not candidate quality or GPU
  speed estimates. [Metrics, input/export and source hashes](cpu-smoke.json).
- Three input-audit tests include altered targets, systems, sentences, extra
  history/selection fields, duplicate IDs and supervised-token truncation.
- Eight Linux backup tests exercise real tar packing/restoration with eight
  **byte-fixture** weights and five 1,040-row fixture streams; corrupt/missing
  weights, wrong window/deadline, traversal, symlink and partial-state cases.
  V6 rejects old v5 window identifiers. [Versioned recovery](../../train/backup_v6.py).
  These tests are not a backup of newly trained candidate weights.

The frozen v1–v5 files remain unchanged. The 20 private originals and all
derivatives are outside both training and these diagnostic inputs. App UI,
write confirmation and model flags are unchanged. A complete frozen runner,
report assembly, final CI and source restoration still precede the opening
notification. A later model pass still requires continuous and physical-device
acceptance; CPU success cannot authorize release.

Learning checkpoint: explain why equal answer-token counts do not guarantee
equal learned behavior, why the smoke base differs from the GPU base, and how
window/commit/hash binding prevents accepting a different experiment's backup.
