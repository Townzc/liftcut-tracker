import assert from "node:assert/strict";
import test from "node:test";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";
import { diagnose } from "../research/m4-parser/scripts/diagnose";

const item: EvalItem = { id: "one", family: "synthetic", language: "zh", text: "卧推 60kg 8次",
  context: { exercises: ["卧推"], selected: "卧推", done: 0, setCount: 3 },
  label: { intent: "record", exercise: "卧推", sets: [{ weight: 60, unit: "kg", reps: 8, rpe: null }] } };
const prediction = (output: unknown, id = "one") => ({ id, output: JSON.stringify(output) });

test("diagnosis rejects partial, duplicate and extra IDs rather than hiding missing predictions", () => {
  const p = prediction(item.label);
  for (const [gold, preds] of [[[item], []], [[item], [p, p]], [[item, item], [p]],
    [[item], [prediction(item.label, "other")]], [[{ ...item, id: "" }], [prediction(item.label, "")]], [[], []]] as const) {
    assert.throws(() => diagnose([...gold], [...preds]), /IDs/);
  }
});

test("invalid reason, missing symbolic target and malformed JSON stay invalid", () => {
  const gold: EvalItem[] = [
    { ...item, label: { intent: "clarify", reason: "plan_not_actual" } },
    { ...item, id: "two", label: { intent: "skip", exercise: null, target: "next" } },
    { ...item, id: "three" },
  ];
  const report = diagnose(gold, [prediction({ intent: "clarify", reason: "target_not_actual" }),
    prediction({ intent: "skip", exercise: null, target: null }, "two"), { id: "three", output: "{broken" }]);
  assert.equal(report.resolvedExact, 0);
  assert.equal(report.counts.unsupported_clarify_reason, 1);
  assert.equal(report.counts.missing_target, 1);
  assert.equal(report.counts.invalid_schema, 2);
  assert.equal(report.counts.invalid_json, 1);
});

test("extra sets are separate from invented-field counts, with no automatic repair", () => {
  assert.equal(item.label.intent, "record");
  const bad = { ...item.label, sets: [item.label.sets[0], { ...item.label.sets[0], reps: 7 }] };
  const report = diagnose([item], [prediction(bad)]);
  assert.equal(report.counts.extra_sets, 1);
  assert.equal(report.counts.resolved_answer_differs, 1);
  assert.equal(report.counts.invalid_schema, undefined);
  assert.equal(report.resolvedExact, 0);
  assert.equal(bad.sets.length, 2);
  assert.deepEqual(report.oracleGuard, { actionable: 1, acceptedGold: 1, rejectedGold: 0 });
});

test("resolved equality does not conceal literal reason or exercise differences", () => {
  const gold = [item, { ...item, id: "two", label: { intent: "clarify" as const, reason: "missing_unit" as const } }];
  const report = diagnose(gold, [prediction({ ...item.label, exercise: null }),
    prediction({ intent: "clarify", reason: "missing_reps" }, "two")]);
  assert.equal(report.resolvedExact, 2);
  assert.equal(report.literalExact, 0);
  assert.equal(report.counts.literal_exercise_differs, 1);
  assert.equal(report.counts.literal_label_differs, 2);
  assert.equal(report.counts.resolved_answer_differs, undefined);
});
