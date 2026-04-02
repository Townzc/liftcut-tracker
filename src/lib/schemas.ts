import { z } from "zod";

const positiveNumber = z.coerce.number().finite().nonnegative();

export const localeSchema = z.enum(["zh-CN", "en"]);

export const userSettingsSchema = z.object({
  userId: z.string().min(1).optional().default(""),
  height: positiveNumber.min(100).max(260),
  currentWeight: positiveNumber.min(30).max(300),
  targetWeight: positiveNumber.min(30).max(300),
  weeklyTrainingDays: z.coerce.number().int().min(1).max(7),
  calorieTarget: positiveNumber.min(500).max(7000),
  proteinTarget: positiveNumber.min(30).max(400),
  targetWeeklyLossMin: positiveNumber.min(0).max(3),
  targetWeeklyLossMax: positiveNumber.min(0).max(3),
  updatedAt: z.string().optional().default("")
});

export const exercisePlanSchema = z.object({
  id: z.string().min(1),
  dayId: z.string().optional().default(""),
  name: z.string().min(1),
  sets: z.coerce.number().int().min(1).max(20),
  repRange: z.string().min(1),
  targetRpe: z.coerce.number().min(1).max(10),
  notes: z.string().default(""),
  alternativeExercises: z.array(z.string()).optional(),
});

export const planDaySchema = z.object({
  id: z.string().min(1),
  weekId: z.string().optional().default(""),
  dayNumber: z.coerce.number().int().min(1),
  title: z.string().min(1),
  exercises: z.array(exercisePlanSchema),
  notes: z.string().default(""),
});

export const planWeekSchema = z.object({
  id: z.string().min(1),
  trainingPlanId: z.string().optional().default(""),
  weekNumber: z.coerce.number().int().min(1),
  days: z.array(planDaySchema),
});

export const trainingPlanSchema = z.object({
  id: z.string().min(1),
  userId: z.string().optional().default(""),
  name: z.string().min(1),
  notes: z.string().optional().default(""),
  isActive: z.boolean().optional().default(true),
  createdAt: z.string().optional().default(""),
  updatedAt: z.string().optional().default(""),
  weeks: z.array(planWeekSchema),
});

export const exerciseLogSchema = z.object({
  id: z.string().min(1).optional().default(""),
  workoutLogId: z.string().min(1).optional().default(""),
  exercisePlanId: z.string().min(1),
  name: z.string().min(1),
  actualWeight: positiveNumber.max(1000),
  actualReps: positiveNumber.max(100),
  actualRpe: positiveNumber.max(10),
  completed: z.boolean(),
});

export const workoutLogSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1).optional().default(""),
  date: z.string().min(1),
  trainingPlanId: z.string().min(1).optional().default(""),
  weekNumber: z.coerce.number().int().min(1),
  dayNumber: z.coerce.number().int().min(1),
  durationMinutes: positiveNumber.max(600),
  completed: z.boolean(),
  notes: z.string(),
  createdAt: z.string().optional().default(""),
  exercises: z.array(exerciseLogSchema).min(1),
});

export const foodLogSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1).optional().default(""),
  date: z.string().min(1),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  foodName: z.string().min(1),
  calories: positiveNumber.max(5000),
  protein: positiveNumber.max(500),
  createdAt: z.string().optional().default(""),
});

export const bodyMetricLogSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1).optional().default(""),
  date: z.string().min(1),
  weight: positiveNumber.min(20).max(400),
  waist: positiveNumber.min(30).max(200),
  notes: z.string().optional(),
  createdAt: z.string().optional().default(""),
});

export const quickFoodItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  calories: positiveNumber.max(5000),
  protein: positiveNumber.max(500),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  basisType: z.enum(["per_100g", "per_serving"]),
  servingSize: z.string().min(1),
  unitLabel: z.string().min(1),
  displayText: z.string().min(1),
});

export const appDataSnapshotSchema = z.object({
  settings: userSettingsSchema,
  trainingPlan: trainingPlanSchema,
  workoutLogs: z.array(workoutLogSchema),
  foodLogs: z.array(foodLogSchema),
  bodyMetricLogs: z.array(bodyMetricLogSchema),
  quickFoods: z.array(quickFoodItemSchema),
});

export function getFirstZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) {
    return "Invalid data.";
  }

  return `${first.path.join(".") || "root"}: ${first.message}`;
}
