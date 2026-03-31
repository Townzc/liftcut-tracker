import type { ExercisePlan, PlanDay, TrainingPlan } from "@/types";

export function createExerciseTemplate(index: number): ExercisePlan {
  return {
    id: `custom-ex-${index}`,
    name: "New Exercise",
    sets: 3,
    repRange: "8-12",
    targetRpe: 8,
    notes: "",
    alternativeExercises: [],
  };
}

function createPlanDay(dayNumber: number): PlanDay {
  return {
    dayNumber,
    title: `Day ${dayNumber}`,
    notes: "",
    exercises: [createExerciseTemplate(dayNumber)],
  };
}

export function createBlankTrainingPlan(name: string, weeks = 12, daysPerWeek = 3): TrainingPlan {
  return {
    id: `plan-${Date.now()}`,
    name,
    weeks: Array.from({ length: weeks }, (_, weekIndex) => ({
      weekNumber: weekIndex + 1,
      days: Array.from({ length: daysPerWeek }, (_, dayIndex) =>
        createPlanDay(dayIndex + 1),
      ),
    })),
  };
}