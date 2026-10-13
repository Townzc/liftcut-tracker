# I2 seed42 actual four-arm evidence

Fixed weights, candidate D chosen before inference. Fresh A/B/C/D score99/105/111/111 on the same111 development states, including first decisions. D passes the original mechanism and fixed-S0 candidate gates. No new training, independent generalization or product deployment claim;48 reserved tasks unused.

`publication.json` binds138 original published files by SHA256. `run/` contains all actual metadata and traces; only the private adapter weight is omitted. That weight was actually restored and reverified locally. `review.json` reconstructs all111 paired rows on five comparison edges, actual token usage and overlapping cost windows. `failure-localization.json` localizes source choices and native/output-token ID sensitivity. `figures/` was rendered and visually checked.

The original controller stopped its ACK wait after20minutes and recorded **false**. A genuine complete receipt was generated after frozen restoration of124 files/444 replays/754 real generations, then atomically published within the original collection deadline. `receipt-inspection/` records a separate read-only server verification of that exact existing receipt and actual weight, also within the original deadline. It does not modify the false status, create an ACK, reset time or restart any computation. Preserve both facts.

Reproduce public evidence with the pinned tokenizer and freshly prepared development inputs:

```text
python analyze_i2_results.py --public-dir reports/i2-seed42-2026-10-13 --diagnostic-dir outputs/state-diagnostic-v1 --d2-dir outputs/d2-prepared-a --tokenizer-dir <pinned-tokenizer-directory> --check
python analyze_i2_failures.py --public-dir reports/i2-seed42-2026-10-13 --check
```

Public reconstruction explicitly does not reload private weights. Supplying `--restored-run` to the reviewer additionally verifies actual local adapter bytes. No model/API call is performed by either command. Derived JSON/figures/this README are separate from the immutable original-file inventory.

See [Chinese detailed analysis](../../../../docs/research/2026-10-13-i2-complete-results.md) and [next conditional study](../../../../docs/research/2026-10-13-post-i2-plan.md).
