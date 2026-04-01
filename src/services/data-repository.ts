import { createDefaultSettings, createDemoSnapshot, createDemoTrainingPlan, defaultQuickFoods } from "@/lib/demo-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  AppDataSnapshot,
  AppLocale,
  BodyMetricLog,
  ExerciseLog,
  FoodLog,
  TrainingPlan,
  TrainingPlanSummary,
  UserProfile,
  UserSettings,
  WorkoutLog,
} from "@/types";

export interface UserDataBundle {
  snapshot: AppDataSnapshot;
  planList: TrainingPlanSummary[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalizeSettings(row: Record<string, unknown> | null, userId: string): UserSettings {
  if (!row) {
    return createDefaultSettings(userId);
  }

  return {
    userId,
    height: Number(row.height ?? 176),
    currentWeight: Number(row.current_weight ?? 78),
    targetWeight: Number(row.target_weight ?? 72),
    weeklyTrainingDays: Number(row.weekly_training_days ?? 3),
    calorieTarget: Number(row.calorie_target ?? 2200),
    proteinTarget: Number(row.protein_target ?? 160),
    targetWeeklyLossMin: Number(row.target_weekly_loss_min ?? 0.3),
    targetWeeklyLossMax: Number(row.target_weekly_loss_max ?? 0.8),
    updatedAt: String(row.updated_at ?? nowIso()),
  };
}

function mapWorkoutLogs(
  logs: Record<string, unknown>[],
  exerciseRows: Record<string, unknown>[],
): WorkoutLog[] {
  const exerciseMap = new Map<string, ExerciseLog[]>();

  exerciseRows.forEach((row) => {
    const workoutLogId = String(row.workout_log_id);
    const list = exerciseMap.get(workoutLogId) ?? [];
    list.push({
      id: String(row.id),
      workoutLogId,
      exercisePlanId: String(row.exercise_plan_id ?? ""),
      name: String(row.name ?? ""),
      actualWeight: Number(row.actual_weight ?? 0),
      actualReps: Number(row.actual_reps ?? 0),
      actualRpe: Number(row.actual_rpe ?? 0),
      completed: Boolean(row.completed),
    });
    exerciseMap.set(workoutLogId, list);
  });

  return logs.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    date: String(row.date),
    trainingPlanId: String(row.training_plan_id ?? ""),
    weekNumber: Number(row.week_number ?? 1),
    dayNumber: Number(row.day_number ?? 1),
    durationMinutes: Number(row.duration_minutes ?? 0),
    completed: Boolean(row.completed),
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at ?? nowIso()),
    exercises: exerciseMap.get(String(row.id)) ?? [],
  }));
}

function mapFoodLogs(rows: Record<string, unknown>[]): FoodLog[] {
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    date: String(row.date),
    mealType: String(row.meal_type) as FoodLog["mealType"],
    foodName: String(row.food_name ?? ""),
    calories: Number(row.calories ?? 0),
    protein: Number(row.protein ?? 0),
    createdAt: String(row.created_at ?? nowIso()),
  }));
}

function mapBodyLogs(rows: Record<string, unknown>[]): BodyMetricLog[] {
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    date: String(row.date),
    weight: Number(row.weight ?? 0),
    waist: Number(row.waist ?? 0),
    notes: row.notes ? String(row.notes) : "",
    createdAt: String(row.created_at ?? nowIso()),
  }));
}

