import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLabel, resolveOutput, resolveRuleResult, ruleContext, scoreParses, type EvalItem } from "@liftcut/core/eval/parse-label-eval";
import type { ParseLabel } from "@liftcut/core/parse-label";
import { parseWorkoutLog } from "@liftcut/core/workout-log-parser";
import { buildAll, readHandwritten } from "../research/m4-parser/scripts/build-data";

const context = { exercises: ["杠铃卧推", "杠铃深蹲"], selected: "杠铃卧推", done: 2, setCount: 4 };
const set = (reps: number, weight: number | null = 60, rpe: number | null = null) => ({ weight, unit: weight === null ? null : "kg" as const, reps, rpe });
const item = (text: string, label: ParseLabel, family = "f"): EvalItem => ({ id: text, family, language: "zh", text, context, label });

test("labels resolve against the session; what does not fit becomes a clarification", () => {
  assert.deepEqual(resolveLabel({ intent: "record", exercise: null, sets: [set(5)] }, context), { intent: "record", exercise: "杠铃卧推", sets: [set(5)] });
  assert.deepEqual(resolveLabel({ intent: "record", exercise: null, sets: [set(5), set(5), set(5)] }, context), { intent: "clarify" });
  assert.deepEqual(resolveLabel({ intent: "record", exercise: "硬拉", sets: [set(5)] }, context), { intent: "clarify" });
  assert.deepEqual(resolveLabel({ intent: "record", exercise: null, sets: [set(5)] }, { ...context, selected: null }), { intent: "clarify" });
  assert.deepEqual(resolveLabel({ intent: "correct", exercise: null, target: "last", changes: { reps: 4 } }, context),
    { intent: "correct", exercise: "杠铃卧推", setIndex: 2, changes: { reps: 4 } });
  assert.deepEqual(resolveLabel({ intent: "correct", exercise: null, target: 3, changes: { reps: 4 } }, context), { intent: "clarify" });
  assert.deepEqual(resolveLabel({ intent: "skip", exercise: null, target: "next" }, context), { intent: "skip", exercise: "杠铃卧推", setIndex: 3 });
  assert.deepEqual(resolveLabel({ intent: "skip", exercise: null, target: "last" }, context), { intent: "skip", exercise: "杠铃卧推", setIndex: 4 });
  assert.deepEqual(resolveLabel({ intent: "skip", exercise: null, target: 2 }, context), { intent: "clarify" });
  assert.deepEqual(resolveLabel({ intent: "repeat", exercise: null, count: 2 }, { ...context, done: 0 }), { intent: "clarify" });
});

test("model text: code fences are tolerated; invalid JSON and schema violations are counted, never repaired", () => {
  const label = JSON.stringify({ intent: "skip", exercise: null, target: "next" });
  assert.deepEqual(resolveOutput("```json\n" + label + "\n```", context), { json: true, schema: true, resolved: { intent: "skip", exercise: "杠铃卧推", setIndex: 3 } });
  assert.deepEqual(resolveOutput("skip next", context), { json: false, schema: false, resolved: null });
  assert.deepEqual(resolveOutput(JSON.stringify({ intent: "record", exercise: null, sets: [{ weight: 60, unit: null, reps: 5, rpe: null }] }), context),
    { json: true, schema: false, resolved: null });
});

test("scores: an invented RPE, an omitted weight, a wrong correction target and clarification precision/recall", () => {
  const rows = [
    { item: item("卧推 60 公斤 5 个", { intent: "record", exercise: null, sets: [set(5)] }), pred: { intent: "record" as const, exercise: "杠铃卧推", sets: [set(5, 60, 8)] } },
    { item: item("卧推 60 公斤 6 个", { intent: "record", exercise: null, sets: [set(6)] }), pred: { intent: "record" as const, exercise: "杠铃卧推", sets: [set(6, null)] } },
    { item: item("最后一组改成 4 个", { intent: "correct", exercise: null, target: "last", changes: { reps: 4 } }), pred: { intent: "correct" as const, exercise: "杠铃卧推", setIndex: 1, changes: { reps: 4 } } },
    { item: item("大概 60 公斤", { intent: "clarify", reason: "uncertain_quantity" }), pred: { intent: "record" as const, exercise: "杠铃卧推", sets: [set(5)] } },
    { item: item("练完了", { intent: "end" }), pred: { intent: "clarify" as const } },
    { item: item("卧推 60 8", { intent: "clarify", reason: "missing_unit" }), pred: { intent: "clarify" as const } },
  ];
  const s = scoreParses(rows);
  assert.equal(s.exact, 1);
  assert.equal(s.invented, 1 + 3); // The RPE, plus the weight, unit and reps given where it should have asked.
  assert.equal(s.omissionRate, 0.25); // Weight and unit missing of eight stated values (weight, unit, reps ×2; set, reps).
  assert.equal(s.correctionLocalization, 0);
  assert.deepEqual([s.clarifyPrecision, s.clarifyRecall], [0.5, 0.5]);
  assert.equal(s.jsonValidRate, null);
  const perfect = scoreParses(rows.map(r => ({ item: r.item, pred: resolveLabel(r.item.label, r.item.context), json: true, schema: true })));
  assert.deepEqual([perfect.exactRate, perfect.fieldAccuracy, perfect.invented, perfect.omissionRate, perfect.jsonValidRate], [1, 1, 0, 0, 1]);
});

test("every dataset label resolves to its own intent in its session, so gold answers are reachable", () => {
  const { files } = buildAll();
  const items: EvalItem[] = [...Object.values(files).flatMap(f => f.trim().split("\n").map(line => JSON.parse(line))), ...readHandwritten()];
  for (const i of items) assert.equal(resolveLabel(i.label, i.context).intent, i.label.intent, `${i.id} ${i.text}`);
});

test("the rule parser runs on the same sessions and its drafts resolve like labels", () => {
  const result = parseWorkoutLog("杠铃卧推 60kg 5个", ruleContext(context));
  assert.deepEqual(resolveRuleResult(result), { intent: "record", exercise: "杠铃卧推", sets: [set(5)] });
  assert.deepEqual(resolveRuleResult(parseWorkoutLog("bench press 8 reps", ruleContext(context))), { intent: "record", exercise: "杠铃卧推", sets: [set(8, null)] });
  assert.deepEqual(resolveRuleResult(parseWorkoutLog("更正第2组改成4个", ruleContext(context))), { intent: "correct", exercise: "杠铃卧推", setIndex: 2, changes: { reps: 4 } });
});
