import assert from "node:assert/strict";
import { test } from "node:test";
import { identifyExercise } from "@liftcut/core/exercise-catalog";
import { exerciseLabel } from "@liftcut/core/exercise-display";
import { confirmedValues, setValues, sourceTopic, workoutTitle } from "./display";

test("translated previews preserve unknown units/values and explicit zero", () => {
  const unknown = { load: null, unit: null, reps: 8, rpe: null };
  assert.equal(setValues(unknown, "zh-CN"), "— × 8 次 · RPE —");
  assert.equal(setValues({ ...unknown, load: 0, unit: "kg" }, "en"), "0 kg × 8 reps · RPE —");
  assert.equal(unknown.load, null); assert.equal(unknown.unit, null);
});
test("per-hand pounds are displayed unchanged in either language, never silently totalled or converted", () => {
  const set = { weightKg: null, reps: 12, rpe: null, perHandLoad: { value: 20, unit: "lb" as const } };
  assert.equal(confirmedValues(set, "zh-CN"), "20 lb / 单边 × 12 次 · RPE —");
  assert.equal(confirmedValues(set, "en"), "20 lb per hand × 12 reps · RPE —");
  assert.equal(set.weightKg, null);
  assert.equal(sourceTopic("workout", "zh-CN"), "训练记录");
  assert.equal(sourceTopic("future-source", "en"), "Records");
});

test("generic movement translation does not identify equipment; foreign custom titles use the factual day", () => {
  assert.equal(exerciseLabel("深蹲", "en"), "Squat");
  assert.equal(exerciseLabel("Squat", "zh-CN"), "深蹲");
  assert.equal(identifyExercise("深蹲"), null);
  assert.equal(exerciseLabel("My custom exercise", "en"), "My custom exercise");
  assert.equal(workoutTitle("独立手机验收", "en", 1, 1), "Week 1, day 1");
  assert.equal(workoutTitle("Upper body", "zh-CN", 2, 3), "第 2 周第 3 天");
  assert.equal(workoutTitle("全身训练", "zh-CN", 1, 1), "全身训练");
});