function buildTrainingPlan(
  userId: string,
  planRow: Record<string, unknown> | null,
  weeksRows: Record<string, unknown>[],
  daysRows: Record<string, unknown>[],
  exerciseRows: Record<string, unknown>[],
): TrainingPlan {
  if (!planRow) {
    return createDemoTrainingPlan(userId);
  }

  const dayMap = new Map<string, Record<string, unknown>[]>();
  exerciseRows.forEach((row) => {
    const dayId = String(row.day_id);
    const list = dayMap.get(dayId) ?? [];
    list.push(row);
    dayMap.set(dayId, list);
  });

  const weekDayMap = new Map<string, Record<string, unknown>[]>();
  daysRows.forEach((row) => {
    const weekId = String(row.week_id);
    const list = weekDayMap.get(weekId) ?? [];
    list.push(row);
    weekDayMap.set(weekId, list);
  });

  const weeks = [...weeksRows]
    .sort((a, b) => Number(a.week_number ?? 0) - Number(b.week_number ?? 0))
    .map((weekRow) => {
      const weekId = String(weekRow.id);
      const days = (weekDayMap.get(weekId) ?? [])
        .sort((a, b) => Number(a.day_number ?? 0) - Number(b.day_number ?? 0))
        .map((dayRow) => {
          const dayId = String(dayRow.id);
          const exercises = (dayMap.get(dayId) ?? []).map((exerciseRow) => ({
            id: String(exerciseRow.id),
            dayId,
            name: String(exerciseRow.name ?? ""),
            sets: Number(exerciseRow.sets ?? 0),
            repRange: String(exerciseRow.rep_range ?? ""),
            targetRpe: Number(exerciseRow.target_rpe ?? 0),
            notes: String(exerciseRow.notes ?? ""),
            alternativeExercises: Array.isArray(exerciseRow.alternative_exercises)
              ? (exerciseRow.alternative_exercises as string[])
              : [],
          }));

          return {
            id: dayId,
            weekId,
            dayNumber: Number(dayRow.day_number ?? 1),
            title: String(dayRow.title ?? `Day ${dayRow.day_number}`),
            notes: String(dayRow.notes ?? ""),
            exercises,
          };
        });

      return {
        id: weekId,
        trainingPlanId: String(planRow.id),
        weekNumber: Number(weekRow.week_number ?? 1),
        days,
      };
    });

  return {
    id: String(planRow.id),
    userId,
    name: String(planRow.name ?? "Unnamed plan"),
    isActive: Boolean(planRow.is_active),
    createdAt: String(planRow.created_at ?? nowIso()),
    updatedAt: String(planRow.updated_at ?? nowIso()),
    weeks,
  };
}

export async function ensureUserProfile(
  userId: string,
  email: string,
  preferredLanguage: AppLocale = "zh-CN",
): Promise<UserProfile> {
  const supabase = getSupabaseBrowserClient();

  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id, email, preferred_language, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (!existing) {
    const { error: insertError } = await supabase.from("profiles").insert({
      id: userId,
      email,
      preferred_language: preferredLanguage,
    });

    if (insertError) {
      throw insertError;
    }

    return {
      id: userId,
      email,
      preferredLanguage,
      createdAt: nowIso(),
    };
  }

  if (String(existing.email ?? "") !== email) {
    const { error: updateEmailError } = await supabase
      .from("profiles")
      .update({ email })
      .eq("id", userId);

    if (updateEmailError) {
      throw updateEmailError;
    }
  }

  return {
    id: String(existing.id),
    email: String(existing.email ?? email),
    preferredLanguage: String(existing.preferred_language ?? preferredLanguage) as AppLocale,
    createdAt: String(existing.created_at ?? nowIso()),
  };
}

export async function updateUserPreferredLanguage(userId: string, language: AppLocale): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("profiles")
    .update({ preferred_language: language })
    .eq("id", userId);

  if (error) {
    throw error;
  }
}

async function insertTrainingPlanRecords(userId: string, plan: TrainingPlan, setActive = true): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  if (setActive) {
    const { error: clearActiveError } = await supabase
      .from("training_plans")
      .update({ is_active: false, updated_at: nowIso() })
      .eq("user_id", userId);

    if (clearActiveError) {
      throw clearActiveError;
    }
  }

  const { error: upsertPlanError } = await supabase.from("training_plans").upsert(
    {
      id: plan.id,
      user_id: userId,
      name: plan.name,
      is_active: setActive ? true : plan.isActive,
      created_at: plan.createdAt || nowIso(),
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

  if (plan.weeks.length === 0) {
    return;
  }

  const weekRows = plan.weeks.map((week) => ({
    id: week.id,
    training_plan_id: plan.id,
    week_number: week.weekNumber,
  }));

  const { error: insertWeeksError } = await supabase.from("training_plan_weeks").insert(weekRows);
  if (insertWeeksError) {
    throw insertWeeksError;
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
    const { error: insertDaysError } = await supabase.from("training_plan_days").insert(dayRows);
    if (insertDaysError) {
      throw insertDaysError;
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
    const { error: insertExercisesError } = await supabase
      .from("training_plan_exercises")
      .insert(exerciseRows);
    if (insertExercisesError) {
      throw insertExercisesError;
    }
  }
}

export async function setActiveTrainingPlan(userId: string, planId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error: clearError } = await supabase
    .from("training_plans")
    .update({ is_active: false, updated_at: nowIso() })
    .eq("user_id", userId);

  if (clearError) {
    throw clearError;
  }

  const { error: setError } = await supabase
    .from("training_plans")
    .update({ is_active: true, updated_at: nowIso() })
    .eq("id", planId)
    .eq("user_id", userId);

  if (setError) {
    throw setError;
  }
}

export async function upsertUserSettings(userId: string, settings: UserSettings): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      height: settings.height,
      current_weight: settings.currentWeight,
      target_weight: settings.targetWeight,
      weekly_training_days: settings.weeklyTrainingDays,
      calorie_target: settings.calorieTarget,
      protein_target: settings.proteinTarget,
      target_weekly_loss_min: settings.targetWeeklyLossMin,
      target_weekly_loss_max: settings.targetWeeklyLossMax,
      updated_at: nowIso(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw error;
  }
}

