# M4 G1 closed-output CPU diagnostic

**Decision: do not activate G1 in the product.** Constrained decoding removed
format errors in this diagnostic, but invented fields increased from 18 to 22.
The failed v2 candidate and its frozen release gates remain unchanged.

This is a post-hoc comparison on **already observed** inputs: 32 paired synthetic
challenge cases and all 60 old handwritten fixtures. [Selection](selection.json),
[protocol fixed before inference](protocol.json), and [results/hashes](summary.json)
record the evidence. This is not a new independent acceptance set.

| All 92 inputs | Free decoding | G1 grammar |
| --- | ---: | ---: |
| Exact resolved result | 78/92 | 82/92 |
| Valid label schema | 83/92 | 92/92 |
| Invented fields | 18 | 22 |
| Truncated answers | 0 | 0 |
| CPU latency p50 / p95 | 800 / 2173 ms | 964 / 3069 ms |
| Source-v2 correctly accepted actions | 46/55 | 47/55 |
| Source-v2 unsafe accepted actions | 0 | 0 |

Four previously wrong results became correct; no previously correct result
regressed. This does **not** mean there were no semantic regressions: already
wrong results acquired more invented fields. For example, a repetitions-first
utterance still produced an additional set, and a correction without a unit
still acquired `kg`. Independent source-only rules accepted 54/55 actions and
scored 91/92 overall. The guarded model remains a subset of those rules; there
is no demonstrated incremental model benefit.

## What actually ran

- Saved v2 Q8 hash `8bf93ecba63db99c8853899b8a344200951008fbd0584af530509e0871f3d904`,
  identical short prompt/token IDs, greedy 256-token output, context 1024,
  four decode/prefill threads, CPU only, reset between examples.
- Arm order alternated by input. 184 inferences completed in 242.04 seconds
  including startup/hash checks; free-arm parsed outputs reproduced the prior
  short-prompt diagnostic on all 92 rows. No retry after observing quality.
- Native token-mask/EOS checks accepted 11 valid labels, rejected 18 invalid
  labels, and deliberately accepted one structurally valid numeric-role error.
  These boundary checks perform no model inference.
- An initial attempt stopped before inference because the counterexample fixture
  escaped Chinese names instead of using canonical literal names. Serialization
  was corrected; the grammar was unchanged. The failed attempt is retained.
- The published CLI then ran two inputs per arm: four additional CPU inferences,
  each matching the corresponding paired output, for **188 total** new calls.
  Three dependency-free input/grammar tests passed on Windows and WSL Linux.

These are local CPU timings, not phone, network or GPU measurements. Raw files
and logs are retained in the local delivery archive; their SHA-256 values are in
the summary. Published metrics can be reconstructed from those saved predictions
with the existing label evaluator and [source comparison](../../scripts/compare-source.ts).

## Reusable experimental path

[G1](../../train/closed_decode.py) uses llama.cpp's
[GBNF output constraints](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md):
six intents, ten clarify reasons, exercise-name enum/null, paired load/unit,
bounded counts/ranges and nonempty correction patches. It accepts a canonical
property order and bounded whitespace/numeric representation, not every equivalent
JSON serialization. It cannot establish whether a fact was said by the user.

Use the [CPU CLI](../../train/closed_predict.py) with an external hard timeout:

```sh
timeout --kill-after=10s 1800s python research/m4-parser/train/closed_predict.py \
  --gguf /path/parser-q8_0.gguf --tokenizer /path/tokenizer \
  --input /path/eval-input.jsonl --out /new/path/predictions.jsonl \
  --model-sha256 <verified-sha256> --mode G1 --max-seconds 1700
```

Use `--mode free` for the unconstrained comparator. The CLI checks runtime pins,
model hash, exact HF/GGUF token agreement, native boundaries and context length;
it rejects answer/history fields and existing output paths. Its internal deadline
is checked between examples, so the external timeout is required. It is a
per-arm reproduction tool; the original paired timing came from the separately
hashed alternating-arm runner. No product parser, write path or UI imports G1.

Next: [independent acceptance preparation](../../NEXT_ACCEPTANCE.md). Data v3 is
CPU-checked preparation, not a trained candidate. Server opening is not needed yet.

A later [20-scenario private pilot](user-pilot-summary.json) added 40 CPU calls,
with inputs/expected behavior frozen before inference. Both arms exactly parsed
2/6 representable literal requests; both guarded paths accepted 0/6. The other
14 tasks require contextual Agent handling; delegating them is not completion.
Grammar still confused quantity with target index. Only aggregates/hashes are
published; no training reuse. These supplied hypothetical scenarios have unverified
authorship, are now observed diagnostics, and do not prove continuous Agent behavior.
