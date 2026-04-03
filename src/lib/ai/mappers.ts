import type { AiNutritionPlan, AiTrainingPlan } from "@/lib/ai/schemas";
import type { TrainingPlan } from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function mapAiTrainingPlanToTrainingPlan(input: {
  userId: string;
  plan: AiTrainingPlan;
}): TrainingPlan {
  const planId = createId(`plan-${input.userId}`);
  const timestamp = nowIso();

  return {
    id: planId,
    userId: input.userId,
    name: input.plan.plan_name,
    notes: [input.plan.summary, input.plan.reasoning_summary]
      .filter(Boolean)
      .join("\n\n"),
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    weeks: input.plan.weeks.map((week) => {
      const weekId = `${planId}-w${week.week_number}`;
      return {
        id: weekId,
        trainingPlanId: planId,
        weekNumber: week.week_number,
        days: week.days.map((day) => {
          const dayId = `${weekId}-d${day.day_number}`;
          return {
            id: dayId,
            weekId,
            dayNumber: day.day_number,
            title: day.title,
            notes: day.notes || "",
            exercises: day.exercises.map((exercise, index) => ({
              id: `${dayId}-e${index + 1}`,
              dayId,
              name: exercise.name,
              sets: exercise.sets,
              repRange: exercise.rep_range,
              targetRpe: exercise.target_rpe,
              notes: exercise.notes || "",
              alternativeExercises: exercise.alternative_exercises ?? [],
            })),
          };
        }),
      };
    }),
  };
}

export interface NutritionPlanInsertRow {
  id: string;
  user_id: string;
  name: string;
  goal_type: string;
  daily_calorie_target: number;
  protein_target: number;
  carb_target: number;
  fat_target: number;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NutritionPlanDayInsertRow {
  id: string;
  nutrition_plan_id: string;
  day_number: number;
  notes: string;
}

export interface NutritionPlanMealInsertRow {
  id: string;
  day_id: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  title: string;
  foods_json: Array<{
    name: string;
    amount: string;
    estimated_calories: number;
    estimated_protein_g: number;
    notes: string;
    alternatives: string[];
  }>;
}

export function mapAiNutritionPlanToPersistence(input: {
  userId: string;
  plan: AiNutritionPlan;
  activate: boolean;
}): {
  plan: NutritionPlanInsertRow;
  days: NutritionPlanDayInsertRow[];
  meals: NutritionPlanMealInsertRow[];
} {
  const timestamp = nowIso();
  const planId = createId(`nutrition-${input.userId}`);

  const planRow: NutritionPlanInsertRow = {
    id: planId,
    user_id: input.userId,
    name: input.plan.plan_name,
    goal_type: input.plan.goal_type,
    daily_calorie_target: input.plan.daily_targets.calories,
    protein_target: input.plan.daily_targets.protein_g,
    carb_target: input.plan.daily_targets.carbs_g,
    fat_target: input.plan.daily_targets.fat_g,
    notes: input.plan.summary,
    is_active: input.activate,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const days: NutritionPlanDayInsertRow[] = [];
  const meals: NutritionPlanMealInsertRow[] = [];

  input.plan.days.forEach((day) => {
    const dayId = `${planId}-d${day.day_number}`;
    days.push({
      id: dayId,
      nutrition_plan_id: planId,
      day_number: day.day_number,
      notes: day.notes || "",
    });

    day.meals.forEach((meal, mealIndex) => {
      meals.push({
        id: `${dayId}-m${mealIndex + 1}`,
        day_id: dayId,
        meal_type: meal.meal_type,
        title: meal.title,
        foods_json: meal.foods.map((food) => ({
          name: food.name,
          amount: food.amount,
          estimated_calories: food.estimated_calories,
          estimated_protein_g: food.estimated_protein_g,
          notes: food.notes || "",
          alternatives: food.alternatives ?? [],
        })),
      });
    });
  });

  return {
    plan: planRow,
    days,
    meals,
  };
}
