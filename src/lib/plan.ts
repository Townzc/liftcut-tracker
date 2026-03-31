import type { PlanDay, PlanWeek, TrainingPlan } from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

function createPlanDay(weekId: string, dayNumber: number): PlanDay {
  const dayId = `${weekId}-d${dayNumber}`;

  return {
    id: dayId,
    weekId,
    dayNumber,
    title: `Day ${dayNumber}`,
    notes: "",
    exercises: [],
  };
}

function createPlanWeek(trainingPlanId: string, weekNumber: number, daysPerWeek: number): PlanWeek {
  const weekId = `${trainingPlanId}-w${weekNumber}`;

  return {
    id: weekId,
    trainingPlanId,
    weekNumber,
    days: Array.from({ length: daysPerWeek }, (_, dayIndex) => createPlanDay(weekId, dayIndex + 1)),
  };
}

export function createBlankTrainingPlan(userId: string, name: string, weeks = 12, daysPerWeek = 3): TrainingPlan {
  const id = `plan-${userId}-${Date.now()}`;

  return {
    id,
    userId,
    name,
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    weeks: Array.from({ length: weeks }, (_, weekIndex) =>
      createPlanWeek(id, weekIndex + 1, daysPerWeek),
    ),
  };
}
