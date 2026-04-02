"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  createDefaultSettings,
  createDemoTrainingPlan,
  createEmptyTrainingPlan,
  defaultQuickFoods,
} from "@/lib/demo-data";
import { createAuthRequiredError } from "@/lib/error-utils";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  deleteTrainingPlan as removeTrainingPlan,
  fetchUserDataBundle,
  removeBodyMetricLog,
  removeFoodLog,
  saveTrainingPlan,
  setActiveTrainingPlan,
  upsertBodyMetricLog,
  upsertFoodLog,
  upsertUserSettings,
  upsertWorkoutLog,
} from "@/services/data-repository";
import type {
  AppDataSnapshot,
  BodyMetricLog,
  FoodLog,
  TrainingPlan,
  TrainingPlanSummary,
  UserSettings,
  WorkoutLog,
} from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

function safeRandomId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function createEmptySnapshot(userId: string): AppDataSnapshot {
  return {
    settings: createDefaultSettings(userId),
    trainingPlan: createDemoTrainingPlan(userId),
    workoutLogs: [],
    foodLogs: [],
    bodyMetricLogs: [],
    quickFoods: defaultQuickFoods,
  };
}

function sortWorkoutLogs(logs: WorkoutLog[]): WorkoutLog[] {
  return [...logs].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.date.localeCompare(a.date);
  });
}

function sortFoodLogs(logs: FoodLog[]): FoodLog[] {
  return [...logs].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.date.localeCompare(a.date);
  });
}

function sortBodyLogs(logs: BodyMetricLog[]): BodyMetricLog[] {
  return [...logs].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.date.localeCompare(a.date);
  });
}

