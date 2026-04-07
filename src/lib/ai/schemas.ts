import { z } from "zod";

export const aiGoalTypeSchema = z.enum([
  "fat_loss",
  "muscle_gain",
  "maintenance",
  "recomposition",
]);

export const aiTrainingExperienceSchema = z.enum([
  "beginner",
  "intermediate",
  "advanced",
]);

export const aiTrainingLocationSchema = z.enum(["gym", "home", "mixed"]);

export const aiDietPreferenceSchema = z.enum([
  "none",
  "high_protein",
  "vegetarian",
  "low_carb",
  "balanced",
]);
export const aiLocaleSchema = z.enum(["zh-CN", "en"]);

export const aiProfileSnapshotSchema = z.object({
  gender: z.enum(["male", "female", "other", "unknown"]).default("unknown"),
  age: z.coerce.number().int().min(0).max(120).default(0),
  height: z.coerce.number().min(0).max(260).default(0),
  currentWeight: z.coerce.number().min(0).max(500).default(0),
  targetWeight: z.coerce.number().min(0).max(500).default(0),
  weeklyTrainingDays: z.coerce.number().int().min(0).max(7).default(0),
  calorieTarget: z.coerce.number().min(0).max(7000).default(0),
  proteinTarget: z.coerce.number().min(0).max(500).default(0),
  targetWeeklyLossMin: z.coerce.number().min(0).max(3).default(0),
  targetWeeklyLossMax: z.coerce.number().min(0).max(3).default(0),
  fitnessGoal: aiGoalTypeSchema.default("fat_loss"),
  trainingExperience: aiTrainingExperienceSchema.default("beginner"),
  trainingLocation: aiTrainingLocationSchema.default("mixed"),
  availableEquipment: z.array(z.string().trim().min(1).max(80)).default([]),
  sessionDurationMinutes: z.coerce.number().int().min(0).max(300).default(0),
  dietPreference: aiDietPreferenceSchema.default("none"),
  foodRestrictions: z.string().max(1000).default(""),
  injuryNotes: z.string().max(1000).default(""),
  lifestyleNotes: z.string().max(1000).default(""),
});

export const aiTrainingExerciseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sets: z.coerce.number().int().min(1).max(10),
  rep_range: z.string().trim().min(1).max(40),
  target_rpe: z.coerce.number().min(4).max(10),
  rest_seconds: z.coerce.number().int().min(20).max(600).default(90),
  notes: z.string().max(500).default(""),
  alternative_exercises: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
});

export const aiTrainingDaySchema = z.object({
  day_number: z.coerce.number().int().min(1).max(7),
  title: z.string().trim().min(1).max(120),
  notes: z.string().max(1000).default(""),
  estimated_duration_minutes: z.coerce.number().int().min(15).max(180),
  exercises: z.array(aiTrainingExerciseSchema).min(1).max(20),
});

export const aiTrainingWeekSchema = z.object({
  week_number: z.coerce.number().int().min(1).max(16),
  focus: z.string().trim().max(200).default(""),
  days: z.array(aiTrainingDaySchema).min(1).max(7),
});

export const aiTrainingPlanSchema = z.object({
  plan_name: z.string().trim().min(1).max(120),
  goal_type: aiGoalTypeSchema,
  summary: z.string().trim().min(1).max(2000),
  reasoning_summary: z.string().trim().max(1200).default(""),
  warnings: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  weeks: z.array(aiTrainingWeekSchema).min(1).max(16),
});

export const aiNutritionFoodSchema = z.object({
  name: z.string().trim().min(1).max(120),
  amount: z.string().trim().min(1).max(80),
  estimated_calories: z.coerce.number().int().min(0).max(2000),
  estimated_protein_g: z.coerce.number().min(0).max(200),
  notes: z.string().max(500).default(""),
  alternatives: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
});

export const aiNutritionMealSchema = z.object({
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  title: z.string().trim().min(1).max(120),
  foods: z.array(aiNutritionFoodSchema).min(1).max(20),
});

