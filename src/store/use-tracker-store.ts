"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type {
  AppDataSnapshot,
  AuthMode,
  BodyMetricLog,
  FoodLog,
  TrainingPlan,
  TrainingPlanSummary,
  UserSettings,
  WorkoutLog,
} from "@/types";

import { defaultSnapshot } from "./utils";
import { createSessionSlice } from "./slices/session-slice";
import { createSettingsSlice } from "./slices/settings-slice";
import { createPlanSlice } from "./slices/plan-slice";
import { createWorkoutSlice } from "./slices/workout-slice";
import { createFoodSlice } from "./slices/food-slice";
import { createBodySlice } from "./slices/body-slice";
import { createGuestSlice } from "./slices/guest-slice";
import { createInitSlice } from "./slices/init-slice";

export interface TrackerState extends AppDataSnapshot {
  trainingPlanList: TrainingPlanSummary[];
  userId: string | null;
  authMode: AuthMode;
  guestSnapshot: AppDataSnapshot | null;
  guestDataDirty: boolean;
  selectedWeek: number;
  selectedDay: number;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  setAuthMode: (mode: AuthMode) => void;
  ensureUserId: () => Promise<string>;
  markHydrated: () => void;
  setSelectedWeek: (weekNumber: number) => void;
  setSelectedDay: (dayNumber: number) => void;
  initializeForUser: (userId: string) => Promise<void>;
  initializeGuestSession: () => Promise<void>;
  hasGuestData: () => boolean;
  getGuestSnapshot: () => AppDataSnapshot | null;
  clearGuestData: () => void;
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

export const useTrackerStore = create<TrackerState>()(
  persist(
    (set, get, store) => ({
      ...createSessionSlice(set, get, store),
      ...createSettingsSlice(set, get, store),
      ...createPlanSlice(set, get, store),
      ...createWorkoutSlice(set, get, store),
      ...createFoodSlice(set, get, store),
      ...createBodySlice(set, get, store),
      ...createGuestSlice(set, get, store),
      ...createInitSlice(set, get, store),
      ...defaultSnapshot,
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
        guestSnapshot: state.guestSnapshot,
        guestDataDirty: state.guestDataDirty,
      }),
    },
  ),
);
