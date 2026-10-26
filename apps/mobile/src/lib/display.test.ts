import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedValues, setValues, sourceTopic } from "./display";

test("translated previews preserve unknown units/values and explicit zero", () => {
  const unknown = { load: null, unit: null, reps: 8, rpe: null };
  assert.equal(setValues(unknown, "zh-CN"), "— × 8 次 · 主观强度 —");
  assert.equal(setValues({ ...unknown, load: 0, unit: "kg" }, "en"), "0 kg × 8 reps · RPE —");
  assert.equal(unknown.load, null); assert.equal(unknown.unit, null);
});
test("per-hand pounds are displayed unchanged in either language, never silently totalled or converted", () => {
  const set = { weightKg: null, reps: 12, rpe: null, perHandLoad: { value: 20, unit: "lb" as const } };
  assert.equal(confirmedValues(set, "zh-CN"), "20 磅 / 单边 × 12 次 · 主观强度 —");
  assert.equal(confirmedValues(set, "en"), "20 lb per hand × 12 reps · RPE —");
  assert.equal(set.weightKg, null);
  assert.equal(sourceTopic("workout", "zh-CN"), "训练记录");
  assert.equal(sourceTopic("future-source", "en"), "Records");
});