export const aiNutritionDaySchema = z.object({
  day_number: z.coerce.number().int().min(1).max(7),
  notes: z.string().max(1000).default(""),
  meals: z.array(aiNutritionMealSchema).min(1).max(8),
});

export const aiNutritionTargetsSchema = z.object({
  calories: z.coerce.number().int().min(1200).max(5000),
  protein_g: z.coerce.number().min(40).max(400),
  carbs_g: z.coerce.number().min(30).max(700),
  fat_g: z.coerce.number().min(20).max(200),
  water_ml: z.coerce.number().int().min(1000).max(6000).default(2500),
});

export const aiNutritionPlanSchema = z.object({
  plan_name: z.string().trim().min(1).max(120),
  goal_type: aiGoalTypeSchema,
  summary: z.string().trim().min(1).max(2000),
  warnings: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  daily_targets: aiNutritionTargetsSchema,
  days: z.array(aiNutritionDaySchema).min(1).max(7),
});

// Raw model output schemas: intentionally more tolerant, normalize before strict final schema.
export const aiTrainingExerciseRawSchema = z.object({
  name: z.unknown().optional(),
  sets: z.union([z.number(), z.string()]).optional(),
  rep_range: z.unknown().optional(),
  target_rpe: z.union([z.number(), z.string()]).optional(),
  rest_seconds: z.union([z.number(), z.string()]).optional(),
  notes: z.unknown().optional(),
  alternative_exercises: z.union([z.array(z.unknown()), z.string()]).optional(),
});

export const aiTrainingDayRawSchema = z.object({
  day_number: z.union([z.number(), z.string()]).optional(),
  title: z.unknown().optional(),
  notes: z.unknown().optional(),
  estimated_duration_minutes: z.union([z.number(), z.string()]).optional(),
  exercises: z.array(aiTrainingExerciseRawSchema).optional(),
});

export const aiTrainingWeekRawSchema = z.object({
  week_number: z.union([z.number(), z.string()]).optional(),
  focus: z.unknown().optional(),
  days: z.array(aiTrainingDayRawSchema).optional(),
});

export const aiTrainingPlanRawSchema = z.object({
  plan_name: z.unknown().optional(),
  goal_type: z.unknown().optional(),
  summary: z.unknown().optional(),
  reasoning_summary: z.unknown().optional(),
  warnings: z.union([z.array(z.unknown()), z.string()]).optional(),
  weeks: z.array(aiTrainingWeekRawSchema).optional(),
});

export const aiNutritionFoodRawSchema = z.object({
  name: z.unknown().optional(),
  amount: z.unknown().optional(),
  estimated_calories: z.union([z.number(), z.string()]).optional(),
  estimated_protein_g: z.union([z.number(), z.string()]).optional(),
  notes: z.unknown().optional(),
  alternatives: z.union([z.array(z.unknown()), z.string()]).optional(),
});

export const aiNutritionMealRawSchema = z.object({
  meal_type: z.unknown().optional(),
  title: z.unknown().optional(),
  foods: z.array(aiNutritionFoodRawSchema).optional(),
});

export const aiNutritionDayRawSchema = z.object({
  day_number: z.union([z.number(), z.string()]).optional(),
  notes: z.unknown().optional(),
  meals: z.array(aiNutritionMealRawSchema).optional(),
});

export const aiNutritionTargetsRawSchema = z.object({
  calories: z.union([z.number(), z.string()]).optional(),
  protein_g: z.union([z.number(), z.string()]).optional(),
  carbs_g: z.union([z.number(), z.string()]).optional(),
  fat_g: z.union([z.number(), z.string()]).optional(),
  water_ml: z.union([z.number(), z.string()]).optional(),
});

