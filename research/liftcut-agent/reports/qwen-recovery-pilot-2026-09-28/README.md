# Recovery SFT pilot: diagnostic evidence

**Validity correction:** original record/memory IDs contain category hints. Original scores
are contaminated diagnostics. The opaque-ID probe reuses the same tasks and models
trained with hinted IDs; it is not corrected training or fresh held-out evaluation.

| Arm | Original success | Opaque success | Opaque clean | Opaque blocked writes | Opaque calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| unadapted | 2/24 | 1/24 | 1 | 0 | 111 |
| clean | 21/24 | 20/24 | 17 | 0 | 147 |
| mixed | 20/24 | 17/24 | 17 | 0 | 166 |

Both SFT arms: one seed, 38 optimizer steps, 300 decisions and 12,758 supervised
tokens each. Targets and sampler positions match; context token counts differ.

The original raw `comparison.json` and manifests retain pre-discovery scope strings.
The validity correction above and the newer audit files supersede those descriptions.

- `backed-up-adapter-audit.json`: actual off-instance weight files were checked before publication.
- `public-log-audit.json`: reproducible log/config/hash agreement; weights are intentionally omitted.
- `identifier-probe-audit.json`: all 72 opaque-ID episodes replay and paired changes are recorded.
- `publication-manifest.json`: exact whitelist of copied synthetic artifacts.

Audits establish recorded-log consistency, not independent hardware or billing provenance.
[Full analysis and next experiment](../../../../docs/research/2026-09-29-recovery-results.md)
