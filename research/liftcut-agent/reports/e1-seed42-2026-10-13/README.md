# E1 real complete-task evidence

A = latest-valid-memory view baseline; D adds source resolution and stable IDs with inverse mapping. Both fresh arms pass 48/48 complete tasks, with 0 paired gains/losses; fixed D passes all seven original gates. No new training or independent/external generalization claim. Historical structural access and shared templates remain disclosed.

- [Full report](../../../../docs/research/2026-10-13-e1-complete-results.md), [next plan](../../../../docs/research/2026-10-13-post-e1-plan.md).
- [Review](review.json): all 96 episodes, 648 native generations, 48 pairs, 12 categories/4 bundles, per-call mappings/source decisions, tokens/timing and actual resource coverage.
- [Paired cases](paired-cases.csv), [original complete audit](independent-audit.json), [raw manifest](publication-manifest.json).
- [Genuine off-instance receipt](restore-receipt.json), [captured server events](server-events-latest.jsonl), [operations](operations.jsonl).
- [Raw resource samples](resources/server-stream.jsonl), [local observer events](resources/local-events.jsonl).
- [Separate user-confirmed power state](../e1-power-2026-10-13/user-confirmation.json); request/return files were not captured.

`publication-manifest.json` binds 41 original files byte-for-byte. The archive inventory has 28 files plus its own manifest; the public bundle also includes off-instance/operational evidence. Execution commit is `9e9387c1a4bac03b1363e38a379816cfe6cf3436` with 146 frozen sources.

The archive does **not** contain private adapter weights. Original frozen restoration and publication independently verified the actual external G4-control parent weight. Public reconstruction checks recorded model/native/environment/projection/inverse/token evidence and the original gates; it does not reload private weights or turn a metadata check into a newly complete restore. `collector_result.server_consumed` remains null; the original separately captured matching server receipt-consumed event supplies affirmative consumption evidence. Shutdown intention is not a command return.

From `research/liftcut-agent`, with its pinned tokenizer installed:

```powershell
& .venv/Scripts/python.exe analyze_e1_results.py --public-dir reports/e1-seed42-2026-10-13 --tokenizer-dir outputs/tokenizers/cdbee75f17c01a7cc42f958dc650907174af0554 --check
& E:/anaconda/python.exe plot_e1_results.py --public-dir reports/e1-seed42-2026-10-13
```

Figures are derived and visually inspected; they are not raw model evidence. GPU averages use only covered intervals, each sample held at most 5 seconds; gaps remain unknown. The observed maximum is not a true peak. Approximate ¥1.48 is elapsed time at the user-supplied hourly rate, not a provider invoice.