export const aiNutritionPlanRawSchema = z.object({
  plan_name: z.unknown().optional(),
  goal_type: z.unknown().optional(),
  summary: z.unknown().optional(),
  warnings: z.union([z.array(z.unknown()), z.string()]).optional(),
  daily_targets: aiNutritionTargetsRawSchema.optional(),
  days: z.array(aiNutritionDayRawSchema).optional(),
});

function toText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[;,，、]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeGoalType(value: unknown): z.infer<typeof aiGoalTypeSchema> {
  const raw = toText(value).toLowerCase();
  if (raw === "fat_loss" || raw === "muscle_gain" || raw === "maintenance" || raw === "recomposition") {
    return raw;
  }
  return "fat_loss";
}

function normalizeMealType(value: unknown): z.infer<typeof aiNutritionMealSchema.shape.meal_type> {
  const raw = toText(value).toLowerCase();
  if (raw === "breakfast" || raw === "lunch" || raw === "dinner" || raw === "snack") {
    return raw;
  }
  return "snack";
}

export function normalizeAiTrainingPlan(raw: z.infer<typeof aiTrainingPlanRawSchema>): AiTrainingPlan {
  const weeks = (raw.weeks ?? []).map((week, weekIndex) => {
    const days = (week.days ?? []).map((day, dayIndex) => {
      const exercises = (day.exercises ?? []).map((exercise, exerciseIndex) => ({
        name: toText(exercise.name, `Exercise ${exerciseIndex + 1}`),
        sets: clampNumber(Math.round(toNumber(exercise.sets, 3)), 1, 10),
        rep_range: toText(exercise.rep_range, "8-10"),
        target_rpe: clampNumber(toNumber(exercise.target_rpe, 7), 4, 10),
        rest_seconds: clampNumber(Math.round(toNumber(exercise.rest_seconds, 90)), 20, 600),
        notes: toText(exercise.notes, ""),
        alternative_exercises: toStringArray(exercise.alternative_exercises),
      }));

      return {
        day_number: clampNumber(Math.round(toNumber(day.day_number, dayIndex + 1)), 1, 7),
        title: toText(day.title, `Day ${dayIndex + 1}`),
        notes: toText(day.notes, ""),
        estimated_duration_minutes: clampNumber(Math.round(toNumber(day.estimated_duration_minutes, 60)), 15, 180),
        exercises,
      };
    });

    return {
      week_number: clampNumber(Math.round(toNumber(week.week_number, weekIndex + 1)), 1, 16),
      focus: toText(week.focus, ""),
      days,
    };
  });

  if (weeks.length === 0) {
    throw new Error("Training plan must include at least one week.");
  }
  if (weeks.some((week) => week.days.length === 0)) {
    throw new Error("Each training week must include at least one day.");
  }
  if (weeks.some((week) => week.days.some((day) => day.exercises.length === 0))) {
    throw new Error("Each training day must include at least one exercise.");
  }

  return {
    plan_name: toText(raw.plan_name, "AI Training Plan"),
    goal_type: normalizeGoalType(raw.goal_type),
    summary: toText(raw.summary, "Auto-generated training plan."),
    reasoning_summary: toText(raw.reasoning_summary, ""),
    warnings: toStringArray(raw.warnings),
    weeks,
  };
}

