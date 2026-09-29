# Identifier leakage correction and bounded diagnostic

Prepared before executing the diagnostic on 2026-09-29 UTC.

Review during the recovery-v1 GPU run found category names in agent-visible
record and memory IDs, including future approval outcomes (`pending`, `revoked`).
All 48 original fixtures contain such hints. The original preparation checks
missed this defect. Original results must remain archived but are contaminated
diagnostic observations, not reliable held-out or generalization evidence.

## Fixed intervention

Freeze `recovery-identifier-probe-v1`: replace only record and memory IDs with
opaque deterministic hashes. Preserve constraints, user behavior, splits,
terminal labels and every other field. Regression tests enforce that property.
Evaluate the same 24 dev/test cases using the original unadapted, clean-trained
and recovery-mixed models, with the same original rollout code and parameters.
No retraining or hyperparameter selection. The opaque train file is reserved
for a separately planned future corrected-training experiment.

This is post-hoc identifier robustness analysis on reused tasks, not a new test
set. The existing adapters were trained with hinted IDs. New IDs change
tokenization and scenario-digest-derived proposal IDs, so score differences
cannot isolate the causal effect of semantic hints alone. Compare paired
success, clean completion, blocked writes, errors, calls and replay integrity;
retain all failures and partial runs.

## Execution and budget

The original controller is intentionally paused while its last GPU child runs.
Independent shutdown guards remain active. The diagnostic supervisor waits for
that child, evaluates unadapted, clean and mixed in this fixed order, then always
resumes the original controller for audit, backup and shutdown. The diagnostic
stops by 2026-09-29 01:29:52 UTC, reserving ten minutes for those steps. The hard
cutoff remains 01:39:52 UTC, two hours from observed container start. At the
user-supplied CNY 2.18/hour, two hours of compute is CNY 4.36; provider billing
and storage charges are not independently reconciled. No extension or disk
expansion is authorized by this diagnostic.

## Next evidence gate

Before a new server window, audit all model-visible fields for label leakage,
prepare opaque-ID training data, recompute token matching, and freeze a fresh
evaluation version whose labels are not encoded in context. Retrain both arms
from the same pinned base model. Shared authorship/templates and one training
seed still limit generalization claims even after the identifier defect is fixed.
