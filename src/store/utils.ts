"use client";

import {
  createDefaultSettings,
  createDemoTrainingPlan,
  getDefaultQuickFoods,
  isDefaultAvailableEquipment,
} from "@/lib/demo-data";
import { createAuthRequiredError } from "@/lib/error-utils";
import { GUEST_USER_ID } from "@/lib/guest-mode";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  AppDataSnapshot,
  BodyMetricLog,
  FoodLog,
  TrainingPlan,
  TrainingPlanSummary,
  WorkoutLog,
} from "@/types";
import { useUIStore } from "@/store/use-ui-store";

export { GUEST_USER_ID };

export function nowIso(): string {
  return new Date().toISOString();
}

export function safeRandomId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function createEmptySnapshot(userId: string): AppDataSnapshot {
  const language = useUIStore.getState().language;

  return {
    settings: createDefaultSettings(userId, language),
    trainingPlan: createDemoTrainingPlan(userId, language),
    workoutLogs: [],
    foodLogs: [],
    bodyMetricLogs: [],
    quickFoods: getDefaultQuickFoods(language),
  };
}

export function sortWorkoutLogs(logs: WorkoutLog[]): WorkoutLog[] {
  return [...logs].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.date.localeCompare(a.date);
  });
}

export function sortFoodLogs(logs: FoodLog[]): FoodLog[] {
  return [...logs].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.date.localeCompare(a.date);
  });
}

export function sortBodyLogs(logs: BodyMetricLog[]): BodyMetricLog[] {
  return [...logs].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.date.localeCompare(a.date);
  });
}

export function toTrainingPlanSummary(plan: TrainingPlan): TrainingPlanSummary {
  return {
    id: plan.id,
    userId: plan.userId,
    name: plan.name,
    notes: plan.notes || "",
    isActive: plan.isActive,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function listFromPlan(plan: TrainingPlan): TrainingPlanSummary[] {
  if (!plan.id || plan.weeks.length === 0) {
    return [];
  }

  return [{ ...toTrainingPlanSummary(plan), isActive: true }];
}

export function upsertSummaryList(
  list: TrainingPlanSummary[],
  nextItem: TrainingPlanSummary,
  options?: { setActive?: boolean },
): TrainingPlanSummary[] {
  const filtered = list.filter((item) => item.id !== nextItem.id);
  const normalizedNew = {
    ...nextItem,
    isActive: options?.setActive ? true : nextItem.isActive,
  };

  const merged = [normalizedNew, ...filtered].map((item) => {
    if (!options?.setActive) {
      return item;
    }

    return {
      ...item,
      isActive: item.id === normalizedNew.id,
    };
  });

  return merged;
}

export function normalizeSnapshotForUser(snapshot: AppDataSnapshot, userId: string): AppDataSnapshot {
  return {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      userId,
    },
    trainingPlan: {
      ...snapshot.trainingPlan,
      userId,
    },
    workoutLogs: snapshot.workoutLogs.map((log) => ({
      ...log,
      userId,
    })),
    foodLogs: snapshot.foodLogs.map((log) => ({
      ...log,
      userId,
    })),
    bodyMetricLogs: snapshot.bodyMetricLogs.map((log) => ({
      ...log,
      userId,
    })),
  };
}

export function createGuestSnapshotFromState(state: {
  settings: AppDataSnapshot["settings"];
  trainingPlan: AppDataSnapshot["trainingPlan"];
  workoutLogs: AppDataSnapshot["workoutLogs"];
  foodLogs: AppDataSnapshot["foodLogs"];
  bodyMetricLogs: AppDataSnapshot["bodyMetricLogs"];
  quickFoods: AppDataSnapshot["quickFoods"];
}): AppDataSnapshot {
  return normalizeSnapshotForUser(
    {
      settings: state.settings,
      trainingPlan: state.trainingPlan,
      workoutLogs: state.workoutLogs,
      foodLogs: state.foodLogs,
      bodyMetricLogs: state.bodyMetricLogs,
      quickFoods: state.quickFoods,
    },
    GUEST_USER_ID,
  );
}

export function hasMeaningfulGuestData(snapshot: AppDataSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }

  const hasSettings =
    snapshot.settings.gender !== "unknown" ||
    snapshot.settings.age > 0 ||
    snapshot.settings.height > 0 ||
    snapshot.settings.currentWeight > 0 ||
    snapshot.settings.targetWeight > 0 ||
    snapshot.settings.weeklyTrainingDays > 0 ||
    snapshot.settings.calorieTarget > 0 ||
    snapshot.settings.proteinTarget > 0 ||
    !isDefaultAvailableEquipment(snapshot.settings.availableEquipment) ||
    snapshot.settings.foodRestrictions.trim().length > 0 ||
    snapshot.settings.injuryNotes.trim().length > 0 ||
    snapshot.settings.lifestyleNotes.trim().length > 0;

  const hasLogs =
    snapshot.workoutLogs.length > 0 ||
    snapshot.foodLogs.length > 0 ||
    snapshot.bodyMetricLogs.length > 0;

  return hasSettings || hasLogs;
}

export function isGuestMode(state: { authMode: string; userId: string | null }): boolean {
  return state.authMode === "guest" || state.userId === GUEST_USER_ID;
}

export async function resolveUserId(userId: string | null): Promise<string> {
  if (userId && userId !== GUEST_USER_ID) {
    return userId;
  }

  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    if (error.message.toLowerCase().includes("auth session missing")) {
      throw createAuthRequiredError();
    }

    throw error;
  }

  if (!user) {
    throw createAuthRequiredError();
  }

  return user.id;
}

export const defaultSnapshot = createEmptySnapshot("demo-user");
export const defaultGuestSnapshot = createEmptySnapshot(GUEST_USER_ID);
