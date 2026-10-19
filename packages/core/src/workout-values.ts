import { z } from "zod";

// Coercing null, an empty input, or false with Number() would fabricate a zero.
function parseReportedNumber(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() === "" ? null : Number(value);
  return value;
}

export const actualWeightSchema = z.preprocess(
  parseReportedNumber, z.number().finite().min(0).max(1000).nullable(),
);
export const actualRepsSchema = z.preprocess(
  parseReportedNumber, z.number().finite().int().min(0).max(100).nullable(),
);
export const actualRpeSchema = z.preprocess((value) => {
  const parsed = parseReportedNumber(value);
  // The application's training RPE scale is 1–10. Legacy 0 was its empty sentinel.
  return parsed === 0 ? null : parsed;
}, z.number().finite().min(1).max(10).nullable());

export function normalizeExerciseActuals<T extends {
  actualWeight?: unknown; actualReps?: unknown; actualRpe?: unknown;
}>(exercise: T) {
  return {
    ...exercise,
    actualWeight: actualWeightSchema.parse(exercise.actualWeight),
    actualReps: actualRepsSchema.parse(exercise.actualReps),
    actualRpe: actualRpeSchema.parse(exercise.actualRpe),
  };
}
