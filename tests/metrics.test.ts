import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getTodayNutritionSummary,
  getNutritionByDate,
  getSuggestedTrainingDayNumber,
  getAverageWeightByDays,
} from "../src/lib/metrics";
import type { FoodLog, BodyMetricLog, UserSettings } from "../src/types";

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    userId: "user-1",
    gender: "male",
    age: 25,
    fitnessGoal: "fat_loss",
    trainingExperience: "intermediate",
    trainingLocation: "gym",
    availableEquipment: [],
    sessionDurationMinutes: 60,
    dietPreference: "none",
    foodRestrictions: "",
    injuryNotes: "",
    lifestyleNotes: "",
    height: 175,
    currentWeight: 80,
    targetWeight: 75,
    weeklyTrainingDays: 4,
    calorieTarget: 2000,
    proteinTarget: 160,
    targetWeeklyLossMin: 0.3,
    targetWeeklyLossMax: 0.7,
    updatedAt: "",
    ...overrides,
  };
}

function makeFoodLog(overrides: Partial<FoodLog> = {}): FoodLog {
  return {
    id: "food-1",
    userId: "user-1",
    date: "2025-01-15",
    mealType: "lunch",
    foodName: "Chicken",
    calories: 300,
    protein: 30,
    createdAt: "2025-01-15T12:00:00Z",
    ...overrides,
  };
}

function makeBodyLog(overrides: Partial<BodyMetricLog> = {}): BodyMetricLog {
  return {
    id: "body-1",
    userId: "user-1",
    date: "2025-01-15",
    weight: 80,
    waist: 85,
    createdAt: "2025-01-15T12:00:00Z",
    ...overrides,
  };
}

test("getTodayNutritionSummary returns zeros for no logs", () => {
  const settings = makeSettings();
  const result = getTodayNutritionSummary([], settings, "2025-01-15");
  assert.equal(result.calories, 0);
  assert.equal(result.protein, 0);
  assert.equal(result.remainingCalories, 2000);
  assert.equal(result.remainingProtein, 160);
});

test("getTodayNutritionSummary sums matching date logs", () => {
  const settings = makeSettings();
  const logs = [
    makeFoodLog({ date: "2025-01-15", calories: 500, protein: 40 }),
    makeFoodLog({ id: "food-2", date: "2025-01-15", calories: 300, protein: 25 }),
    makeFoodLog({ id: "food-3", date: "2025-01-16", calories: 200, protein: 15 }),
  ];
  const result = getTodayNutritionSummary(logs, settings, "2025-01-15");
  assert.equal(result.calories, 800);
  assert.equal(result.protein, 65);
  assert.equal(result.remainingCalories, 1200);
  assert.equal(result.remainingProtein, 95);
});

test("getNutritionByDate returns zeros for no matching logs", () => {
  const result = getNutritionByDate([], "2025-01-15");
  assert.equal(result.calories, 0);
  assert.equal(result.protein, 0);
});

test("getNutritionByDate sums matching date", () => {
  const logs = [
    makeFoodLog({ date: "2025-01-15", calories: 500, protein: 40 }),
    makeFoodLog({ id: "food-2", date: "2025-01-15", calories: 300, protein: 25 }),
  ];
  const result = getNutritionByDate(logs, "2025-01-15");
  assert.equal(result.calories, 800);
  assert.equal(result.protein, 65);
});

test("getSuggestedTrainingDayNumber returns valid day number", () => {
  const result = getSuggestedTrainingDayNumber(3);
  assert.ok(result >= 1 && result <= 3, `expected 1-3, got ${result}`);
});

test("getSuggestedTrainingDayNumber handles 1 training day", () => {
  const result = getSuggestedTrainingDayNumber(1);
  assert.equal(result, 1);
});

test("getAverageWeightByDays returns null for empty logs", () => {
  const result = getAverageWeightByDays([], 7);
  assert.equal(result, null);
});

test("getAverageWeightByDays computes average correctly", () => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const logs = [
    makeBodyLog({ date: today, weight: 80 }),
  ];
  const result = getAverageWeightByDays(logs, 7);
  assert.ok(result !== null);
  assert.ok(Math.abs(result! - 80) < 0.01);
});
