"use client";

import type { StateCreator } from "zustand";
import type { TrackerState } from "../use-tracker-store";
import type { AppDataSnapshot } from "@/types";
import {
  GUEST_USER_ID,
  defaultGuestSnapshot,
  hasMeaningfulGuestData,
  listFromPlan,
  normalizeSnapshotForUser,
  sortBodyLogs,
  sortFoodLogs,
  sortWorkoutLogs,
} from "../utils";

export type GuestSlice = Pick<
  TrackerState,
  "guestSnapshot" | "guestDataDirty" | "initializeGuestSession" | "hasGuestData" | "getGuestSnapshot" | "clearGuestData"
>;

export const createGuestSlice: StateCreator<TrackerState, [], [], GuestSlice> = (set, get) => ({
  guestSnapshot: null,
  guestDataDirty: false,
  initializeGuestSession: async () => {
    set({ loading: true, error: null, authMode: "guest", userId: GUEST_USER_ID });
    try {
      const baseSnapshot = get().guestSnapshot
        ? normalizeSnapshotForUser(get().guestSnapshot as AppDataSnapshot, GUEST_USER_ID)
        : normalizeSnapshotForUser(defaultGuestSnapshot, GUEST_USER_ID);
      const previousWeek = get().selectedWeek;
      const previousDay = get().selectedDay;
      const matchedWeek = baseSnapshot.trainingPlan.weeks.find(
        (week) => week.weekNumber === previousWeek,
      ) ?? baseSnapshot.trainingPlan.weeks[0];
      const matchedDay = matchedWeek?.days.find((day) => day.dayNumber === previousDay) ?? matchedWeek?.days[0];

      set({
        ...baseSnapshot,
        workoutLogs: sortWorkoutLogs(baseSnapshot.workoutLogs),
        foodLogs: sortFoodLogs(baseSnapshot.foodLogs),
        bodyMetricLogs: sortBodyLogs(baseSnapshot.bodyMetricLogs),
        trainingPlanList: listFromPlan(baseSnapshot.trainingPlan),
        guestSnapshot: baseSnapshot,
        userId: GUEST_USER_ID,
        authMode: "guest",
        selectedWeek: matchedWeek?.weekNumber ?? 1,
        selectedDay: matchedDay?.dayNumber ?? 1,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error(error);
      set({
        userId: GUEST_USER_ID,
        authMode: "guest",
        error: error instanceof Error ? error.message : "Failed to initialize guest session.",
        loading: false,
      });
    }
  },
  hasGuestData: () => {
    const state = get();
    if (state.guestDataDirty) {
      return true;
    }

    return hasMeaningfulGuestData(state.guestSnapshot);
  },
  getGuestSnapshot: () => get().guestSnapshot,
  clearGuestData: () => {
    set({
      guestSnapshot: null,
      guestDataDirty: false,
    });
  },
});
