# Why challenge accuracy fell from 213 to 180

The maintainer's recollection is correct: the recorded v2 Q8 challenge score was
**213/240 (88.75%)**. V7 Q8 is **180/240 (75.00%)**. The gold JSONL is byte-identical
across the seven archived arms below, SHA-256
`ff192acd18f707960c2fa800e8a962350260c2619ee20bbdd1f7e0d87db9ad08`.
This is a real regression on the same observed challenge, not a harder replacement.

[Machine-readable audit](history.json) binds original score failure IDs and saved
predictions to archive hashes. [Audit code](../../scripts/audit-history-v8.ts)
does not rerun inference or replace old scores with new scoring rules. Strict
clarification reasons and identity categories are separate retrospective diagnostics.

| Archived arm | Original exact /240 | Missing-unit reason /15 | RPE-scope reason /15 | Unknown-exercise reason /15 | Field-correct, wrong available identity |
| --- | ---: | ---: | ---: | ---: | ---: |
| v2 Q8 | 213 | 11 | 12 | 15 | 0 |
| v3 Q8 | 187 | 3 | 0 | 2 | 9 |
| v4 D | 206 | 10 | 0 | 15 | 7 |
| v5 S | 197 | 5 | 1 | 15 | 19 |
| v6 T | 195 | 4 | 0 | 15 | 9 |
| v6 S | 204 | 9 | 0 | 15 | 12 |
| v7 S | 180 | 3 | 0 | 15 | 21 |

For these three negative families, original resolved-exact and strict-reason counts
coincide. V2's advantage cannot be explained away as a looser reason-label score.
It still failed the release requirements: exact was below 90%, schema was 94.58%
and there were 50 unsupported fields. Restoring its score alone would not make a
safe candidate.

## What changed, and what the evidence supports

1. **V2 → v3 is the largest loss: 42 regressions, 16 gains, net −26.** V3 replaced
   the 2,400 contrastive training rows while retaining the 4,000-row base. Missing
   units and ambiguous RPE scope worsened sharply. The new limited surface frames
   and explicit uncertainty qualifiers are a plausible shortcut-learning cause,
   not a demonstrated mechanism. HF, F16 and Q8 all scored 187, so quantization
   does not explain this drop. V3 also changed the dev examples: the old 737/740
   and new 591/740 are not scores on the same dev population.
2. **V4 recovered to 206 without fixing RPE scope.** Boundary-pair and prompt
   changes improved units and unknown actions, but all 15 ambiguous-scope negatives
   still failed. A total-score recovery concealed an unresolved safety boundary.
3. **V5's sample-mean objective hurt this task.** The token-mean control reproduced
   v4's weights and all 1,040 outputs. The candidate fell to 197 (8 gains, 17 losses),
   with more identity errors and missing-unit records despite fixing illegal reasons
   and truncation. Better output formatting was not better semantic behavior.
4. **V6's changes had separate effects.** Repairing 40 alias-label conflicts under
   original catalogs produced T=195 versus historical v4 D=206 (6 gains, 17 losses).
   The catalog-augmentation S arm recovered to 204 versus T (21 gains, 12 losses),
   but RPE scope remained 0/15 and binding worsened. Correcting training labels is
   necessary for coherent supervision; it does not guarantee improved held-out scores.
5. **V7 isolated enum alignment and fell from its actual T control, 195 → 180.**
   The 17 regressions include 12 curl→bench substitutions, two missing-rep inputs
   turned into records, two wrong weight/rep outputs with correct RPE, and one guessed
   pound unit. There were only two gains. HF was already 185, F16 182 and Q8 180;
   the main error exists before quantization. Comparing 204→180 as if only prompt
   alignment changed would be incorrect: v6 S used different catalogs.

Across v2→v7, **53 items regressed, 20 improved, 160 stayed correct and seven stayed
wrong**. The 53 losses include 12 ambiguous-scope, ten missing-unit and ten
missing-rep negatives; the other 21 are useful positives. Thirteen of the 20 gains
are planned-not-actual negatives. The model learned some boundaries while losing
others; the aggregate score is insufficient to diagnose that tradeoff.

## Consequence for v8

The next question is whether an explicit schema/policy contract affects training,
inference, or their interaction. [V8](../../train/GPU_V8.md) varies these two factors
separately, retains the same 6,400 tuples and gates, and selects D before results.
It reports identity independently from numeric fields, strict reasons independently
from JSON validity, and useful positives alongside refusals. A longer prompt is a
hypothesis, not a promised fix; v2's earlier small diagnostic also showed that
adding instructions can hurt.

This is retrospective analysis of repeatedly observed development cases and one
seed per intervention. It does not establish generalization or isolate every
training mechanism. No failed-case rewrites or private 20-utterance originals or
derivatives become training examples. Independent continuous acceptance remains
after model gates.
