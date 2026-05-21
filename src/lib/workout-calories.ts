import type { ExerciseLog, ExercisePlan } from "@/types";

export interface WorkoutCalorieInput {
  bodyWeightKg: number;
  durationMinutes: number;
  exercises: Array<Pick<ExerciseLog, "exercisePlanId" | "actualWeight" | "actualReps" | "actualRpe" | "completed">>;
  planExercises?: Array<Pick<ExercisePlan, "id" | "sets">>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateWorkoutCalories(input: WorkoutCalorieInput): number {
  const bodyWeightKg = input.bodyWeightKg > 0 ? input.bodyWeightKg : 75;
  const durationMinutes = input.durationMinutes > 0 ? input.durationMinutes : 45;
  const setsByExercise = new Map(input.planExercises?.map((exercise) => [exercise.id, exercise.sets]) ?? []);

  const activeExercises = input.exercises.filter((exercise) => exercise.completed);
  const sourceExercises = activeExercises.length > 0 ? activeExercises : input.exercises;
  if (sourceExercises.length === 0) {
    return 0;
  }

  const totals = sourceExercises.reduce(
    (acc, exercise) => {
      const sets = setsByExercise.get(exercise.exercisePlanId) ?? 3;
      const reps = exercise.actualReps > 0 ? exercise.actualReps : 8;
      const weight = exercise.actualWeight > 0 ? exercise.actualWeight : bodyWeightKg * 0.35;
      const rpe = exercise.actualRpe > 0 ? exercise.actualRpe : 7;

      acc.sets += sets;
      acc.volume += sets * reps * weight;
      acc.rpe += rpe;
      return acc;
    },
    { sets: 0, volume: 0, rpe: 0 },
  );

  const averageRpe = totals.rpe / sourceExercises.length;
  const volumeLoadRatio = totals.volume / Math.max(1, bodyWeightKg * 100);
  const densityRatio = totals.sets / Math.max(1, durationMinutes);
  const met =
    3.4 +
    clamp((averageRpe - 6) * 0.28, 0, 1.2) +
    clamp(volumeLoadRatio * 0.12, 0, 1.5) +
    clamp(densityRatio * 8, 0, 1.1);

  return Math.round((met * 3.5 * bodyWeightKg * durationMinutes) / 200);
}
