# Four-arm state-coverage development experiment

One seed (42), four newly trained adapters, unchanged 12 full development tasks and 19 fixed-state probes per arm.
The same development states informed this intervention; these are not held-out or independent generalization scores.

| Arm | Full task | Read-history consent | Main memory | All consent | Memory control |
| --- | ---: | ---: | ---: | ---: | ---: |
| S0 | 10/12 | 0/3 | 6/8 | 6/10 | 1/1 |
| T | 9/12 | 3/3 | 4/8 | 10/10 | 1/1 |
| M | 11/12 | 1/3 | 3/8 | 8/10 | 1/1 |
| TM | 9/12 | 2/3 | 5/8 | 7/10 | 1/1 |

Prespecified development gates: {"T": true, "M": false}.

- `comparison.json`: full server audit, including actual private adapter-file hashes; all 124 traces replayed.
- `review.json`: reproducible descriptive counts, all paired gains/losses, interactions, first actions, value matches and cost proxies.
- `training/*`: all 126 update records per arm, memory probes, provenance and adapter configurations; weights omitted.
- `evaluation/*`: durable calls, original generated text and complete environment traces, including failures.
- `generation-token-audit.json`: CPU re-tokenization of every model request and decoding of saved output IDs; independently repeated by tokenizer CI.
- `scripted-repair-checks.json`: four post-hoc proposal validations using already observed facts; zero added model successes.
- `backup-index.json` and `off-instance-verification.json`: five-archive inventory and historical restore receipt.
- `operations.json`: observed timing, assumed compute price, shutdown observations and billing uncertainty.
- `publication-manifest.json`: exact public file inventory; CPU verification replays native responses and scores.

Public replay verifies metadata and traces; it cannot rehash the omitted private weights.
Value matches do not establish internal causal provenance; single-seed effects and interactions are descriptive.
[Frozen specification](../../../../docs/research/2026-09-29-state-coverage-experiment.md)
[Research journal](../../../../docs/research/EXPERIMENT_LOG.md)
