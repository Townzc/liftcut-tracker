# Comparable M4 inference

`predict.py` now checks nonempty, unique evaluation IDs and answer-free inputs;
it rejects context overflow instead of truncating. HF and GGUF use identical
token IDs without an added BOS, explicit greedy/repetition settings, and one
example per fresh KV state. Both CPU thread counts are bounded. Each prediction
records stop/length and token usage; the sidecar binds input bytes and token IDs.
Outputs are exclusive-create, including the audit, to preserve failed attempts.

Validation: 12 Linux process/inference regressions passed. Real CPU inference on
two existing development examples completed with both the saved HF and Q4
weights, matching input IDs and parsed outputs (2/2, no truncation). This is a
runtime smoke, not a quality or performance benchmark; no GPU was opened.

`compare_gguf.py` is the exact frozen script for the ongoing full 1,060-item CPU
diagnostic. It compares the saved f16 and Q4 in one llama.cpp runtime against the
saved HF predictions. A Q8 fallback is predeclared if Q4 is below 95% against
either reference. No weight training or download occurs. External GNU timeout
bounds the run; weights and raw outputs stay outside Git. The protocol records
script/input/weight hashes before inference. These are previously seen cases.

Its canonical-JSON diagnostic is stricter than the original `consistency.py`
gate for numeric spelling (`1` versus `1.0`). Report both explicitly; never
replace the original 95% parsed-JSON gate with guarded outputs. Full results
are pending, so this change makes no new consistency/quality claim. Different
threads, token-input handling and reset behavior changed together; an observed
difference cannot establish which one caused it. Neither tool enables writes
or changes the confirmation flow. Phone measurements remain separate.
