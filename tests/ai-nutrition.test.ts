import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aiNutritionPlanRawSchema,
  aiNutritionPlanSchema,
  normalizeAiNutritionPlan,
} from "../src/lib/ai/schemas";
import { buildNutritionPlanPrompt, NUTRITION_PROMPT_VERSION } from "../src/services/ai/prompts";

test("normalizeMealType maps Chinese meal types to English enums", () => {
  const testCases = [
    { input: "早餐", expected: "breakfast" },
    { input: "高蛋白早餐", expected: "breakfast" },
    { input: "午餐", expected: "lunch" },
    { input: "午餐外食", expected: "lunch" },
    { input: "晚餐", expected: "dinner" },
    { input: "训练后加餐", expected: "snack" },
    { input: "下午加餐", expected: "snack" },
    { input: "早饭", expected: "breakfast" },
    { input: "午饭", expected: "lunch" },
    { input: "晚饭", expected: "dinner" },
    { input: "加餐", expected: "snack" },
    { input: "零食", expected: "snack" },
    { input: "点心", expected: "snack" },
    { input: "breakfast", expected: "breakfast" },
    { input: "lunch", expected: "lunch" },
    { input: "dinner", expected: "dinner" },
    { input: "snack", expected: "snack" },
  ];

  for (const testCase of testCases) {
    const rawPlan = {
      plan_name: "Test Plan",
      goal_type: "fat_loss",
      summary: "Test summary",
      warnings: [],
      daily_targets: {
        calories: 2000,
        protein_g: 150,
        carbs_g: 200,
        fat_g: 60,
        water_ml: 2500,
      },
      days: [
        {
          day_number: 1,
          notes: "",
          meals: [
            {
              meal_type: testCase.input,
              title: "Test Meal",
              foods: [
                {
                  name: "Test Food",
                  amount: "100g",
                  estimated_calories: 200,
                  estimated_protein_g: 20,
                  notes: "",
                  alternatives: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const rawParsed = aiNutritionPlanRawSchema.safeParse(rawPlan);
    assert.equal(rawParsed.success, true, `Raw parse failed for input: ${testCase.input}`);

    const normalized = normalizeAiNutritionPlan(rawParsed.data);
    const finalParsed = aiNutritionPlanSchema.safeParse(normalized);
    assert.equal(finalParsed.success, true, `Final parse failed for input: ${testCase.input}`);
    assert.equal(
      finalParsed.data.days[0].meals[0].meal_type,
      testCase.expected,
      `Expected ${testCase.expected} for input ${testCase.input}, got ${finalParsed.data.days[0].meals[0].meal_type}`,
    );
  }
});

test("normalizeAiNutritionPlan handles wrapper output", () => {
  const wrappedPlan = {
    nutrition_plan: {
      plan_name: "Wrapped Plan",
      goal_type: "fat_loss",
      summary: "This is wrapped",
      warnings: [],
      daily_targets: {
        calories: 1850,
        protein_g: 125,
        carbs_g: 180,
        fat_g: 65,
        water_ml: 2000,
      },
      days: [
        {
          day_number: 1,
          notes: "",
          meals: [
            {
              meal_type: "breakfast",
              title: "早餐",
              foods: [
                {
                  name: "燕麦",
                  amount: "60g",
                  estimated_calories: 230,
                  estimated_protein_g: 8,
                  notes: "",
                  alternatives: [],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  // Test unwrap logic
  function unwrapNutritionPlanCandidate(value: unknown): unknown {
    if (
      value &&
      typeof value === "object" &&
      "nutrition_plan" in value &&
      typeof (value as Record<string, unknown>).nutrition_plan === "object"
    ) {
      return (value as Record<string, unknown>).nutrition_plan;
    }
    return value;
  }

  const unwrapped = unwrapNutritionPlanCandidate(wrappedPlan);
  const rawParsed = aiNutritionPlanRawSchema.safeParse(unwrapped);
  assert.equal(rawParsed.success, true, "Raw parse failed for unwrapped plan");

  const normalized = normalizeAiNutritionPlan(rawParsed.data);
  const finalParsed = aiNutritionPlanSchema.safeParse(normalized);
  assert.equal(finalParsed.success, true, "Final parse failed for unwrapped plan");
  assert.equal(finalParsed.data.plan_name, "Wrapped Plan");
  assert.equal(finalParsed.data.goal_type, "fat_loss");
});

test("buildNutritionPlanPrompt includes strict schema instructions", () => {
  const profile = {
    gender: "male" as const,
    age: 30,
    height: 175,
    currentWeight: 80,
    targetWeight: 75,
    weeklyTrainingDays: 4,
    calorieTarget: 2000,
    proteinTarget: 160,
    targetWeeklyLossMin: 0.3,
    targetWeeklyLossMax: 0.7,
    fitnessGoal: "fat_loss" as const,
    trainingExperience: "intermediate" as const,
    trainingLocation: "gym" as const,
    availableEquipment: ["barbell", "dumbbell"],
    sessionDurationMinutes: 60,
    dietPreference: "high_protein" as const,
    foodRestrictions: "",
    injuryNotes: "",
    lifestyleNotes: "",
  };

  const constraints = {
    goal_type: "fat_loss" as const,
    diet_preference: "high_protein" as const,
    food_restrictions: "",
    notes: "",
  };

  const prompt = buildNutritionPlanPrompt(profile, constraints, "zh-CN");

  // Check system prompt contains required instructions
  assert.match(prompt.systemPrompt, /nutrition_plan/);
  assert.match(prompt.systemPrompt, /breakfast/);
  assert.match(prompt.systemPrompt, /lunch/);
  assert.match(prompt.systemPrompt, /dinner/);
  assert.match(prompt.systemPrompt, /snack/);

  // Check user prompt contains required fields
  const userPromptJson = JSON.parse(prompt.userPrompt);
  assert.ok(userPromptJson.forbidden_top_level_keys, "forbidden_top_level_keys should exist");
  assert.ok(
    userPromptJson.forbidden_top_level_keys.includes("nutrition_plan"),
    "forbidden_top_level_keys should include nutrition_plan",
  );
  assert.ok(userPromptJson.enum_requirements, "enum_requirements should exist");
  assert.ok(userPromptJson.enum_requirements.meal_type, "enum_requirements.meal_type should exist");
  assert.ok(
    userPromptJson.enum_requirements.meal_type.includes("breakfast"),
    "meal_type should include breakfast",
  );
  assert.ok(
    userPromptJson.enum_requirements.meal_type.includes("lunch"),
    "meal_type should include lunch",
  );
  assert.ok(
    userPromptJson.enum_requirements.meal_type.includes("dinner"),
    "meal_type should include dinner",
  );
  assert.ok(
    userPromptJson.enum_requirements.meal_type.includes("snack"),
    "meal_type should include snack",
  );
  assert.ok(
    userPromptJson.hard_requirements.some((r: string) => r.includes("nutrition_plan")),
    "hard_requirements should mention nutrition_plan",
  );
  assert.ok(
    userPromptJson.hard_requirements.some((r: string) => r.includes("meal_type")),
    "hard_requirements should mention meal_type",
  );
});

test("NUTRITION_PROMPT_VERSION is updated", () => {
  assert.equal(NUTRITION_PROMPT_VERSION, "NUTRITION_PROMPT_V2_STRICT_SCHEMA");
});

test("normalizeAiNutritionPlan rejects invalid plans", () => {
  const invalidPlan = {
    plan_name: "",
    goal_type: "invalid_goal",
    summary: "",
    warnings: [],
    daily_targets: {
      calories: 2000,
      protein_g: 150,
      carbs_g: 200,
      fat_g: 60,
      water_ml: 2500,
    },
    days: [],
  };

  const rawParsed = aiNutritionPlanRawSchema.safeParse(invalidPlan);
  assert.equal(rawParsed.success, true, "Raw parse should succeed for tolerant schema");

  assert.throws(
    () => normalizeAiNutritionPlan(rawParsed.data),
    /Nutrition plan must include at least one day/,
    "normalizeAiNutritionPlan should throw for empty days",
  );
});
