import assert from "node:assert/strict";
import { test } from "node:test";

import { estimateWorkoutCalories } from "../src/lib/workout-calories";

test("returns 0 for empty exercises", () => {
  const result = estimateWorkoutCalories({
    bodyWeightKg: 75,
    durationMinutes: 60,
    exercises: [],
  });
  assert.equal(result, 0);
});

test("uses defaults when body weight and duration are zero", () => {
  const result = estimateWorkoutCalories({
    bodyWeightKg: 0,
    durationMinutes: 0,
    exercises: [{ exercisePlanId: "ex1", actualWeight: 100, actualReps: 10, actualRpe: 8, completed: true }],
  });
  assert.ok(result > 0, "should return positive calories with defaults");
});

test("returns higher calories for higher RPE", () => {
  const lowRpe = estimateWorkoutCalories({
    bodyWeightKg: 75,
    durationMinutes: 60,
    exercises: [{ exercisePlanId: "ex1", actualWeight: 100, actualReps: 10, actualRpe: 6, completed: true }],
  });
  const highRpe = estimateWorkoutCalories({
    bodyWeightKg: 75,
    durationMinutes: 60,
    exercises: [{ exercisePlanId: "ex1", actualWeight: 100, actualReps: 10, actualRpe: 9, completed: true }],
  });
  assert.ok(highRpe > lowRpe, "higher RPE should burn more calories");
});

test("returns higher calories for heavier body weight", () => {
  const light = estimateWorkoutCalories({
    bodyWeightKg: 60,
    durationMinutes: 60,
    exercises: [{ exercisePlanId: "ex1", actualWeight: 80, actualReps: 10, actualRpe: 7, completed: true }],
  });
  const heavy = estimateWorkoutCalories({
    bodyWeightKg: 100,
    durationMinutes: 60,
    exercises: [{ exercisePlanId: "ex1", actualWeight: 80, actualReps: 10, actualRpe: 7, completed: true }],
  });
  assert.ok(heavy > light, "heavier person should burn more calories");
});

test("uses plan exercise sets when provided", () => {
  const withoutPlan = estimateWorkoutCalories({
    bodyWeightKg: 75,
    durationMinutes: 60,
    exercises: [{ exercisePlanId: "ex1", actualWeight: 100, actualReps: 10, actualRpe: 7, completed: true }],
  });
  const withPlan = estimateWorkoutCalories({
    bodyWeightKg: 75,
    durationMinutes: 60,
    exercises: [{ exercisePlanId: "ex1", actualWeight: 100, actualReps: 10, actualRpe: 7, completed: true }],
    planExercises: [{ id: "ex1", sets: 5 }],
  });
  assert.ok(withPlan > withoutPlan, "more sets should burn more calories");
});

test("prefers completed exercises over incomplete", () => {
  const result = estimateWorkoutCalories({
    bodyWeightKg: 75,
    durationMinutes: 60,
    exercises: [
      { exercisePlanId: "ex1", actualWeight: 100, actualReps: 10, actualRpe: 8, completed: true },
      { exercisePlanId: "ex2", actualWeight: 0, actualReps: 0, actualRpe: 0, completed: false },
    ],
  });
  assert.ok(result > 0, "should use completed exercises only");
});

test("falls back to all exercises when none completed", () => {
  const result = estimateWorkoutCalories({
    bodyWeightKg: 75,
    durationMinutes: 60,
    exercises: [
      { exercisePlanId: "ex1", actualWeight: 100, actualReps: 10, actualRpe: 8, completed: false },
    ],
  });
  assert.ok(result > 0, "should fall back to incomplete exercises");
});
