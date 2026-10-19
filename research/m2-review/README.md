# M2-5 post-workout review replay

Scores post-workout review answers (M2-3) offline, so CI can check review quality
without calling a paid model. Plan: [M2 split](../../docs/product/M2_SPLIT.md), M2-5.

- `src/cases.ts`: 48 synthetic cases, 8 of each kind. Each case has a three-exercise plan
  and the sets of the finished workout plus up to two earlier ones. The label comes from
  the kind alone and was written before any model answer existed (see the comment in the file).
  A change is warranted only for `all-easy` (direction up) and `repeated-misses` (direction down).
  `steady`, `one-bad-day`, `first-session` and `unknown-rpe` (every RPE null) warrant `nochange`.
  The data is synthetic; no real health records.
- `scripts/record.ts --name <name>`: one paid call per case. It uses the live prompt
  (`@liftcut/core/review-prompt`) and writes `recordings/<name>.jsonl`, keyed to the
  cases' hash.
- `scripts/evaluate.ts` (`npm run m2:review`): replays every recording and two fixed
  bounds, and writes `results/summary.json`. CI runs it with `--check`, so a changed
  generator, scorer or recording fails until its new summary is committed.

## Metrics (`@liftcut/core/eval/review-eval`)

| Metric | Meaning |
| --- | --- |
| `typeValid` | Answers that parse as the closed review schema |
| `evidenceReal` | Cited set ids that exist and belong to the cited exercise, out of all citations |
| `shown` | Answers that pass every check (`reviewProblems`) and would reach the user |
| `unwarrantedChanges` | Shown changes on a case that warrants none: the main failure ("changed when it should not") |
| `missedChanges` | Warranted cases with no shown change, counting invalid or missing answers |
| `wrongDirection` | Warranted cases where a shown sets/RPE change goes the other way |

## Current results

Only the two bounds exist. They are not models:
- `bound-always-nochange` misses all 16 warranted changes.
- `bound-always-add-set` makes 32 unwarranted changes and goes the wrong way on 8 cases.

They only show that the score separates the two failure modes. No real model has been
recorded yet (未运行): the DeepSeek key in this environment is refused with 401. Once a key
works, run `node --import tsx research/m2-review/scripts/record.ts --name deepseek-chat-v1`,
then `npm run m2:review`, and commit the recording with its summary.

Limitations: the labels are rules about synthetic patterns, not coaching judgments on real
users. Equipment is empty, so the replacement change type is not exercised. Answers are
recorded at temperature 0 and replayed, so a recording measures one model version at one time.
