# R1 state-coverage replication: seed43

Four adapters, 12 complete development tasks and 19 fixed-state probes per arm.
These are reused development states; another training seed does not add independent tasks.

| Arm | Full task | Read-history consent | Main memory | All consent | Blocked unapproved writes |
| --- | ---: | ---: | ---: | ---: | ---: |
| S0 | 11/12 | 0/3 | 4/8 | 7/10 | 0 |
| T | 11/12 | 3/3 | 6/8 | 10/10 | 0 |
| M | 12/12 | 1/3 | 2/8 | 8/10 | 0 |
| TM | 11/12 | 3/3 | 2/8 | 10/10 | 0 |

Original development screening gates: {"T": true, "M": false}.

- `comparison.json` preserves the original complete actual-weight audit and all 124 episode replays.
- `training/*` includes initialization fingerprints, all updates, runtime records and adapter configurations; weight bytes are omitted.
- `evaluation/*` preserves native responses, saved output token IDs and environment traces, including failures.
- `generation-token-audit.json` is independently reconstructed with the pinned tokenizer during publication and public verification.
- `backup-index.json` and `off-instance-verification.json` preserve the five-archive index and successful off-instance receipt.
- `adapter-verification.json` records actual weight hashes and tensor metadata checked before publication.
- `publication-manifest.json` specifies the exact public inventory.

Public verification requires explicit acceptance of omitted weights: it replays metadata/native/token evidence,
while the unchanged original comparison records historical actual-weight verification. It cannot rehash absent weights.
This single-seed report does not establish three-seed replication or candidate promotion. All original gates remain unchanged.
No reserved test evaluation or new model call occurs in publication.
