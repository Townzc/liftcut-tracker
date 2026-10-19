import assert from "node:assert/strict";
import { test } from "node:test";
import { labelTextProblems, numbersIn, parseLabelSchema, unitsIn, type ParseLabel } from "@liftcut/core/parse-label";

const set = (reps: number, weight: number | null = null, unit: "kg" | "lb" | null = weight === null ? null : "kg", rpe: number | null = null) =>
  ({ weight, unit, reps, rpe });

test("labels hold only stated values: weight and unit together, RPE in half steps, no extra keys", () => {
  for (const ok of [
    { intent: "record", exercise: "卧推", sets: [set(5, 60), set(5, 60, "kg", 8)] },
    { intent: "record", exercise: null, sets: [set(12)] },
    { intent: "repeat", exercise: null, count: 2 },
    { intent: "correct", exercise: null, target: "last", changes: { reps: 8 } },
    { intent: "correct", exercise: "深蹲", target: 2, changes: { weight: 135, unit: "lb" } },
    { intent: "skip", exercise: null, target: "next" },
    { intent: "end" },
    { intent: "clarify", reason: "uncertain_quantity" },
  ]) assert.ok(parseLabelSchema.safeParse(ok).success, JSON.stringify(ok));
  for (const bad of [
    { intent: "record", exercise: null, sets: [{ weight: 60, unit: null, reps: 5, rpe: null }] },
    { intent: "record", exercise: null, sets: [{ weight: null, unit: "kg", reps: 5, rpe: null }] },
    { intent: "record", exercise: null, sets: [set(5, 60, "kg", 8.3)] },
    { intent: "record", exercise: null, sets: [{ ...set(5), reps: null }] },
    { intent: "record", exercise: null, sets: [] },
    { intent: "record", exercise: null, sets: [{ ...set(5), setIndex: 1 }] },
    { intent: "correct", exercise: null, target: "last", changes: {} },
    { intent: "correct", exercise: null, target: "next", changes: { reps: 8 } },
    { intent: "correct", exercise: null, target: 2, changes: { weight: 60 } },
    { intent: "skip", exercise: null, target: 0 },
    { intent: "clarify", reason: "because" },
    { intent: "end", exercise: null },
  ]) assert.equal(parseLabelSchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test("numbers are read from digits, spoken Chinese, English words and ordinals; names and idioms are not numbers", () => {
  const cases: [string, number[]][] = [
    ["卧推 60 公斤 5、5，最后一组 RPE 8", [60, 5, 5, 8]], ["六十五公斤 八个", [65, 8]], ["一百二十五磅三下", [125, 3]],
    ["一百二", [120]], ["二百千克", [200]], ["二十八千克九个", [28, 9]], ["一百零五", [105]], ["两百五", [250]], ["RPE 七点五", [7.5]], ["第二组其实是8个", [2, 8]],
    ["bench sixty-five kilos for eight reps", [65, 8]], ["one hundred and twenty five pounds", [125]], ["a hundred lbs", [100]],
    ["second set rpe 9.5", [2, 9.5]], ["three sets of five", [3, 5]], ["5x5 @ 62.5kg", [5, 5, 62.5]], ["rest 90 seconds", [90]],
    ["再来一组", [1]], ["二十一下", [21]], ["一共三组", [3]], ["每一组 RPE 8", [8]], ["often tone", []],
  ];
  for (const [text, numbers] of cases) assert.deepEqual(numbersIn(text), numbers, text);
  assert.deepEqual(numbersIn("三头肌下压 20kg 12个", ["三头肌下压"]), [20, 12]);
  assert.deepEqual(numbersIn("one-arm row 10 reps", ["One-Arm Row"]), [10]);
  assert.deepEqual([...unitsIn("60kg")], ["kg"]); assert.deepEqual([...unitsIn("135 lbs")], ["lb"]);
  assert.deepEqual([...unitsIn("60斤 10个")], ["jin"]); assert.deepEqual([...unitsIn("60公斤")], ["kg"]);
  assert.deepEqual([...unitsIn("卧推60kg5个")], ["kg"]); assert.deepEqual([...unitsIn("235lb10个")], ["lb"]);
  assert.deepEqual([...unitsIn("bench 8 reps")], []); assert.deepEqual([...unitsIn("backpack pounding")], []);
});

test("a label must account for every number and unit in its sentence, and only those", () => {
  const record: ParseLabel = { intent: "record", exercise: "卧推", sets: [set(5, 60), set(5, 60, "kg", 8)] };
  assert.deepEqual(labelTextProblems("卧推 60 公斤 5、5，最后一组 RPE 8", record), []);
  assert.deepEqual(labelTextProblems("卧推 2组 60kg 每组5个，最后一组RPE8", record), []); // The set count may be stated.
  assert.deepEqual(labelTextProblems("卧推 65 公斤 5、5，最后一组 RPE 8", record), ["missing:60", "extra:65"]);
  assert.deepEqual(labelTextProblems("卧推 60 磅 5、5，最后一组 RPE 8", record), ["unit:lb", "missing_unit:kg"]);
  assert.deepEqual(labelTextProblems("卧推 60 斤 5、5，最后一组 RPE 8", record), ["unit:jin", "missing_unit:kg"]);
  assert.deepEqual(labelTextProblems("卧推 5、5 RPE 8", { intent: "record", exercise: "卧推", sets: [set(5), set(5, null, null, 8)] }), []);
  assert.deepEqual(labelTextProblems("三头肌下压 二十公斤 十二个", { intent: "record", exercise: "三头肌下压", sets: [set(12, 20)] }, ["三头肌下压"]), []);
  assert.deepEqual(labelTextProblems("更正第二组其实是 8 个", { intent: "correct", exercise: null, target: 2, changes: { reps: 8 } }), []);
  assert.deepEqual(labelTextProblems("最后一组改成 8 个", { intent: "correct", exercise: null, target: "last", changes: { reps: 8 } }), []);
  assert.deepEqual(labelTextProblems("跳过第三组", { intent: "skip", exercise: null, target: 3 }), []);
  assert.deepEqual(labelTextProblems("跳过第三组", { intent: "skip", exercise: null, target: "next" }), ["extra:3"]);
  assert.deepEqual(labelTextProblems("同上，再来两组", { intent: "repeat", exercise: null, count: 2 }), []);
  assert.deepEqual(labelTextProblems("练完了，今天 5 个动作", { intent: "end" }), ["extra:5"]);
  assert.deepEqual(labelTextProblems("大概 60 公斤做了很多次", { intent: "clarify", reason: "uncertain_quantity" }), []);
});