export function normalizeAiNutritionPlan(raw: z.infer<typeof aiNutritionPlanRawSchema>): AiNutritionPlan {
  const days = (raw.days ?? []).map((day, dayIndex) => {
    const meals = (day.meals ?? []).map((meal, mealIndex) => ({
      meal_type: normalizeMealType(meal.meal_type),
      title: toText(meal.title, `Meal ${mealIndex + 1}`),
      foods: (meal.foods ?? []).map((food, foodIndex) => ({
        name: toText(food.name, `Food ${foodIndex + 1}`),
        amount: toText(food.amount, "1 serving"),
        estimated_calories: clampNumber(Math.round(toNumber(food.estimated_calories, 150)), 0, 2000),
        estimated_protein_g: clampNumber(toNumber(food.estimated_protein_g, 10), 0, 200),
        notes: toText(food.notes, ""),
        alternatives: toStringArray(food.alternatives),
      })),
    }));

    return {
      day_number: clampNumber(Math.round(toNumber(day.day_number, dayIndex + 1)), 1, 7),
      notes: toText(day.notes, ""),
      meals,
    };
  });

  if (days.length === 0) {
    throw new Error("Nutrition plan must include at least one day.");
  }
  if (days.some((day) => day.meals.length === 0)) {
    throw new Error("Each nutrition day must include at least one meal.");
  }
  if (days.some((day) => day.meals.some((meal) => meal.foods.length === 0))) {
    throw new Error("Each meal must include at least one food item.");
  }

  const dailyTargets = raw.daily_targets ?? {};
  return {
    plan_name: toText(raw.plan_name, "AI Nutrition Plan"),
    goal_type: normalizeGoalType(raw.goal_type),
    summary: toText(raw.summary, "Auto-generated nutrition plan."),
    warnings: toStringArray(raw.warnings),
    daily_targets: {
      calories: clampNumber(Math.round(toNumber(dailyTargets.calories, 2200)), 1200, 5000),
      protein_g: clampNumber(toNumber(dailyTargets.protein_g, 160), 40, 400),
      carbs_g: clampNumber(toNumber(dailyTargets.carbs_g, 220), 30, 700),
      fat_g: clampNumber(toNumber(dailyTargets.fat_g, 60), 20, 200),
      water_ml: clampNumber(Math.round(toNumber(dailyTargets.water_ml, 2500)), 1000, 6000),
    },
    days,
  };
}

export const aiTrainingGenerationConstraintsSchema = z.object({
  goal_type: aiGoalTypeSchema.optional(),
  weekly_training_days: z.coerce.number().int().min(1).max(7).optional(),
  session_duration_minutes: z.coerce.number().int().min(15).max(180).optional(),
  training_location: aiTrainingLocationSchema.optional(),
  available_equipment: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  injury_notes: z.string().max(1000).default(""),
  preferred_focus: z.string().max(500).default(""),
  notes: z.string().max(1000).default(""),
});

export const aiNutritionGenerationConstraintsSchema = z.object({
  goal_type: aiGoalTypeSchema.optional(),
  diet_preference: aiDietPreferenceSchema.optional(),
  food_restrictions: z.string().max(1000).default(""),
  notes: z.string().max(1000).default(""),
});

export const generateTrainingPlanRequestSchema = z.object({
  locale: aiLocaleSchema.default("zh-CN"),
  profile_snapshot: aiProfileSnapshotSchema.optional(),
  constraints: aiTrainingGenerationConstraintsSchema.default({
    available_equipment: [],
    injury_notes: "",
    preferred_focus: "",
    notes: "",
  }),
});

export const generateNutritionPlanRequestSchema = z.object({
  locale: aiLocaleSchema.default("zh-CN"),
  profile_snapshot: aiProfileSnapshotSchema.optional(),
  constraints: aiNutritionGenerationConstraintsSchema.default({
    food_restrictions: "",
    notes: "",
  }),
});

export const saveTrainingPlanRequestSchema = z.object({
  generation_id: z.string().optional(),
  plan: aiTrainingPlanSchema,
});

export const saveNutritionPlanRequestSchema = z.object({
  generation_id: z.string().optional(),
  plan: aiNutritionPlanSchema,
  activate: z.boolean().default(true),
});

export type AiTrainingPlan = z.infer<typeof aiTrainingPlanSchema>;
export type AiNutritionPlan = z.infer<typeof aiNutritionPlanSchema>;
export type AiTrainingGenerationConstraints = z.infer<typeof aiTrainingGenerationConstraintsSchema>;
export type AiNutritionGenerationConstraints = z.infer<typeof aiNutritionGenerationConstraintsSchema>;
export type AiLocale = z.infer<typeof aiLocaleSchema>;
