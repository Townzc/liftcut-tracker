# V7 prompt-alignment preparation (CPU only)

This is an executable experiment package, **not a new model result**. V6 remains
below threshold. The [design and primary sources](../../train/DATA_V7.md),
[fixed protocol](../../train/protocol-v7.json) and [runbook](../../train/GPU_V7.md)
isolate one factor: train/dev system instructions use the existing inference
enumeration. All 6,400 v6 T sentences, labels, catalogs and order remain fixed.
No private originals, paraphrases, numeric variants, outputs or derivatives are
used. Training examples and outputs are not authored from observed failures.

| Actual CPU verification | Evidence and limit |
| --- | --- |
| Full training/dev token and mask audit | [Receipt](cpu-smoke.json); 6,400 rows per training arm and 740 per dev variant, longest aligned examples 348/347 of 512, no truncation |
| Tokenizer equivalence | Same original T train/dev and 1,040 frozen inference token IDs; saved tokenizer serialization differs from the original base files |
| Two-step train/export smoke | Twelve training/six dev rows, saved v1 merged weights, finite updated adapter/merged export and cache enabled; not original-base training or accuracy |
| Full artifact recovery | [Receipt](artifact-restore.json); four historical weights and five 1,040-row historical streams, 24 full archive parts, every restored hash matched |
| Control assembly and score replay | [Receipt](assembly-replay.json); 14 historical input/model/provenance files verified, 27 score objects match saved H/T results; S is a T clone for wiring only |
| Action binding attribution | [Receipt](binding-replay.json); separates resolved-equal names from different available actions without changing scores |

The runner's CPU fault checks cover changed cached inputs, IDs, tokens, training
metrics, source/gate invariance, exactly one training/three streams, timeout and
insufficient space. Backup faults include corrupt/missing artifacts, wrong
window/deadline, partial runs, unsafe paths and full/staged round trips.
Full and incremental **final-commit** source restoration and all exact-head CI
must also pass before an opening notice; operational receipts are retained locally.

The next GPU window has one original-base S training and 3,120 new predictions
(HF/F16/Q8), with 2,080 archived H/T outputs kept separate. Cached controls
cannot establish a speed gain, and these observed development sets cannot prove
independent generalization. Longer prompted dev loss is not a comparable
selection metric. Training, numeric gates, greedy decoding and source-grounding
stay fixed. Live 10 GiB free includes a full archive duplicate and reserves.

No v7 GPU run or model acceptance has occurred. A development pass still leads
to candidate continuous acceptance, useful coverage, native integration and
physical-device validation before activation. UI and confirmation flows remain
unchanged. Future failure analysis uses saved outputs, not automatic extra
training, relaxed gates or private acceptance derivatives.
