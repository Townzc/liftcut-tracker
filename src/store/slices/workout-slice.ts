"use client";

import type { StateCreator } from "zustand";
import type { TrackerState } from "../use-tracker-store";
import type { WorkoutLog } from "@/types";
import {
  isGuestMode,
  nowIso,
  safeRandomId,
  sortWorkoutLogs,
  createGuestSnapshotFromState,
} from "../utils";
import { upsertWorkoutLog } from "@/services/data-repository";

export type WorkoutSlice = Pick<TrackerState, "workoutLogs" | "addWorkoutLog" | "updateWorkoutLog">;

export const createWorkoutSlice: StateCreator<TrackerState, [], [], WorkoutSlice> = (set, get) => ({
  workoutLogs: [],
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

    if (isGuestMode(get())) {
      set((state) => {
        const nextSnapshot = state.guestSnapshot
          ? {
              ...state.guestSnapshot,
              workoutLogs: nextLogs,
            }
          : createGuestSnapshotFromState({
              ...state,
              workoutLogs: nextLogs,
            } as TrackerState);
        return {
          workoutLogs: nextLogs,
          guestSnapshot: nextSnapshot,
          guestDataDirty: true,
        };
      });
      return;
    }

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
});
