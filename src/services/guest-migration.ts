import type { AppDataSnapshot, UserSettings } from "@/types";
import type { GuestAiHistoryState } from "@/lib/guest-mode";
import {
  appendAiGenerationHistoryForUser,
  fetchUserDataBundle,
  saveTrainingPlanAsInactive,
  upsertBodyMetricLog,
  upsertFoodLog,
  upsertUserSettings,
  upsertWorkoutLog,
} from "@/services/data-repository";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function pickNumber(target: number, guest: number): number {
  if (target > 0) {
    return target;
  }

  return guest > 0 ? guest : target;
}

function pickString(target: string, guest: string): string {
  if (target.trim()) {
    return target;
  }

  return guest.trim() ? guest.trim() : target;
}

function mergeSettingsForMigration(target: UserSettings, guest: UserSettings): UserSettings {
  return {
    ...target,
    gender: target.gender === "unknown" ? guest.gender : target.gender,
    age: pickNumber(target.age, guest.age),
    fitnessGoal: target.fitnessGoal === "fat_loss" ? guest.fitnessGoal : target.fitnessGoal,
    trainingExperience:
      target.trainingExperience === "beginner" ? guest.trainingExperience : target.trainingExperience,
    trainingLocation: target.trainingLocation === "mixed" ? guest.trainingLocation : target.trainingLocation,
    availableEquipment:
      target.availableEquipment.length > 0 ? target.availableEquipment : guest.availableEquipment,
    sessionDurationMinutes: pickNumber(target.sessionDurationMinutes, guest.sessionDurationMinutes),
    dietPreference: target.dietPreference === "none" ? guest.dietPreference : target.dietPreference,
    foodRestrictions: pickString(target.foodRestrictions, guest.foodRestrictions),
    injuryNotes: pickString(target.injuryNotes, guest.injuryNotes),
    lifestyleNotes: pickString(target.lifestyleNotes, guest.lifestyleNotes),
    height: pickNumber(target.height, guest.height),
    currentWeight: pickNumber(target.currentWeight, guest.currentWeight),
    targetWeight: pickNumber(target.targetWeight, guest.targetWeight),
    weeklyTrainingDays: pickNumber(target.weeklyTrainingDays, guest.weeklyTrainingDays),
    calorieTarget: pickNumber(target.calorieTarget, guest.calorieTarget),
    proteinTarget: pickNumber(target.proteinTarget, guest.proteinTarget),
    targetWeeklyLossMin: pickNumber(target.targetWeeklyLossMin, guest.targetWeeklyLossMin),
    targetWeeklyLossMax: pickNumber(target.targetWeeklyLossMax, guest.targetWeeklyLossMax),
    updatedAt: nowIso(),
  };
}

function clonePlanForUser(userId: string, snapshot: AppDataSnapshot) {
  const source = snapshot.trainingPlan;
  const planId = createId(`plan-${userId}-guest`);
  const idMap = new Map<string, string>([[source.id, planId]]);

  const cloned = {
    ...source,
    id: planId,
    userId,
    isActive: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    weeks: source.weeks.map((week, weekIndex) => {
      const weekId = `${planId}-w${week.weekNumber}-${weekIndex + 1}`;
      idMap.set(week.id, weekId);
      return {
        ...week,
        id: weekId,
        trainingPlanId: planId,
        days: week.days.map((day, dayIndex) => {
          const dayId = `${weekId}-d${day.dayNumber}-${dayIndex + 1}`;
          idMap.set(day.id, dayId);
          return {
            ...day,
            id: dayId,
            weekId,
            exercises: day.exercises.map((exercise, exerciseIndex) => ({
              ...exercise,
              id: `${dayId}-e${exerciseIndex + 1}`,
              dayId,
            })),
          };
        }),
      };
    }),
  };

  return { cloned, idMap };
}

function mapTrainingPlanId(oldPlanId: string, idMap: Map<string, string>): string {
  return idMap.get(oldPlanId) ?? oldPlanId;
}

export async function migrateGuestDataToUser(input: {
  userId: string;
  guestSnapshot: AppDataSnapshot;
  guestAiHistory: GuestAiHistoryState;
}): Promise<{
  migratedWorkoutLogs: number;
  migratedFoodLogs: number;
  migratedBodyLogs: number;
  migratedAiTraining: number;
  migratedAiNutrition: number;
}> {
  const { snapshot } = await fetchUserDataBundle(input.userId);
  const mergedSettings = mergeSettingsForMigration(snapshot.settings, input.guestSnapshot.settings);
  await upsertUserSettings(input.userId, mergedSettings);

  const trainingPlanMap = new Map<string, string>();
  if (input.guestSnapshot.trainingPlan.weeks.length > 0) {
    const { cloned, idMap } = clonePlanForUser(input.userId, input.guestSnapshot);
    trainingPlanMap.set(input.guestSnapshot.trainingPlan.id, cloned.id);
    for (const [from, to] of idMap.entries()) {
      trainingPlanMap.set(from, to);
    }
    await saveTrainingPlanAsInactive(input.userId, cloned);
  }

  for (const log of input.guestSnapshot.workoutLogs) {
    const workoutLogId = createId("workout-migrated");
    await upsertWorkoutLog(input.userId, {
      ...log,
      id: workoutLogId,
      userId: input.userId,
      trainingPlanId: mapTrainingPlanId(log.trainingPlanId, trainingPlanMap),
      createdAt: nowIso(),
      exercises: log.exercises.map((exercise) => ({
        ...exercise,
        id: createId("workout-ex"),
        workoutLogId,
      })),
    });
  }

  for (const log of input.guestSnapshot.foodLogs) {
    await upsertFoodLog(input.userId, {
      ...log,
      id: createId("food-migrated"),
      createdAt: nowIso(),
    });
  }

  for (const log of input.guestSnapshot.bodyMetricLogs) {
    await upsertBodyMetricLog(input.userId, {
      ...log,
      id: createId("body-migrated"),
      createdAt: nowIso(),
    });
  }

  if (input.guestAiHistory.training.length > 0 || input.guestAiHistory.nutrition.length > 0) {
    await appendAiGenerationHistoryForUser(input.userId, {
      training: input.guestAiHistory.training,
      nutrition: input.guestAiHistory.nutrition,
      profileSnapshot: mergedSettings as unknown as Record<string, unknown>,
    });
  }

  return {
    migratedWorkoutLogs: input.guestSnapshot.workoutLogs.length,
    migratedFoodLogs: input.guestSnapshot.foodLogs.length,
    migratedBodyLogs: input.guestSnapshot.bodyMetricLogs.length,
    migratedAiTraining: input.guestAiHistory.training.length,
    migratedAiNutrition: input.guestAiHistory.nutrition.length,
  };
}
