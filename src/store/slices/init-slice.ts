"use client";

import type { StateCreator } from "zustand";
import type { TrackerState } from "../use-tracker-store";
import type { AppDataSnapshot } from "@/types";
import {
  GUEST_USER_ID,
  createEmptySnapshot,
  isGuestMode,
  listFromPlan,
  normalizeSnapshotForUser,
  sortBodyLogs,
  sortFoodLogs,
  sortWorkoutLogs,
} from "../utils";
import {
  fetchUserDataBundle,
  saveTrainingPlan,
  upsertUserSettings,
} from "@/services/data-repository";

export type InitSlice = Pick<
  TrackerState,
  "initializeForUser" | "clearUserData" | "refreshUserData" | "resetAllData" | "getSnapshot"
>;

export const createInitSlice: StateCreator<TrackerState, [], [], InitSlice> = (set, get) => ({
  initializeForUser: async (userId) => {
    if (userId === GUEST_USER_ID || get().authMode === "guest") {
      await get().initializeGuestSession();
      return;
    }

    set({ loading: true, error: null, userId, authMode: "authenticated" });
    try {
      const bundle = await fetchUserDataBundle(userId);
      const previousWeek = get().selectedWeek;
      const previousDay = get().selectedDay;
      const matchedWeek = bundle.snapshot.trainingPlan.weeks.find((week) => week.weekNumber === previousWeek) ?? bundle.snapshot.trainingPlan.weeks[0];
      const matchedDay = matchedWeek?.days.find((day) => day.dayNumber === previousDay) ?? matchedWeek?.days[0];

      set((state) => ({
        ...bundle.snapshot,
        workoutLogs: sortWorkoutLogs(bundle.snapshot.workoutLogs),
        foodLogs: sortFoodLogs(bundle.snapshot.foodLogs),
        bodyMetricLogs: sortBodyLogs(bundle.snapshot.bodyMetricLogs),
        trainingPlanList: bundle.planList,
        selectedWeek: matchedWeek?.weekNumber ?? 1,
        selectedDay: matchedDay?.dayNumber ?? 1,
        loading: false,
        authMode: "authenticated",
        guestSnapshot: state.guestSnapshot,
      }));
    } catch (error) {
      console.error(error);
      set((state) => ({
        userId,
        authMode: "authenticated",
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
    set((state) => ({
      ...createEmptySnapshot("demo-user"),
      trainingPlanList: [],
      userId: null,
      authMode: "none",
      error: null,
      loading: false,
      selectedWeek: 1,
      selectedDay: 1,
      guestSnapshot: state.guestSnapshot,
      guestDataDirty: state.guestDataDirty,
    }));
  },
  refreshUserData: async () => {
    if (isGuestMode(get())) {
      await get().initializeGuestSession();
      return;
    }

    const resolvedUserId = await get().ensureUserId();
    await get().initializeForUser(resolvedUserId);
  },
  resetAllData: async () => {
    if (isGuestMode(get())) {
      const snapshot = normalizeSnapshotForUser(createEmptySnapshot(GUEST_USER_ID), GUEST_USER_ID);
      set({
        ...snapshot,
        workoutLogs: sortWorkoutLogs(snapshot.workoutLogs),
        foodLogs: sortFoodLogs(snapshot.foodLogs),
        bodyMetricLogs: sortBodyLogs(snapshot.bodyMetricLogs),
        trainingPlanList: listFromPlan(snapshot.trainingPlan),
        guestSnapshot: snapshot,
        guestDataDirty: true,
        selectedWeek: 1,
        selectedDay: 1,
        loading: false,
        error: null,
      });
      return;
    }

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
});
