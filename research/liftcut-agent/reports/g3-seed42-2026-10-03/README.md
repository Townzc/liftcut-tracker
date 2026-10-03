# G3 seed42 complete evidence

Two new stop-context adapters,222 native/environment episodes and376 actual
generations were restored with actual weights and original token IDs. `stop_half`
passes the frozen stopping mechanism gate; `stop_all` fails with one false stop.
Both fail the overall candidate gate because memory/ID regress. No model promotion.

- [Full Chinese review](../../../../docs/research/2026-10-03-g3-complete-results.md)
- [Machine-readable review and every case gain/loss](review.json)
- [Original frozen audit](run/comparison.json), [source-copy provenance](publication.json)
- [Actual restore receipt](restore-receipt.json), [archive index](backup-index.json)
- [Recovery/transfer observations](operations.jsonl), [separate actual consumer](overnight-receipt-consumption.json)
- [Power handoff](overnight-handoff.json), [inspected handoff repair](inspected-handoff-repair.json)
- [Record-order choices](memory-arrangement-review.json), [prior collector history](collector-history/manifest.json)

The historical G2 coverage_mix control was not retrained. Both G3 arms reproduce
the same initialization and first12 shared steps; this proves only that prefix.
These are111 reused development cases per arm, including one negative control
outside110 gate-panel cases. Reserved48 remain unused; no independent generalization.

The two132,187,888-byte adapters (504 tensors each) are deliberately excluded from
Git. Their hashes and actual local validation are recorded, not replaced with fake
weights. The public CPU check verifies metadata/native/token evidence; it does not
claim to read omitted weights again. Only these two files are omitted from original
inventories, and all included evidence bytes are preserved.

G3 compute ended06:50:07UTC; actual receipt published07:13:23, separately validated
by the overnight handoff07:13:24. The maintainer explicitly authorized continued
use until14:00UTC/07:00Los_Angeles, cumulativeCNY20. The original controller's ACK
consumption is unobserved. The server is intentionally still on; neither a shutdown
nor stopped provider billing is claimed. The new guard is independent of frozen G3.
Client-end cumulative compute proxyCNY3.575 plus previous failed openingCNY0.363 is
not a final overnight invoice; do not double-count the original boot duration.

From the repository root, using the pinned tokenizer and prepared inputs:

```sh
python research/liftcut-agent/analyze_g3_results.py --public-dir research/liftcut-agent/reports/g3-seed42-2026-10-03 --prepared-dir research/liftcut-agent/outputs/g3-prepared-a --diagnostic-dir research/liftcut-agent/outputs/state-diagnostic-v1 --d2-dir research/liftcut-agent/outputs/d2-prepared-a --tokenizer-dir research/liftcut-agent/outputs/tokenizers/cdbee75f17c01a7cc42f958dc650907174af0554 --check
python research/liftcut-agent/analyze_g3_memory.py --public-dir research/liftcut-agent/reports/g3-seed42-2026-10-03 --check
```

See CI for rebuilding prepared data and tokenizer verification. No GPU/API is
required for public replay. Figures preserve panel denominators and all regressions.
