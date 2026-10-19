import type { TrainingPlan, WorkoutLog } from "@liftcut/core/types";
import { localDateAt } from "@liftcut/core/today";

/** A plan day is a training slot, not a weekday. Calendar time never completes it. */
export function currentPlanProgress(plan: TrainingPlan, logs: WorkoutLog[], now: Date, timezone: string) {
  const days = [...plan.weeks].sort((a, b) => a.weekNumber - b.weekNumber).flatMap(week =>
    [...week.days].sort((a, b) => a.dayNumber - b.dayNumber).map(day => ({ ...day, weekNumber: week.weekNumber })));
  const key = (week: number, day: number) => `${week}:${day}`;
  const recorded = new Set(logs.filter(log => log.userId === plan.userId && log.trainingPlanId === plan.id && log.completed &&
    log.exercises.some(exercise => exercise.completed &&
      [exercise.actualWeight, exercise.actualReps, exercise.actualRpe].some(value => typeof value === "number" && Number.isFinite(value))))
    .map(log => key(log.weekNumber, log.dayNumber)));
  const recordedDays = days.filter(day => recorded.has(key(day.weekNumber, day.dayNumber)));
  const nextDay = days.find(day => !recorded.has(key(day.weekNumber, day.dayNumber))) ?? null;
  const totalDays = Math.max(0, ...plan.weeks.map(week => week.weekNumber)) * 7;
  const started = new Date(plan.createdAt);
  const startDate = Number.isFinite(started.getTime()) ? localDateAt(started, timezone) : null;
  // Compare local calendar dates in UTC, so a DST day need not be 24 hours long.
  const elapsed = startDate ? Math.floor((Date.parse(localDateAt(now, timezone)) - Date.parse(startDate)) / 86400000) + 1 : null;
  const calendarDay = elapsed === null ? null : Math.min(totalDays, Math.max(0, elapsed));
  return { days, recorded, recordedDays: recordedDays.length, nextDay, totalDays, startDate, calendarDay,
    cycleEnded: elapsed !== null && elapsed > totalDays, key };
}
