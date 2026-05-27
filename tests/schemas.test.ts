import assert from "node:assert/strict";
import { test } from "node:test";

import { userSettingsSchema, quickFoodItemSchema } from "../src/lib/schemas";

test("userSettingsSchema accepts valid settings", () => {
  const valid = {
    userId: "user-1",
    gender: "male",
    age: 25,
    fitnessGoal: "fat_loss",
    trainingExperience: "intermediate",
    trainingLocation: "gym",
    availableEquipment: ["barbell", "dumbbell"],
    sessionDurationMinutes: 60,
    dietPreference: "high_protein",
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
  };
  const result = userSettingsSchema.safeParse(valid);
  assert.equal(result.success, true);
});

test("userSettingsSchema rejects negative age", () => {
  const invalid = {
    userId: "user-1",
    gender: "male",
    age: -5,
    fitnessGoal: "fat_loss",
    trainingExperience: "beginner",
    trainingLocation: "home",
    availableEquipment: [],
    sessionDurationMinutes: 45,
    dietPreference: "none",
    foodRestrictions: "",
    injuryNotes: "",
    lifestyleNotes: "",
    height: 170,
    currentWeight: 70,
    targetWeight: 65,
    weeklyTrainingDays: 3,
    calorieTarget: 1800,
    proteinTarget: 120,
    targetWeeklyLossMin: 0.3,
    targetWeeklyLossMax: 0.7,
  };
  const result = userSettingsSchema.safeParse(invalid);
  assert.equal(result.success, false);
});

test("userSettingsSchema accepts boundary values", () => {
  const boundary = {
    userId: "user-1",
    gender: "unknown",
    age: 0,
    fitnessGoal: "maintenance",
    trainingExperience: "advanced",
    trainingLocation: "mixed",
    availableEquipment: [],
    sessionDurationMinutes: 0,
    dietPreference: "balanced",
    foodRestrictions: "none",
    injuryNotes: "none",
    lifestyleNotes: "none",
    height: 0,
    currentWeight: 0,
    targetWeight: 0,
    weeklyTrainingDays: 0,
    calorieTarget: 0,
    proteinTarget: 0,
    targetWeeklyLossMin: 0,
    targetWeeklyLossMax: 0,
  };
  const result = userSettingsSchema.safeParse(boundary);
  assert.equal(result.success, true);
});

test("quickFoodItemSchema accepts valid item", () => {
  const valid = {
    id: "food-1",
    name: "Chicken Breast",
    calories: 165,
    protein: 31,
    mealType: "lunch",
    basisType: "per_100g",
    servingSize: "100",
    unitLabel: "g",
    displayText: "100g",
  };
  const result = quickFoodItemSchema.safeParse(valid);
  assert.equal(result.success, true);
});

test("quickFoodItemSchema rejects missing required fields", () => {
  const invalid = {
    id: "food-1",
    name: "Chicken Breast",
  };
  const result = quickFoodItemSchema.safeParse(invalid);
  assert.equal(result.success, false);
});