export async function saveTrainingPlan(userId: string, plan: TrainingPlan): Promise<void> {
  await insertTrainingPlanRecords(userId, plan, true);
}

export async function upsertWorkoutLog(userId: string, log: WorkoutLog): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const workoutLogId = log.id || generateId("workout");

  const { error: upsertLogError } = await supabase.from("workout_logs").upsert(
    {
      id: workoutLogId,
      user_id: userId,
      date: log.date,
      training_plan_id: log.trainingPlanId,
      week_number: log.weekNumber,
      day_number: log.dayNumber,
      duration_minutes: log.durationMinutes,
      completed: log.completed,
      notes: log.notes,
      created_at: log.createdAt || nowIso(),
    },
    { onConflict: "id" },
  );

  if (upsertLogError) {
    throw upsertLogError;
  }

  const { error: deleteExercisesError } = await supabase
    .from("workout_log_exercises")
    .delete()
    .eq("workout_log_id", workoutLogId);

  if (deleteExercisesError) {
    throw deleteExercisesError;
  }

  if (log.exercises.length === 0) {
    return;
  }

  const exerciseRows = log.exercises.map((exercise, index) => ({
    id: exercise.id || `${workoutLogId}-ex-${index + 1}`,
    workout_log_id: workoutLogId,
    exercise_plan_id: exercise.exercisePlanId,
    name: exercise.name,
    actual_weight: exercise.actualWeight,
    actual_reps: exercise.actualReps,
    actual_rpe: exercise.actualRpe,
    completed: exercise.completed,
  }));

  const { error: insertExercisesError } = await supabase
    .from("workout_log_exercises")
    .insert(exerciseRows);

  if (insertExercisesError) {
    throw insertExercisesError;
  }
}

type FoodLogInput = Omit<FoodLog, "userId" | "createdAt"> & { createdAt?: string };

export async function upsertFoodLog(userId: string, log: FoodLogInput): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const id = log.id || generateId("food");

  const { error } = await supabase.from("food_logs").upsert(
    {
      id,
      user_id: userId,
      date: log.date,
      meal_type: log.mealType,
      food_name: log.foodName,
      calories: log.calories,
      protein: log.protein,
      created_at: log.createdAt || nowIso(),
    },
    { onConflict: "id" },
  );

  if (error) {
    throw error;
  }
}

export async function removeFoodLog(userId: string, id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("food_logs").delete().eq("id", id).eq("user_id", userId);

  if (error) {
    throw error;
  }
}

type BodyMetricLogInput = Omit<BodyMetricLog, "userId" | "createdAt"> & { createdAt?: string };

export async function upsertBodyMetricLog(userId: string, log: BodyMetricLogInput): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const id = log.id || generateId("body");

  const { error } = await supabase.from("body_metric_logs").upsert(
    {
      id,
      user_id: userId,
      date: log.date,
      weight: log.weight,
      waist: log.waist,
      notes: log.notes ?? "",
      created_at: log.createdAt || nowIso(),
    },
    { onConflict: "id" },
  );

  if (error) {
    throw error;
  }
}

