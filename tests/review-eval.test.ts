import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreReviews, type ReviewCase } from "@liftcut/core/eval/review-eval";
import { buildCases, KINDS, PER_KIND } from "../research/m2-review/src/cases";

const cases = buildCases();
const easy = cases.find(c => c.kind === "all-easy")!, steady = cases.find(c => c.kind === "steady")!;
const cite = (c: ReviewCase, exercise: string) => c.sets.filter(s => s.exercise === exercise).slice(0, 3).map(s => s.id);
const change = (c: ReviewCase, delta: 1 | -1, evidence = cite(c, c.plan.weeks[0].days[0].exercises[0].name)) =>
  ({ outcome: "changes", changes: [{ type: "adjust_sets", exercise: c.plan.weeks[0].days[0].exercises[0].name, delta, why: "x", evidence }] });

test("the synthetic cases are deterministic, labelled by kind and keep unknown values null", () => {
  assert.deepEqual(buildCases(), cases);
  assert.equal(cases.length, KINDS.length * PER_KIND);
  assert.deepEqual(cases.filter(c => c.expect.change).map(c => c.kind), [...Array(PER_KIND).fill("all-easy"), ...Array(PER_KIND).fill("repeated-misses")]);
  assert.ok(cases.filter(c => c.kind === "unknown-rpe").every(c => c.sets.every(s => s.rpe === null)));
  assert.ok(cases.every(c => c.sets.every(s => s.exercise !== "俯卧撑" || s.weightKg === null)));
  assert.ok(cases.filter(c => c.kind === "first-session").every(c => new Set(c.sets.map(s => s.date)).size === 1));
});

test("the replay score separates unwarranted, missed and wrong-direction changes from invented evidence", () => {
  const score = (answers: [ReviewCase, unknown][]) => scoreReviews([easy, steady], new Map(answers.map(([c, a]) => [c.id, a])));
  assert.deepEqual(score([[easy, change(easy, 1)], [steady, { outcome: "nochange", why: "稳定", evidence: [steady.sets[0].id] }]]),
    { cases: 2, answered: 2, typeValid: 2, evidenceReal: 1, shown: 2, unwarrantedChanges: 0, missedChanges: 0, wrongDirection: 0, problems: {} });
  const bad = score([[easy, change(easy, -1)], [steady, change(steady, 1)]]);
  assert.deepEqual([bad.unwarrantedChanges, bad.wrongDirection, bad.missedChanges], [1, 1, 0]);
  const invented = score([[easy, change(easy, 1, ["not-a-set"])], [steady, "not json"]]);
  assert.deepEqual([invented.typeValid, invented.evidenceReal, invented.shown, invented.missedChanges, invented.problems], [1, 0, 0, 1, { evidence_missing: 1 }]);
  assert.deepEqual([score([]).answered, score([]).missedChanges], [0, 1]); // A missing answer is a miss, never a pass.
});
