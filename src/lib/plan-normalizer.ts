import type { ParsedPlan } from "@/lib/plan-import-schema";
import type { TrainingPlan } from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeParsedPlanToTrainingPlan(
  parsed: ParsedPlan,
  options: { userId: string; name?: string },
): TrainingPlan {
  const id = `plan-${options.userId}-${Date.now()}`;

  return {
    id,
    userId: options.userId,
    name: options.name?.trim() || parsed.name,
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    weeks: parsed.weeks.map((week) => {
      const weekId = `${id}-w${week.weekNumber}`;

      return {
        id: weekId,
        trainingPlanId: id,
        weekNumber: week.weekNumber,
        days: week.days.map((day) => {
          const dayId = `${weekId}-d${day.dayNumber}`;

          return {
            id: dayId,
            weekId,
            dayNumber: day.dayNumber,
            title: day.title,
            notes: day.notes || "",
            exercises: day.exercises.map((exercise, index) => ({
              id: `${dayId}-e${index + 1}`,
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