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
  focus: z.string().trim().min(1).max(200),
  days: z.array(aiTrainingDaySchema).min(1).max(7),
});

export const aiTrainingPlanSchema = z.object({
  plan_name: z.string().trim().min(1).max(120),
  goal_type: aiGoalTypeSchema,
  summary: z.string().trim().min(1).max(2000),
  reasoning_summary: z.string().trim().min(1).max(1200),
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
  constraints: aiTrainingGenerationConstraintsSchema.default({
    available_equipment: [],
    injury_notes: "",
    preferred_focus: "",
    notes: "",
  }),
});

export const generateNutritionPlanRequestSchema = z.object({
  locale: aiLocaleSchema.default("zh-CN"),
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
