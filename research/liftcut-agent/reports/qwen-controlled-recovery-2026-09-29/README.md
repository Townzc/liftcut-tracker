# Corrected recovery-v2 development study

Three model arms, one seed, one authored development bundle. The 48 reserved test tasks were not run.
Normal and fixed-error continuation panels have different starting states and must not be pooled.

| Arm | Normal success | Continuation success | Acceptable first recovery | Autonomous blocked writes |
| --- | ---: | ---: | ---: | ---: |
| unadapted | 0/12 | 1/9 | 3/9 | 0 |
| clean | 10/12 | 8/9 | 8/9 | 0 |
| mixed | 11/12 | 9/9 | 9/9 | 0 |

Both SFT arms consumed 648 decisions, 81 optimizer updates and 26,052 supervised tokens.
Every paired target and sampler position matches. Extra context tokens and compute time differ.

- `comparison.json`: original server audit with actual adapter files.
- `backed-up-adapter-audit.json`: re-audit of actual restored off-instance weights.
- `public-log-audit.json`: reproducible public metadata/log replay; weights are omitted.
- `review.json`: per-task action order, clarification, validation and descriptive gate inputs.
- `publication-manifest.json`: hashes of all selected and generated public artifacts.

Synthetic prefixes have zero model usage; only subsequent actions contribute to autonomous metrics.
These audits verify log consistency and artifact hashes, not independent hardware or supplier billing.
[Execution specification](../../../../docs/research/2026-09-29-controlled-recovery-experiment.md)
