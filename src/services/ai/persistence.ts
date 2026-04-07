import type { SupabaseClient } from "@supabase/supabase-js";

import type { AiNutritionGenerationConstraints, AiTrainingGenerationConstraints } from "@/lib/ai/schemas";
import { mapAiNutritionPlanToPersistence, mapAiTrainingPlanToTrainingPlan } from "@/lib/ai/mappers";
import type { AiProfileSnapshot } from "@/services/ai/types";

function nowIso(): string {
  return new Date().toISOString();
}

export async function fetchAiProfileSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<AiProfileSnapshot> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    gender: String(data?.gender ?? "unknown") as AiProfileSnapshot["gender"],
    age: Number(data?.age ?? 0),
    height: Number(data?.height ?? 0),
    currentWeight: Number(data?.current_weight ?? 0),
    targetWeight: Number(data?.target_weight ?? 0),
    weeklyTrainingDays: Number(data?.weekly_training_days ?? 0),
    calorieTarget: Number(data?.calorie_target ?? 0),
    proteinTarget: Number(data?.protein_target ?? 0),
    targetWeeklyLossMin: Number(data?.target_weekly_loss_min ?? 0),
    targetWeeklyLossMax: Number(data?.target_weekly_loss_max ?? 0),
    fitnessGoal: String(data?.fitness_goal ?? "fat_loss") as AiProfileSnapshot["fitnessGoal"],
    trainingExperience: String(data?.training_experience ?? "beginner") as AiProfileSnapshot["trainingExperience"],
    trainingLocation: String(data?.training_location ?? "mixed") as AiProfileSnapshot["trainingLocation"],
    availableEquipment: Array.isArray(data?.available_equipment)
      ? data.available_equipment.map((item: unknown) => String(item).trim()).filter(Boolean)
      : [],
    sessionDurationMinutes: Number(data?.session_duration_minutes ?? 0),
    dietPreference: String(data?.diet_preference ?? "none") as AiProfileSnapshot["dietPreference"],
    foodRestrictions: String(data?.food_restrictions ?? ""),
    injuryNotes: String(data?.injury_notes ?? ""),
    lifestyleNotes: String(data?.lifestyle_notes ?? ""),
  };
}

