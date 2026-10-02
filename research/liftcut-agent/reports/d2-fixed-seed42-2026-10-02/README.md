# Complete D2, fixed representative seed42

Real S0/T/M/TM inference at frozen execution commit
`3e4d8e208aecd86f05a7d3243942df6aefc2f73c`: 320 development episodes,
340 generations, zero additional training or held-out episodes.

- [run](run/) preserves the restored raw evidence and four early archives.
- [backup-index](backup-index.json) and [restore receipt](restore-receipt.json)
  are actual captured files; the receipt is the real restorer's off-instance file.
  Actual private adapter files were checked locally and are excluded here.
- [Client observations](operations.jsonl) distinguish atomic receipt publication
  from the subsequent connection loss. [Server observations](server-events.jsonl)
  stop before ACK consumption/shutdown. Provider billing is unconfirmed.
- [Independent review](review.json) contains per-case gains/losses, error action
  sequences, token checks, latency and cost proxies. It is derived evidence.
- [Chinese interpretation and next experiment](../../../../docs/research/2026-10-02-d2-complete-results.md).

Recreate D2 preparation with the pinned tokenizer, then verify publication without
private weights (CI mode, explicitly not a fresh actual-weight restore):

```sh
python research/liftcut-agent/prepare_counterfactual_diagnostics.py --output-dir research/liftcut-agent/outputs/d2-prepared --tokenizer-dir /path/to/pinned-tokenizer
python research/liftcut-agent/analyze_d2_results.py --public-dir research/liftcut-agent/reports/d2-fixed-seed42-2026-10-02 --prepared-dir research/liftcut-agent/outputs/d2-prepared --tokenizer-dir /path/to/pinned-tokenizer --metadata-only --check
```

With the original local adapters, replace `--metadata-only` with
`--adapters-root /path/to/original/seed42/training` for an actual-weight recheck.
The full run archive SHA256 is
`f97d45e6dfaa22f52c1df65c14a30f960d69ef1bc413134e191f68dcfbf881e8`;
genuine receipt SHA256 is
`0b02f493f69bbb0a6f5d00fba9c5d49e69030b557e8d7db16296caffdfead115`.

Memory/ID/consent use the first model response; repair/infeasible use complete
continuations. Do not pool them as task accuracy. Reused synthetic development
states, one fixed seed, no independent generalization or three-seed D2 claim.
G1's original behavior trigger is met; new paired training is not a D2 result.
