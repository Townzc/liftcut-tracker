"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDemoSnapshot } from "@/lib/demo-data";
import type {
  AppDataSnapshot,
  BodyMetricLog,
  FoodLog,
  TrainingPlan,
  UserSettings,
  WorkoutLog,
} from "@/types";

const demoSnapshot = createDemoSnapshot();

function safeRandomId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

interface TrackerState extends AppDataSnapshot {
  selectedWeek: number;
  selectedDay: number;
  hydrated: boolean;
  setSelectedWeek: (weekNumber: number) => void;
  setSelectedDay: (dayNumber: number) => void;
  updateSettings: (nextSettings: UserSettings) => void;
  setTrainingPlan: (plan: TrainingPlan) => void;
  addWorkoutLog: (workoutLog: Omit<WorkoutLog, "id"> & { id?: string }) => void;
  updateWorkoutLog: (workoutLog: WorkoutLog) => void;
  addFoodLog: (foodLog: Omit<FoodLog, "id"> & { id?: string }) => void;
  updateFoodLog: (foodLog: FoodLog) => void;
  deleteFoodLog: (id: string) => void;
  addBodyMetricLog: (log: Omit<BodyMetricLog, "id"> & { id?: string }) => void;
  updateBodyMetricLog: (log: BodyMetricLog) => void;
  deleteBodyMetricLog: (id: string) => void;
  importAllData: (snapshot: AppDataSnapshot) => void;
  resetAllData: () => void;
  markHydrated: () => void;
  getSnapshot: () => AppDataSnapshot;
}

export const useTrackerStore = create<TrackerState>()(
  persist(
    (set, get) => ({
      ...demoSnapshot,
      selectedWeek: 1,
      selectedDay: 1,
      hydrated: false,
      setSelectedWeek: (weekNumber) =>
        set({
          selectedWeek: weekNumber,
        }),
      setSelectedDay: (dayNumber) =>
        set({
          selectedDay: dayNumber,
        }),
      updateSettings: (nextSettings) =>
        set({
          settings: nextSettings,
        }),
      setTrainingPlan: (plan) =>
        set({
          trainingPlan: plan,
          selectedWeek: plan.weeks[0]?.weekNumber ?? 1,
          selectedDay: plan.weeks[0]?.days[0]?.dayNumber ?? 1,
        }),
      addWorkoutLog: (workoutLog) =>
        set((state) => ({
          workoutLogs: [
            ...state.workoutLogs.filter((item) => item.id !== workoutLog.id),
            { ...workoutLog, id: workoutLog.id ?? safeRandomId("workout") },
          ],
        })),
      updateWorkoutLog: (workoutLog) =>
        set((state) => ({
          workoutLogs: state.workoutLogs.map((item) =>
            item.id === workoutLog.id ? workoutLog : item,
          ),
        })),
      addFoodLog: (foodLog) =>
        set((state) => ({
          foodLogs: [
            ...state.foodLogs,
            { ...foodLog, id: foodLog.id ?? safeRandomId("food") },
          ],
        })),
      updateFoodLog: (foodLog) =>
        set((state) => ({
          foodLogs: state.foodLogs.map((item) =>
            item.id === foodLog.id ? foodLog : item,
          ),
        })),
      deleteFoodLog: (id) =>
        set((state) => ({
          foodLogs: state.foodLogs.filter((item) => item.id !== id),
        })),
      addBodyMetricLog: (log) =>
        set((state) => ({
          bodyMetricLogs: [
            ...state.bodyMetricLogs.filter((item) => item.date !== log.date),
            { ...log, id: log.id ?? safeRandomId("body") },
          ],
        })),
      updateBodyMetricLog: (log) =>
        set((state) => ({
          bodyMetricLogs: state.bodyMetricLogs.map((item) =>
            item.id === log.id ? log : item,
          ),
        })),
      deleteBodyMetricLog: (id) =>
        set((state) => ({
          bodyMetricLogs: state.bodyMetricLogs.filter((item) => item.id !== id),
        })),
      importAllData: (snapshot) =>
        set({
          ...snapshot,
        }),
      resetAllData: () =>
        set({
          ...createDemoSnapshot(),
          selectedWeek: 1,
          selectedDay: 1,
        }),
      markHydrated: () => set({ hydrated: true }),
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
      name: "liftcut-tracker-storage",
      storage:
        typeof window !== "undefined"
          ? createJSONStorage(() => localStorage)
          : undefined,
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
      partialize: (state) => ({
        settings: state.settings,
        trainingPlan: state.trainingPlan,
        workoutLogs: state.workoutLogs,
        foodLogs: state.foodLogs,
        bodyMetricLogs: state.bodyMetricLogs,
        quickFoods: state.quickFoods,
        selectedWeek: state.selectedWeek,
        selectedDay: state.selectedDay,
      }),
    },
  ),
);

