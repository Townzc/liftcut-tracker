"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDefaultSettings, createDemoTrainingPlan, defaultQuickFoods } from "@/lib/demo-data";
import {  fetchUserDataBundle,
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

function requireUserId(userId: string | null): string {
  if (!userId) {
    throw new Error("You need to sign in before editing data.");
  }

  return userId;
}

interface TrackerState extends AppDataSnapshot {
  trainingPlanList: TrainingPlanSummary[];
  userId: string | null;
  selectedWeek: number;
  selectedDay: number;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  markHydrated: () => void;
  setSelectedWeek: (weekNumber: number) => void;
  setSelectedDay: (dayNumber: number) => void;
  initializeForUser: (userId: string) => Promise<void>;
  clearUserData: () => void;
  refreshUserData: () => Promise<void>;
  updateSettings: (nextSettings: UserSettings) => Promise<void>;
  setTrainingPlan: (plan: TrainingPlan) => Promise<void>;
  setActivePlan: (planId: string) => Promise<void>;
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
            trainingPlanList: bundle.planList,
            selectedWeek: matchedWeek?.weekNumber ?? 1,
            selectedDay: matchedDay?.dayNumber ?? 1,
            loading: false,
          });
        } catch (error) {
          console.error(error);
          set({
            ...createEmptySnapshot(userId),
            trainingPlanList: [],
            error: error instanceof Error ? error.message : "Failed to load user data.",
            loading: false,
          });
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
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);
        await get().initializeForUser(resolvedUserId);
      },
      updateSettings: async (nextSettings) => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

        const payload: UserSettings = {
          ...nextSettings,
          userId: resolvedUserId,
          updatedAt: nowIso(),
        };

        set({ settings: payload });
        await upsertUserSettings(resolvedUserId, payload);
      },
      setTrainingPlan: async (plan) => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

        const payload: TrainingPlan = {
          ...plan,
          userId: resolvedUserId,
          isActive: true,
          updatedAt: nowIso(),
          createdAt: plan.createdAt || nowIso(),
        };

        set({ trainingPlan: payload });
        await saveTrainingPlan(resolvedUserId, payload);
        await get().refreshUserData();
      },
      setActivePlan: async (planId) => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

        await setActiveTrainingPlan(resolvedUserId, planId);
        await get().refreshUserData();
      },
      addWorkoutLog: async (workoutLog) => {
        const { userId, trainingPlan } = get();
        const resolvedUserId = requireUserId(userId);

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

        await upsertWorkoutLog(resolvedUserId, payload);
        await get().refreshUserData();
      },
      updateWorkoutLog: async (workoutLog) => {
        await get().addWorkoutLog(workoutLog);
      },
      addFoodLog: async (foodLog) => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

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

        await upsertFoodLog(resolvedUserId, payload);
        await get().refreshUserData();
      },
      updateFoodLog: async (foodLog) => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

        await upsertFoodLog(resolvedUserId, foodLog);
        await get().refreshUserData();
      },
      deleteFoodLog: async (id) => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

        await removeFoodLog(resolvedUserId, id);
        await get().refreshUserData();
      },
      addBodyMetricLog: async (log) => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

        const payload: BodyMetricLog = {
          id: log.id ?? safeRandomId("body"),
          userId: resolvedUserId,
          date: log.date,
          weight: log.weight,
          waist: log.waist,
          notes: log.notes ?? "",
          createdAt: nowIso(),
        };

        await upsertBodyMetricLog(resolvedUserId, payload);
        await get().refreshUserData();
      },
      updateBodyMetricLog: async (log) => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

        await upsertBodyMetricLog(resolvedUserId, log);
        await get().refreshUserData();
      },
      deleteBodyMetricLog: async (id) => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

        await removeBodyMetricLog(resolvedUserId, id);
        await get().refreshUserData();
      },
      resetAllData: async () => {
        const { userId } = get();
        const resolvedUserId = requireUserId(userId);

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
