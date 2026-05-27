"use client";

import type { StateCreator } from "zustand";
import type { TrackerState } from "../use-tracker-store";
import type { TrainingPlan } from "@/types";
import { createEmptyTrainingPlan } from "@/lib/demo-data";
import {
  GUEST_USER_ID,
  isGuestMode,
  listFromPlan,
  normalizeSnapshotForUser,
  nowIso,
  toTrainingPlanSummary,
  upsertSummaryList,
} from "../utils";
import {
  deleteTrainingPlan as removeTrainingPlan,
  saveTrainingPlan,
  setActiveTrainingPlan,
} from "@/services/data-repository";
import { useUIStore } from "@/store/use-ui-store";

export type PlanSlice = Pick<
  TrackerState,
  | "trainingPlan"
  | "trainingPlanList"
  | "selectedWeek"
  | "selectedDay"
  | "setTrainingPlan"
  | "setActivePlan"
  | "deleteTrainingPlan"
  | "setSelectedWeek"
  | "setSelectedDay"
>;

export const createPlanSlice: StateCreator<TrackerState, [], [], PlanSlice> = (set, get) => ({
  trainingPlan: undefined as unknown as TrackerState["trainingPlan"],
  trainingPlanList: [],
  selectedWeek: 1,
  selectedDay: 1,
  setSelectedWeek: (weekNumber) => set({ selectedWeek: weekNumber }),
  setSelectedDay: (dayNumber) => set({ selectedDay: dayNumber }),
  setTrainingPlan: async (plan) => {
    if (isGuestMode(get())) {
      const payload: TrainingPlan = {
        ...plan,
        userId: GUEST_USER_ID,
        notes: plan.notes || "",
        isActive: true,
        updatedAt: nowIso(),
        createdAt: plan.createdAt || nowIso(),
      };

      const firstWeek = payload.weeks[0];
      const firstDay = firstWeek?.days[0];
      set((state) => {
        const nextSnapshot = state.guestSnapshot
          ? {
              ...state.guestSnapshot,
              trainingPlan: payload,
            }
          : normalizeSnapshotForUser(
              {
                settings: state.settings,
                trainingPlan: payload,
                workoutLogs: state.workoutLogs,
                foodLogs: state.foodLogs,
                bodyMetricLogs: state.bodyMetricLogs,
                quickFoods: state.quickFoods,
              },
              GUEST_USER_ID,
            );
        return {
          trainingPlan: payload,
          trainingPlanList: listFromPlan(payload),
          selectedWeek: firstWeek?.weekNumber ?? 1,
          selectedDay: firstDay?.dayNumber ?? 1,
          guestSnapshot: nextSnapshot,
          guestDataDirty: true,
        };
      });
      return;
    }

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
    if (isGuestMode(get())) {
      const currentPlan = get().trainingPlan;
      if (currentPlan.id !== planId) {
        throw new Error("Guest mode currently supports a single active training plan.");
      }

      set((state) => ({
        trainingPlanList: state.trainingPlanList.map((item) => ({
          ...item,
          isActive: item.id === planId,
        })),
      }));
      return;
    }

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
    if (isGuestMode(get())) {
      const currentPlan = get().trainingPlan;
      if (currentPlan.id !== planId) {
        throw new Error("Training plan not found or already deleted.");
      }

      const emptyPlan = createEmptyTrainingPlan(GUEST_USER_ID, useUIStore.getState().language);
      set((state) => {
        const nextSnapshot = state.guestSnapshot
          ? {
              ...state.guestSnapshot,
              trainingPlan: emptyPlan,
            }
          : normalizeSnapshotForUser(
              {
                settings: state.settings,
                trainingPlan: emptyPlan,
                workoutLogs: state.workoutLogs,
                foodLogs: state.foodLogs,
                bodyMetricLogs: state.bodyMetricLogs,
                quickFoods: state.quickFoods,
              },
              GUEST_USER_ID,
            );

        return {
          trainingPlan: emptyPlan,
          trainingPlanList: [],
          selectedWeek: 1,
          selectedDay: 1,
          guestSnapshot: nextSnapshot,
          guestDataDirty: true,
        };
      });
      return;
    }

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
          trainingPlan: createEmptyTrainingPlan(resolvedUserId, useUIStore.getState().language),
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
});
