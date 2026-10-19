import assert from "node:assert/strict";
import { test } from "node:test";
import type { AiTrainingPlan } from "@liftcut/core/ai-schemas";
import { applyReview, reviewProblems, reviewSchema, type Review } from "@liftcut/core/review-changes";

const exercise = (name: string, sets: number, rep_range: string, target_rpe = 8) =>
  ({ name, sets, rep_range, target_rpe, rest_seconds: 120, notes: "", alternative_exercises: [] });
const plan: AiTrainingPlan = { plan_name: "P", goal_type: "muscle_gain", summary: "s", reasoning_summary: "", warnings: [],
  weeks: [1, 2].map(week_number => ({ week_number, focus: "", days: [{ day_number: 1, title: "A", notes: "", estimated_duration_minutes: 60,
    exercises: [exercise("杠铃卧推", 3, "5"), exercise("哑铃弯举", 3, "8-12", 9.5)] }] })) };
const cited = { sets: new Map([["s1", "杠铃卧推"], ["s2", "杠铃卧推"], ["s3", "哑铃弯举"]]), equipment: ["dumbbells", "bench", "barbell", "rack"] as const };
const review = (changes: unknown) => reviewSchema.parse({ outcome: "changes", changes }) as Extract<Review, { outcome: "changes" }>;
const c = (type: string, extra: object, name = "杠铃卧推", evidence = ["s1"]) => ({ type, exercise: name, why: "最近两次都完成了", evidence, ...extra });

test("only the closed change types parse; unknown types, raw loads and extra fields are rejected", () => {
  for (const ok of [c("adjust_sets", { delta: 1 }), c("adjust_rpe", { delta: -0.5 }), c("switch_rule", { to: "double" }), c("replace_exercise", { replacement: "dumbbell-bench" })])
    assert.ok(reviewSchema.safeParse({ outcome: "changes", changes: [ok] }).success, JSON.stringify(ok));
  for (const bad of [c("set_weight", { weightKg: 62.5 }), c("adjust_sets", { delta: 2 }), c("adjust_rpe", { delta: 1 }), c("adjust_sets", { delta: 1, weightKg: 60 }),
    c("adjust_sets", { delta: 1 }, "杠铃卧推", [])])
    assert.equal(reviewSchema.safeParse({ outcome: "changes", changes: [bad] }).success, false, JSON.stringify(bad));
  assert.ok(reviewSchema.safeParse({ outcome: "nochange", why: "按计划进行", evidence: [] }).success);
});

test("changes apply to every occurrence; the engine-facing numbers are computed, not chosen by the model", () => {
  const next = applyReview(plan, review([c("adjust_sets", { delta: 1 }), c("switch_rule", { to: "double" }),
    c("adjust_rpe", { delta: -0.5 }, "哑铃弯举", ["s3"])]).changes);
  for (const week of next.weeks) {
    assert.deepEqual([week.days[0].exercises[0].sets, week.days[0].exercises[0].rep_range], [4, "5-8"]);
    assert.equal(week.days[0].exercises[1].target_rpe, 9);
  }
  assert.equal(plan.weeks[0].days[0].exercises[0].sets, 3); // The input plan is untouched.
  assert.equal(applyReview(plan, [c("switch_rule", { to: "linear" }, "哑铃弯举") as never]).weeks[1].days[0].exercises[1].rep_range, "8");
  assert.equal(applyReview(plan, [c("replace_exercise", { replacement: "dumbbell-bench" }) as never]).weeks[0].days[0].exercises[0].name, "哑铃卧推");
});

test("a review must cite saved sets of the same exercise and stay within bounds, candidates and one change per type", () => {
  assert.deepEqual(reviewProblems(plan, review([c("adjust_sets", { delta: 1 }, "杠铃卧推", ["s1", "s2"])]), cited), []);
  assert.deepEqual(reviewProblems(plan, review([c("adjust_sets", { delta: 1 }, "杠铃卧推", ["nope"])]), cited), ["evidence_missing:nope"]);
  assert.deepEqual(reviewProblems(plan, review([c("adjust_sets", { delta: 1 }, "杠铃卧推", ["s3"])]), cited), ["evidence_other_exercise:s3"]);
  assert.deepEqual(reviewProblems(plan, review([c("adjust_sets", { delta: 1 }, "深蹲")]), cited), ["evidence_other_exercise:s1", "exercise_not_in_plan:深蹲"]);
  assert.deepEqual(reviewProblems(plan, review([c("switch_rule", { to: "linear" })]), cited), ["rule_unchanged:杠铃卧推"]);
  assert.deepEqual(reviewProblems(plan, review([c("adjust_rpe", { delta: 0.5 }, "哑铃弯举", ["s3"]), c("adjust_rpe", { delta: 0.5 }, "哑铃弯举", ["s3"])]), cited),
    ["conflicting_changes:哑铃弯举"]);
  const hard = applyReview(plan, [c("adjust_rpe", { delta: 0.5 }, "哑铃弯举") as never]); // Now at RPE 10.
  assert.deepEqual(reviewProblems(hard, review([c("adjust_rpe", { delta: 0.5 }, "哑铃弯举", ["s3"])]), cited), ["rpe_out_of_range:哑铃弯举"]);
  assert.deepEqual(reviewProblems(plan, review([c("adjust_sets", { delta: -1 }, "杠铃卧推")]), cited), []);
  const single = applyReview(plan, [c("adjust_sets", { delta: -1 }) as never, c("adjust_sets", { delta: -1 }) as never]); // One set left.
  assert.deepEqual(reviewProblems(single, review([c("adjust_sets", { delta: -1 })]), cited), ["sets_out_of_range:杠铃卧推"]);
  assert.deepEqual(reviewProblems(plan, review([c("replace_exercise", { replacement: "dumbbell-bench" }), c("adjust_sets", { delta: -1 })]), cited),
    ["conflicting_changes:杠铃卧推"]);
  assert.deepEqual(reviewProblems(plan, review([c("replace_exercise", { replacement: "barbell-squat" })]), cited), ["replacement_not_allowed:杠铃卧推"]);
  assert.deepEqual(reviewProblems(plan, review([c("replace_exercise", { replacement: "dumbbell-bench" })]), { ...cited, equipment: ["barbell"] }),
    ["replacement_not_allowed:杠铃卧推"]);
  assert.deepEqual(reviewProblems(plan, reviewSchema.parse({ outcome: "nochange", why: "稳定", evidence: ["s9"] }), cited), ["evidence_missing:s9"]);
});