export async function insertTrainingGenerationHistory(
  supabase: SupabaseClient,
  row: {
    userId: string;
    goalType: string;
    profile: AiProfileSnapshot;
    constraints: AiTrainingGenerationConstraints & { locale?: string };
    modelName: string;
    promptVersion: string;
    rawResponse: unknown;
    parsedPlan: unknown;
    status: "success" | "failed" | "draft";
    errorMessage?: string;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("ai_training_plan_generations")
    .insert({
      user_id: row.userId,
      goal_type: row.goalType,
      input_profile_json: row.profile,
      input_constraints_json: row.constraints,
      model_name: row.modelName,
      prompt_version: row.promptVersion,
      raw_response_json: row.rawResponse,
      parsed_plan_json: row.parsedPlan,
      status: row.status,
      error_message: row.errorMessage ?? null,
      updated_at: nowIso(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[ai] failed to insert training generation history", error);
    return null;
  }

  return String(data?.id ?? "");
}

export async function insertNutritionGenerationHistory(
  supabase: SupabaseClient,
  row: {
    userId: string;
    goalType: string;
    profile: AiProfileSnapshot;
    constraints: AiNutritionGenerationConstraints & { locale?: string };
    modelName: string;
    promptVersion: string;
    rawResponse: unknown;
    parsedPlan: unknown;
    status: "success" | "failed" | "draft";
    errorMessage?: string;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("ai_nutrition_plan_generations")
    .insert({
      user_id: row.userId,
      goal_type: row.goalType,
      input_profile_json: row.profile,
      input_constraints_json: row.constraints,
      model_name: row.modelName,
      prompt_version: row.promptVersion,
      raw_response_json: row.rawResponse,
      parsed_plan_json: row.parsedPlan,
      status: row.status,
      error_message: row.errorMessage ?? null,
      updated_at: nowIso(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[ai] failed to insert nutrition generation history", error);
    return null;
  }

  return String(data?.id ?? "");
}

async function persistTrainingPlan(
  supabase: SupabaseClient,
  userId: string,
  plan: ReturnType<typeof mapAiTrainingPlanToTrainingPlan>,
): Promise<void> {
  const { error: clearActiveError } = await supabase
    .from("training_plans")
    .update({ is_active: false, updated_at: nowIso() })
    .eq("user_id", userId);

  if (clearActiveError) {
    throw clearActiveError;
  }

  const { error: upsertPlanError } = await supabase.from("training_plans").upsert(
    {
      id: plan.id,
      user_id: userId,
      name: plan.name,
      notes: plan.notes || "",
      is_active: true,
      created_at: plan.createdAt,
      updated_at: nowIso(),
    },
    { onConflict: "id" },
  );

  if (upsertPlanError) {
    throw upsertPlanError;
  }

  const { error: deleteWeeksError } = await supabase
    .from("training_plan_weeks")
    .delete()
    .eq("training_plan_id", plan.id);
  if (deleteWeeksError) {
    throw deleteWeeksError;
  }

  const weekRows = plan.weeks.map((week) => ({
    id: week.id,
    training_plan_id: plan.id,
    week_number: week.weekNumber,
  }));
  if (weekRows.length > 0) {
    const { error: weekError } = await supabase.from("training_plan_weeks").insert(weekRows);
    if (weekError) {
      throw weekError;
    }
  }

  const dayRows = plan.weeks.flatMap((week) =>
    week.days.map((day) => ({
      id: day.id,
      week_id: week.id,
      day_number: day.dayNumber,
      title: day.title,
      notes: day.notes,
    })),
  );
  if (dayRows.length > 0) {
    const { error: dayError } = await supabase.from("training_plan_days").insert(dayRows);
    if (dayError) {
      throw dayError;
    }
  }

  const exerciseRows = plan.weeks.flatMap((week) =>
    week.days.flatMap((day) =>
      day.exercises.map((exercise) => ({
        id: exercise.id,
        day_id: day.id,
        name: exercise.name,
        sets: exercise.sets,
        rep_range: exercise.repRange,
        target_rpe: exercise.targetRpe,
        notes: exercise.notes,
        alternative_exercises: exercise.alternativeExercises ?? [],
      })),
    ),
  );
  if (exerciseRows.length > 0) {
    const { error: exerciseError } = await supabase
      .from("training_plan_exercises")
      .insert(exerciseRows);
    if (exerciseError) {
      throw exerciseError;
    }
  }
}

export async function saveAiTrainingPlanAsFormalPlan(
  supabase: SupabaseClient,
  userId: string,
  aiPlan: Parameters<typeof mapAiTrainingPlanToTrainingPlan>[0]["plan"],
): Promise<{ planId: string; planName: string }> {
  const mapped = mapAiTrainingPlanToTrainingPlan({ userId, plan: aiPlan });
  await persistTrainingPlan(supabase, userId, mapped);
  return { planId: mapped.id, planName: mapped.name };
}

export async function saveAiNutritionPlanAsFormalPlan(
  supabase: SupabaseClient,
  userId: string,
  plan: Parameters<typeof mapAiNutritionPlanToPersistence>[0]["plan"],
  activate = true,
): Promise<{ planId: string; planName: string }> {
  const mapped = mapAiNutritionPlanToPersistence({
    userId,
    plan,
    activate,
  });

  if (activate) {
    const { error: clearError } = await supabase
      .from("nutrition_plans")
      .update({ is_active: false, updated_at: nowIso() })
      .eq("user_id", userId);
    if (clearError) {
      throw clearError;
    }
  }

  const { error: insertPlanError } = await supabase.from("nutrition_plans").insert(mapped.plan);
  if (insertPlanError) {
    throw insertPlanError;
  }

  if (mapped.days.length > 0) {
    const { error: insertDaysError } = await supabase
      .from("nutrition_plan_days")
      .insert(mapped.days);
    if (insertDaysError) {
      throw insertDaysError;
    }
  }

  if (mapped.meals.length > 0) {
    const { error: insertMealsError } = await supabase
      .from("nutrition_plan_meals")
      .insert(mapped.meals);
    if (insertMealsError) {
      throw insertMealsError;
    }
  }

  return {
    planId: mapped.plan.id,
    planName: mapped.plan.name,
  };
}
