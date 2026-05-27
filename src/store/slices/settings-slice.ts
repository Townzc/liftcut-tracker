"use client";

import type { StateCreator } from "zustand";
import type { TrackerState } from "../use-tracker-store";
import type { UserSettings } from "@/types";
import { GUEST_USER_ID, isGuestMode, normalizeSnapshotForUser, nowIso } from "../utils";
import { upsertUserSettings } from "@/services/data-repository";

export type SettingsSlice = Pick<TrackerState, "settings" | "updateSettings">;

export const createSettingsSlice: StateCreator<TrackerState, [], [], SettingsSlice> = (set, get) => ({
  settings: undefined as unknown as TrackerState["settings"],
  updateSettings: async (nextSettings) => {
    if (isGuestMode(get())) {
      const payload: UserSettings = {
        ...nextSettings,
        userId: GUEST_USER_ID,
        updatedAt: nowIso(),
      };

      set((state) => {
        const nextSnapshot = state.guestSnapshot
          ? {
              ...state.guestSnapshot,
              settings: payload,
            }
          : normalizeSnapshotForUser(
              {
                settings: payload,
                trainingPlan: state.trainingPlan,
                workoutLogs: state.workoutLogs,
                foodLogs: state.foodLogs,
                bodyMetricLogs: state.bodyMetricLogs,
                quickFoods: state.quickFoods,
              },
              GUEST_USER_ID,
            );

        return {
          settings: payload,
          guestSnapshot: nextSnapshot,
          guestDataDirty: true,
        };
      });
      return;
    }

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
});
