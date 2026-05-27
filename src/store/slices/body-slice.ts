"use client";

import type { StateCreator } from "zustand";
import type { TrackerState } from "../use-tracker-store";
import type { BodyMetricLog } from "@/types";
import {
  isGuestMode,
  nowIso,
  safeRandomId,
  sortBodyLogs,
  createGuestSnapshotFromState,
} from "../utils";
import { upsertBodyMetricLog, removeBodyMetricLog } from "@/services/data-repository";

export type BodySlice = Pick<
  TrackerState,
  "bodyMetricLogs" | "addBodyMetricLog" | "updateBodyMetricLog" | "deleteBodyMetricLog"
>;

export const createBodySlice: StateCreator<TrackerState, [], [], BodySlice> = (set, get) => ({
  bodyMetricLogs: [],
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

    const nextLogs = sortBodyLogs([
      payload,
      ...previousLogs.filter((item) => item.id !== payload.id),
    ]);

    if (isGuestMode(get())) {
      set((state) => {
        const nextSnapshot = state.guestSnapshot
          ? {
              ...state.guestSnapshot,
              bodyMetricLogs: nextLogs,
            }
          : createGuestSnapshotFromState({
              ...state,
              bodyMetricLogs: nextLogs,
            } as TrackerState);
        return {
          bodyMetricLogs: nextLogs,
          guestSnapshot: nextSnapshot,
          guestDataDirty: true,
        };
      });
      return;
    }

    set({
      bodyMetricLogs: nextLogs,
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
    const nextLogs = previousLogs.filter((item) => item.id !== id);

    if (isGuestMode(get())) {
      set((state) => {
        const nextSnapshot = state.guestSnapshot
          ? {
              ...state.guestSnapshot,
              bodyMetricLogs: nextLogs,
            }
          : createGuestSnapshotFromState({
              ...state,
              bodyMetricLogs: nextLogs,
            } as TrackerState);
        return {
          bodyMetricLogs: nextLogs,
          guestSnapshot: nextSnapshot,
          guestDataDirty: true,
        };
      });
      return;
    }

    set({ bodyMetricLogs: nextLogs });

    try {
      await removeBodyMetricLog(resolvedUserId, id);
    } catch (error) {
      set({ bodyMetricLogs: previousLogs });
      throw error;
    }
  },
});