export async function removeBodyMetricLog(userId: string, id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("body_metric_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }
}

async function fetchPlanBundle(userId: string): Promise<{
  activePlan: TrainingPlan;
  planList: TrainingPlanSummary[];
}> {
  const supabase = getSupabaseBrowserClient();

  const { data: planRows, error: planError } = await supabase
    .from("training_plans")
    .select("id, user_id, name, is_active, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (planError) {
    throw planError;
  }

  const list = (planRows ?? []).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));

  const activeRow = planRows?.find((row) => row.is_active) ?? planRows?.[0] ?? null;
  if (!activeRow) {
    const fallback = createDemoTrainingPlan(userId);
    return { activePlan: fallback, planList: [] };
  }

  const { data: weekRows, error: weekError } = await supabase
    .from("training_plan_weeks")
    .select("id, training_plan_id, week_number")
    .eq("training_plan_id", activeRow.id)
    .order("week_number", { ascending: true });

  if (weekError) {
    throw weekError;
  }

  const weekIds = (weekRows ?? []).map((row) => row.id);
  const { data: dayRows, error: dayError } = weekIds.length
    ? await supabase
        .from("training_plan_days")
        .select("id, week_id, day_number, title, notes")
        .in("week_id", weekIds)
    : { data: [], error: null };

  if (dayError) {
    throw dayError;
  }

  const dayIds = (dayRows ?? []).map((row) => row.id);
  const { data: exerciseRows, error: exerciseError } = dayIds.length
    ? await supabase
        .from("training_plan_exercises")
        .select("id, day_id, name, sets, rep_range, target_rpe, notes, alternative_exercises")
        .in("day_id", dayIds)
    : { data: [], error: null };

  if (exerciseError) {
    throw exerciseError;
  }

  const activePlan = buildTrainingPlan(
    userId,
    activeRow as Record<string, unknown>,
    (weekRows ?? []) as Record<string, unknown>[],
    (dayRows ?? []) as Record<string, unknown>[],
    (exerciseRows ?? []) as Record<string, unknown>[],
  );

  return {
    activePlan,
    planList: list,
  };
}

export async function ensureUserBootstrap(userId: string, email: string): Promise<UserProfile> {
  const profile = await ensureUserProfile(userId, email, "zh-CN");

  const supabase = getSupabaseBrowserClient();

  const { data: settingsRow, error: settingsError } = await supabase
    .from("user_settings")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsError) {
    throw settingsError;
  }

  if (!settingsRow) {
    await upsertUserSettings(userId, createDefaultSettings(userId));
  }

  const { data: firstPlan, error: planError } = await supabase
    .from("training_plans")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (planError) {
    throw planError;
  }

  if (!firstPlan) {
    const demo = createDemoSnapshot(userId);
    await saveTrainingPlan(userId, demo.trainingPlan);

    for (const log of demo.workoutLogs) {
      await upsertWorkoutLog(userId, log);
    }

    for (const food of demo.foodLogs) {
      await upsertFoodLog(userId, food);
    }

    for (const body of demo.bodyMetricLogs) {
      await upsertBodyMetricLog(userId, body);
    }
  }

  return profile;
}

export async function fetchUserDataBundle(userId: string): Promise<UserDataBundle> {
  const supabase = getSupabaseBrowserClient();

  const { data: settingsRow, error: settingsError } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsError) {
    throw settingsError;
  }

  const { activePlan, planList } = await fetchPlanBundle(userId);

  const { data: workoutRows, error: workoutError } = await supabase
    .from("workout_logs")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false });

  if (workoutError) {
    throw workoutError;
  }

  const workoutIds = (workoutRows ?? []).map((row) => row.id);
  const { data: workoutExerciseRows, error: workoutExerciseError } = workoutIds.length
    ? await supabase
        .from("workout_log_exercises")
        .select("*")
        .in("workout_log_id", workoutIds)
    : { data: [], error: null };

  if (workoutExerciseError) {
    throw workoutExerciseError;
  }

  const { data: foodRows, error: foodError } = await supabase
    .from("food_logs")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false });

  if (foodError) {
    throw foodError;
  }

  const { data: bodyRows, error: bodyError } = await supabase
    .from("body_metric_logs")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false });

  if (bodyError) {
    throw bodyError;
  }

  return {
    snapshot: {
      settings: normalizeSettings(settingsRow as Record<string, unknown> | null, userId),
      trainingPlan: activePlan,
      workoutLogs: mapWorkoutLogs(
        (workoutRows ?? []) as Record<string, unknown>[],
        (workoutExerciseRows ?? []) as Record<string, unknown>[],
      ),
      foodLogs: mapFoodLogs((foodRows ?? []) as Record<string, unknown>[]),
      bodyMetricLogs: mapBodyLogs((bodyRows ?? []) as Record<string, unknown>[]),
      quickFoods: defaultQuickFoods,
    },
    planList,
  };
}

export async function exportUserData(userId: string): Promise<AppDataSnapshot> {
  const bundle = await fetchUserDataBundle(userId);
  return bundle.snapshot;
}

