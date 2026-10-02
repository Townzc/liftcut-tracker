# G1 paired pilot, fixed seed42 — original gate FAIL

Two fresh paired QLoRA runs on the pinned Qwen3-4B base at execution commit
`29d8d7fc6d1e749a85d93979da3b589d063f5c0d`. Each arm: 126 updates, 41,788 supervised
tokens. 222 evaluations on 111 reused development cases, 384 actual model
generations and one local context refusal. No hosted API or reserved test usage.

Repair improves 1/4→3/4, but full tasks regress 9/12→2/12 and true infeasible 4/4→2/4.
The predeclared gate fails; no G1 seeds43/44 or G2 are started. No adapter promotion,
independent generalization claim or three-seed G1 result.

- [run](run/) contains byte-preserved original records and inventories. Only the
  two private adapter weight files are omitted; their hashes remain in inventories.
- [Original index](backup-index.json), [genuine restoration receipt](restore-receipt.json),
  [client observations](operations.jsonl) and [last server observations](server-events.jsonl)
  are captured evidence. The archived [run events](run/events.jsonl) include the
  later evaluation/audit completion while the collector was downloading weights.
- [publication.json](publication.json) binds every copied original file; it is not
  a new backup ACK. Local publication checked both actual weights and replayed all
  native/environment episodes and generated tokens using the frozen auditor.
- [review.json](review.json) preserves paired gains/losses, training/resources,
  continuation actions, memory position/identity and the original protection gates.
- [context-review.json](context-review.json) is a post-hoc CPU audit: all64 clean
  first-validation targets moved behind error feedback; clean search retains only
  four infeasible targets. Eight full tasks falsely stop before validation. This
  is a supported conditioning-coverage hypothesis, not a causal intervention.
- [Operator status](operator-status.json) records the later user confirmation that
  the platform is off. It does not change raw ACK-consumption/shutdown observations.
  Compute estimate CNY2.9962 uses observed duration×2.18/hour, excludes storage and
  is not an invoice. Do not repeatedly request a bill to replace this estimate.
- [Chinese review](../../../../docs/research/2026-10-02-g1-complete-results.md),
  [next local plan](../../../../docs/research/2026-10-02-post-g1-release-plan.md)
  and [figures](figures/) give interpretation and limitations.

## CPU reproduction

Use `requirements-tokenizer.txt` and the pinned tokenizer revision
`cdbee75f17c01a7cc42f958dc650907174af0554`; set `PYTHONPATH=research/liftcut-agent/src`.
The repository CI reproduces preparation twice and performs all following checks.
From the repository root, with a fresh output directory and a local pinned tokenizer:

```sh
python research/liftcut-agent/prepare_g1.py --output-dir research/liftcut-agent/outputs/g1-reproduce --tokenizer-dir /path/to/pinned-tokenizer
python research/liftcut-agent/prepare_state_diagnostics.py --output-dir research/liftcut-agent/outputs/g1-diagnostics --tokenizer-dir /path/to/pinned-tokenizer
python research/liftcut-agent/prepare_counterfactual_diagnostics.py --output-dir research/liftcut-agent/outputs/g1-d2 --tokenizer-dir /path/to/pinned-tokenizer
python research/liftcut-agent/analyze_g1_results.py --public-dir research/liftcut-agent/reports/g1-seed42-2026-10-02 --prepared-dir research/liftcut-agent/outputs/g1-reproduce --diagnostic-dir research/liftcut-agent/outputs/g1-diagnostics --d2-dir research/liftcut-agent/outputs/g1-d2 --tokenizer-dir /path/to/pinned-tokenizer --check
python research/liftcut-agent/analyze_g1_contexts.py --public-dir research/liftcut-agent/reports/g1-seed42-2026-10-02 --prepared-dir research/liftcut-agent/outputs/g1-reproduce --check
```

Without `--restored-run`, the first analyzer explicitly performs metadata/native/
token checks, not a new actual-weight restore. With the complete private recovered
run, add `--restored-run /path/to/restored/run` to also recheck actual weights.
Neither analysis command makes model calls, uploads receipts or opens reserved tasks.

Genuine receipt SHA256:
`18ea4e22fc3cc2699b923c6ba202e775ed33ef06d6490e73b8c28deb6de74fba`.
The matched initial-adapter digest is
`f403d9a13af8b10692e99c94c32fdccf193f1b23bcf373ab1812e17d2042ad04`.
Control final weights repeat the historical same-seed T digest; actual new training
was executed. This is a repeatability observation, not another independent seed.
