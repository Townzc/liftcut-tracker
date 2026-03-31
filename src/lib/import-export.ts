import { ZodError } from "zod";

import { appDataSnapshotSchema, getFirstZodError, trainingPlanSchema } from "@/lib/schemas";
import type { AppDataSnapshot, TrainingPlan } from "@/types";

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("JSON parse failed. Please check file format.");
  }
}

export function validateTrainingPlan(input: unknown): TrainingPlan {
  try {
    return trainingPlanSchema.parse(input);
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