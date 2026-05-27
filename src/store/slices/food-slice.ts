"use client";

import type { StateCreator } from "zustand";
import type { TrackerState } from "../use-tracker-store";
import type { FoodLog } from "@/types";
import {
  isGuestMode,
  nowIso,
  safeRandomId,
  sortFoodLogs,
  createGuestSnapshotFromState,
} from "../utils";
import { upsertFoodLog, removeFoodLog } from "@/services/data-repository";

export type FoodSlice = Pick<
  TrackerState,
  "foodLogs" | "quickFoods" | "addFoodLog" | "updateFoodLog" | "deleteFoodLog"
>;

export const createFoodSlice: StateCreator<TrackerState, [], [], FoodSlice> = (set, get) => ({
  foodLogs: [],
  quickFoods: [],
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

    const nextLogs = sortFoodLogs([
      payload,
      ...previousLogs.filter((item) => item.id !== payload.id),
    ]);

    if (isGuestMode(get())) {
      set((state) => {
        const nextSnapshot = state.guestSnapshot
          ? {
              ...state.guestSnapshot,
              foodLogs: nextLogs,
            }
          : createGuestSnapshotFromState({
              ...state,
              foodLogs: nextLogs,
            } as TrackerState);
        return {
          foodLogs: nextLogs,
          guestSnapshot: nextSnapshot,
          guestDataDirty: true,
        };
      });
      return;
    }

    set({
      foodLogs: nextLogs,
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

    const nextLogs = sortFoodLogs([
      payload,
      ...previousLogs.filter((item) => item.id !== payload.id),
    ]);

    if (isGuestMode(get())) {
      set((state) => {
        const nextSnapshot = state.guestSnapshot
          ? {
              ...state.guestSnapshot,
              foodLogs: nextLogs,
            }
          : createGuestSnapshotFromState({
              ...state,
              foodLogs: nextLogs,
            } as TrackerState);
        return {
          foodLogs: nextLogs,
          guestSnapshot: nextSnapshot,
          guestDataDirty: true,
        };
      });
      return;
    }

    set({
      foodLogs: nextLogs,
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
    const nextLogs = previousLogs.filter((item) => item.id !== id);

    if (isGuestMode(get())) {
      set((state) => {
        const nextSnapshot = state.guestSnapshot
          ? {
              ...state.guestSnapshot,
              foodLogs: nextLogs,
            }
          : createGuestSnapshotFromState({
              ...state,
              foodLogs: nextLogs,
            } as TrackerState);
        return {
          foodLogs: nextLogs,
          guestSnapshot: nextSnapshot,
          guestDataDirty: true,
        };
      });
      return;
    }

    set({ foodLogs: nextLogs });

    try {
      await removeFoodLog(resolvedUserId, id);
    } catch (error) {
      set({ foodLogs: previousLogs });
      throw error;
    }
  },
});
