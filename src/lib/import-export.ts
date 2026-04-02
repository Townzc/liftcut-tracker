import { ZodError } from "zod";

import { appDataSnapshotSchema, getFirstZodError, trainingPlanSchema } from "@/lib/schemas";
import type { AppDataSnapshot, TrainingPlan } from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTrainingPlan(parsed: ReturnType<typeof trainingPlanSchema.parse>, userId = ""): TrainingPlan {
  const planId = parsed.id;
  const normalizedUserId = parsed.userId || userId;

  return {
    id: planId,
    userId: normalizedUserId,
    name: parsed.name,
    notes: parsed.notes || "",
    isActive: parsed.isActive,
    createdAt: parsed.createdAt || nowIso(),
    updatedAt: parsed.updatedAt || nowIso(),
    weeks: parsed.weeks.map((week, weekIndex) => {
      const weekId = week.id || `${planId}-w${week.weekNumber || weekIndex + 1}`;
      return {
        id: weekId,
        trainingPlanId: planId,
        weekNumber: week.weekNumber,
        days: week.days.map((day, dayIndex) => {
          const dayId = day.id || `${weekId}-d${day.dayNumber || dayIndex + 1}`;
          return {
            id: dayId,
            weekId,
            dayNumber: day.dayNumber,
            title: day.title,
            notes: day.notes || "",
            exercises: day.exercises.map((exercise, exerciseIndex) => ({
              id: exercise.id || `${dayId}-e${exerciseIndex + 1}`,
              dayId,
              name: exercise.name,
              sets: exercise.sets,
              repRange: exercise.repRange,
              targetRpe: exercise.targetRpe,
              notes: exercise.notes || "",
              alternativeExercises: exercise.alternativeExercises ?? [],
            })),
          };
        }),
      };
    }),
  };
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("JSON parse failed. Please check file format.");
  }
}

export function validateTrainingPlan(input: unknown, options?: { userId?: string }): TrainingPlan {
  try {
    const parsed = trainingPlanSchema.parse(input);
    return normalizeTrainingPlan(parsed, options?.userId);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Training plan format error: ${getFirstZodError(error)}`);
    }

    throw error;
  }
}

export function validateAppSnapshot(input: unknown): AppDataSnapshot {
  try {
    return appDataSnapshotSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Data format error: ${getFirstZodError(error)}`);
    }

    throw error;
  }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