function toTrainingPlanSummary(plan: TrainingPlan): TrainingPlanSummary {
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

function upsertSummaryList(
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

async function resolveUserId(userId: string | null): Promise<string> {
  if (userId) {
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

interface TrackerState extends AppDataSnapshot {
  trainingPlanList: TrainingPlanSummary[];
  userId: string | null;
  selectedWeek: number;
  selectedDay: number;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  ensureUserId: () => Promise<string>;
  markHydrated: () => void;
  setSelectedWeek: (weekNumber: number) => void;
  setSelectedDay: (dayNumber: number) => void;
  initializeForUser: (userId: string) => Promise<void>;
  clearUserData: () => void;
  refreshUserData: () => Promise<void>;
  updateSettings: (nextSettings: UserSettings) => Promise<void>;
  setTrainingPlan: (plan: TrainingPlan) => Promise<void>;
  setActivePlan: (planId: string) => Promise<void>;
  deleteTrainingPlan: (planId: string) => Promise<void>;
  addWorkoutLog: (workoutLog: Omit<WorkoutLog, "id" | "userId" | "createdAt"> & { id?: string }) => Promise<void>;
  updateWorkoutLog: (workoutLog: WorkoutLog) => Promise<void>;
  addFoodLog: (foodLog: Omit<FoodLog, "id" | "userId" | "createdAt"> & { id?: string }) => Promise<void>;
  updateFoodLog: (foodLog: Omit<FoodLog, "userId" | "createdAt">) => Promise<void>;
  deleteFoodLog: (id: string) => Promise<void>;
  addBodyMetricLog: (log: Omit<BodyMetricLog, "id" | "userId" | "createdAt"> & { id?: string }) => Promise<void>;
  updateBodyMetricLog: (log: BodyMetricLog) => Promise<void>;
  deleteBodyMetricLog: (id: string) => Promise<void>;
  resetAllData: () => Promise<void>;
  getSnapshot: () => AppDataSnapshot;
}

const defaultSnapshot = createEmptySnapshot("demo-user");

export const useTrackerStore = create<TrackerState>()(
  persist(
    (set, get) => ({
      ...defaultSnapshot,
      trainingPlanList: [],
      userId: null,
      selectedWeek: 1,
      selectedDay: 1,
      hydrated: false,
      loading: false,
      error: null,
      ensureUserId: async () => {
        const currentUserId = get().userId;
        const resolvedUserId = await resolveUserId(currentUserId);

        if (!currentUserId || currentUserId !== resolvedUserId) {
          set((state) => ({
            userId: resolvedUserId,
            settings: {
              ...state.settings,
              userId: resolvedUserId,
            },
          }));
        }

        return resolvedUserId;
      },
      markHydrated: () => set({ hydrated: true }),
      setSelectedWeek: (weekNumber) => set({ selectedWeek: weekNumber }),
      setSelectedDay: (dayNumber) => set({ selectedDay: dayNumber }),
      initializeForUser: async (userId) => {
        set({ loading: true, error: null, userId });
        try {
          const bundle = await fetchUserDataBundle(userId);
          const previousWeek = get().selectedWeek;
          const previousDay = get().selectedDay;
          const matchedWeek = bundle.snapshot.trainingPlan.weeks.find((week) => week.weekNumber === previousWeek) ?? bundle.snapshot.trainingPlan.weeks[0];
          const matchedDay = matchedWeek?.days.find((day) => day.dayNumber === previousDay) ?? matchedWeek?.days[0];

          set({
            ...bundle.snapshot,
            workoutLogs: sortWorkoutLogs(bundle.snapshot.workoutLogs),
            foodLogs: sortFoodLogs(bundle.snapshot.foodLogs),
            bodyMetricLogs: sortBodyLogs(bundle.snapshot.bodyMetricLogs),
            trainingPlanList: bundle.planList,
            selectedWeek: matchedWeek?.weekNumber ?? 1,
            selectedDay: matchedDay?.dayNumber ?? 1,
            loading: false,
          });
        } catch (error) {
          console.error(error);
          set((state) => ({
            userId,
            error: error instanceof Error ? error.message : "Failed to load user data.",
            loading: false,
            settings:
              state.settings.userId === userId
                ? state.settings
                : {
                    ...state.settings,
                    userId,
                  },
          }));
        }
      },
      clearUserData: () => {
        set({
          ...createEmptySnapshot("demo-user"),
          trainingPlanList: [],
          userId: null,
          error: null,
          loading: false,
          selectedWeek: 1,
          selectedDay: 1,
        });
      },
      refreshUserData: async () => {
        const resolvedUserId = await get().ensureUserId();
        await get().initializeForUser(resolvedUserId);
      },
      updateSettings: async (nextSettings) => {
        const resolvedUserId = await get().ensureUserId();
        const previousSettings = get().settings;

        const payload: UserSettings = {
          ...nextSettings,
          userId: resolvedUserId,
          updatedAt: nowIso(),
        };

        set({ settings: payload });

        try {
          await upsertUserSettings(resolvedUserId, payload);
        } catch (error) {
          set({ settings: previousSettings });
          throw error;
        }
      },
      setTrainingPlan: async (plan) => {
        const resolvedUserId = await get().ensureUserId();
        const previousPlan = get().trainingPlan;
        const previousList = get().trainingPlanList;

        const payload: TrainingPlan = {
          ...plan,
          userId: resolvedUserId,
          notes: plan.notes || "",
          isActive: true,
          updatedAt: nowIso(),
          createdAt: plan.createdAt || nowIso(),
        };

        const firstWeek = payload.weeks[0];
        const firstDay = firstWeek?.days[0];

        set({
          trainingPlan: payload,
          trainingPlanList: upsertSummaryList(previousList, toTrainingPlanSummary(payload), { setActive: true }),
          selectedWeek: firstWeek?.weekNumber ?? 1,
          selectedDay: firstDay?.dayNumber ?? 1,
        });

        try {
          await saveTrainingPlan(resolvedUserId, payload);
        } catch (error) {
          set({
            trainingPlan: previousPlan,
            trainingPlanList: previousList,
          });
          throw error;
        }
      },
      setActivePlan: async (planId) => {
        const resolvedUserId = await get().ensureUserId();
        const previousList = get().trainingPlanList;

        set({
          trainingPlanList: previousList.map((item) => ({
            ...item,
            isActive: item.id === planId,
          })),
        });

        try {
          await setActiveTrainingPlan(resolvedUserId, planId);
          if (get().trainingPlan.id !== planId) {
            await get().initializeForUser(resolvedUserId);
          }
        } catch (error) {
          set({ trainingPlanList: previousList });
          throw error;
        }
      },
      deleteTrainingPlan: async (planId) => {
        const resolvedUserId = await get().ensureUserId();
        const previousPlan = get().trainingPlan;
        const previousList = get().trainingPlanList;
        const previousWeek = get().selectedWeek;
        const previousDay = get().selectedDay;
        const nextList = previousList.filter((item) => item.id !== planId);

        set({ trainingPlanList: nextList });

        try {
          const result = await removeTrainingPlan(resolvedUserId, planId);

          if (!result.nextActivePlanId) {
            set({
              trainingPlan: createEmptyTrainingPlan(resolvedUserId),
              trainingPlanList: [],
              selectedWeek: 1,
              selectedDay: 1,
            });
            return;
          }

          if (previousPlan.id === planId || previousPlan.id !== result.nextActivePlanId) {
            await get().initializeForUser(resolvedUserId);
            return;
          }

          set((state) => ({
            trainingPlanList: state.trainingPlanList.map((item) => ({
              ...item,
              isActive: item.id === result.nextActivePlanId,
            })),
          }));
        } catch (error) {
          set({
            trainingPlan: previousPlan,
            trainingPlanList: previousList,
            selectedWeek: previousWeek,
            selectedDay: previousDay,
          });
          throw error;
        }
      },
      addWorkoutLog: async (workoutLog) => {
        const { trainingPlan, workoutLogs } = get();
        const resolvedUserId = await get().ensureUserId();

        const workoutLogId = workoutLog.id ?? safeRandomId("workout");
        const payload: WorkoutLog = {
          id: workoutLogId,
          userId: resolvedUserId,
          date: workoutLog.date,
          trainingPlanId: workoutLog.trainingPlanId || trainingPlan.id,
          weekNumber: workoutLog.weekNumber,
          dayNumber: workoutLog.dayNumber,
          durationMinutes: workoutLog.durationMinutes,
          completed: workoutLog.completed,
          notes: workoutLog.notes,
          createdAt: nowIso(),
          exercises: workoutLog.exercises.map((exercise, index) => ({
            id: exercise.id || `${workoutLogId}-ex-${index + 1}`,
            workoutLogId,
            exercisePlanId: exercise.exercisePlanId,
            name: exercise.name,
            actualWeight: exercise.actualWeight,
            actualReps: exercise.actualReps,
            actualRpe: exercise.actualRpe,
            completed: exercise.completed,
          })),
        };

        const nextLogs = sortWorkoutLogs([
          payload,
          ...workoutLogs.filter((item) => item.id !== payload.id),
        ]);
        set({ workoutLogs: nextLogs });

        try {
          await upsertWorkoutLog(resolvedUserId, payload);
        } catch (error) {
          set({ workoutLogs });
          throw error;
        }
      },
      updateWorkoutLog: async (workoutLog) => {
        await get().addWorkoutLog(workoutLog);
      },
      addFoodLog: async (foodLog) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().foodLogs;

        const payload: FoodLog = {
          id: foodLog.id ?? safeRandomId("food"),
          userId: resolvedUserId,
          date: foodLog.date,
          mealType: foodLog.mealType,
          foodName: foodLog.foodName,
          calories: foodLog.calories,
          protein: foodLog.protein,
          createdAt: nowIso(),
        };

        set({
          foodLogs: sortFoodLogs([
            payload,
            ...previousLogs.filter((item) => item.id !== payload.id),
          ]),
        });

        try {
          await upsertFoodLog(resolvedUserId, payload);
        } catch (error) {
          set({ foodLogs: previousLogs });
          throw error;
        }
      },
      updateFoodLog: async (foodLog) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().foodLogs;
        const existing = previousLogs.find((item) => item.id === foodLog.id);

        const payload: FoodLog = {
          id: foodLog.id,
          userId: resolvedUserId,
          date: foodLog.date,
          mealType: foodLog.mealType,
          foodName: foodLog.foodName,
          calories: foodLog.calories,
          protein: foodLog.protein,
          createdAt: existing?.createdAt ?? nowIso(),
        };

        set({
          foodLogs: sortFoodLogs([
            payload,
            ...previousLogs.filter((item) => item.id !== payload.id),
          ]),
        });

        try {
          await upsertFoodLog(resolvedUserId, payload);
        } catch (error) {
          set({ foodLogs: previousLogs });
          throw error;
        }
      },
      deleteFoodLog: async (id) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().foodLogs;
        set({ foodLogs: previousLogs.filter((item) => item.id !== id) });

        try {
          await removeFoodLog(resolvedUserId, id);
        } catch (error) {
          set({ foodLogs: previousLogs });
          throw error;
        }
      },
      addBodyMetricLog: async (log) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().bodyMetricLogs;

        const payload: BodyMetricLog = {
          id: log.id ?? safeRandomId("body"),
          userId: resolvedUserId,
          date: log.date,
          weight: log.weight,
          waist: log.waist,
          notes: log.notes ?? "",
          createdAt: nowIso(),
        };

        set({
          bodyMetricLogs: sortBodyLogs([
            payload,
            ...previousLogs.filter((item) => item.id !== payload.id),
          ]),
        });

        try {
          await upsertBodyMetricLog(resolvedUserId, payload);
        } catch (error) {
          set({ bodyMetricLogs: previousLogs });
          throw error;
        }
      },
      updateBodyMetricLog: async (log) => {
        await get().addBodyMetricLog(log);
      },
      deleteBodyMetricLog: async (id) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().bodyMetricLogs;
        set({ bodyMetricLogs: previousLogs.filter((item) => item.id !== id) });

        try {
          await removeBodyMetricLog(resolvedUserId, id);
        } catch (error) {
          set({ bodyMetricLogs: previousLogs });
          throw error;
        }
      },
      resetAllData: async () => {
        const resolvedUserId = await get().ensureUserId();

        const snapshot = createEmptySnapshot(resolvedUserId);
        await upsertUserSettings(resolvedUserId, snapshot.settings);
        await saveTrainingPlan(resolvedUserId, snapshot.trainingPlan);
        await get().refreshUserData();
      },
      getSnapshot: () => {
        const state = get();
        return {
          settings: state.settings,
          trainingPlan: state.trainingPlan,
          workoutLogs: state.workoutLogs,
          foodLogs: state.foodLogs,
          bodyMetricLogs: state.bodyMetricLogs,
          quickFoods: state.quickFoods,
        };
      },
    }),
    {
      name: "liftcut-tracker-ui-state",
      storage: typeof window !== "undefined" ? createJSONStorage(() => localStorage) : undefined,
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
      partialize: (state) => ({
        selectedWeek: state.selectedWeek,
        selectedDay: state.selectedDay,
      }),
    },
  ),
);
