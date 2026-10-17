import { test } from "node:test";
import assert from "node:assert/strict";
import { currentPlanProgress } from "../src/lib/current-plan";
import type { TrainingPlan, WorkoutLog } from "../src/types";

function fixture(): TrainingPlan {
  return { id: "plan-a", userId: "owner-a", name: "Synthetic 12 weeks", notes: "", isActive: true,
    createdAt: "2026-03-07T17:00:00Z", updatedAt: "2026-03-07T17:00:00Z",
    weeks: Array.from({ length: 12 }, (_, w) => ({ id: `w${w+1}`, trainingPlanId: "plan-a", weekNumber: w+1,
      days: Array.from({ length: 3 }, (_, d) => ({ id: `w${w+1}d${d+1}`, weekId: `w${w+1}`, dayNumber: d+1, title: `Day ${d+1}`, notes: "", exercises: [] })) })) };
}
function log(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return { id: "session-a", userId: "owner-a", date: "2026-03-07", trainingPlanId: "plan-a", weekNumber: 1, dayNumber: 1,
    durationMinutes: 30, completed: true, notes: "", createdAt: "2026-03-07T17:00:00Z", exercises: [{ id: "set-a", workoutLogId: "session-a", exercisePlanId: "ex-a", name: "Squat", actualWeight: null, actualReps: 8, actualRpe: null, completed: true }], ...overrides };
}
test("12 weeks means 84 calendar days and 36 training slots; no recorded work is inferred", () => {
  const progress = currentPlanProgress(fixture(), [], new Date("2026-03-07T19:00:00Z"), "America/Los_Angeles");
  assert.equal(progress.totalDays, 84); assert.equal(progress.calendarDay, 1); assert.equal(progress.days.length, 36);
  assert.equal(progress.recordedDays, 0); assert.equal(progress.nextDay?.id, "w1d1");
});
test("calendar days use local dates across both DST changes and Shanghai midnight", () => {
  const plan = fixture();
  assert.equal(currentPlanProgress(plan, [], new Date("2026-03-09T16:00:00Z"), "America/Los_Angeles").calendarDay, 3);
  plan.createdAt = "2026-10-31T16:00:00Z";
  assert.equal(currentPlanProgress(plan, [], new Date("2026-11-02T17:00:00Z"), "America/Los_Angeles").calendarDay, 3);
  plan.createdAt = "2026-10-16T15:59:00Z";
  const now = new Date("2026-10-16T16:01:00Z");
  assert.equal(currentPlanProgress(plan, [], now, "Asia/Shanghai").calendarDay, 2);
  assert.equal(currentPlanProgress(plan, [], now, "America/Los_Angeles").calendarDay, 1);
});
test("missing workouts remain next even after calendar progress reaches its limit", () => {
  const progress = currentPlanProgress(fixture(), [], new Date("2027-01-01T00:00:00Z"), "UTC");
  assert.equal(progress.calendarDay, 84); assert.equal(progress.cycleEnded, true); assert.equal(progress.nextDay?.id, "w1d1");
});
test("only ended, reported workouts count, deduplicated by plan training day and isolated by owner", () => {
  const incomplete = log({ completed: false, dayNumber: 2 });
  const unknown = log({ dayNumber: 3 }); unknown.exercises[0].actualReps = null;
  const voided = log({ dayNumber: 3 }); voided.exercises[0].completed = false;
  const logs = [log(), log({ id: "repeat" }), incomplete, unknown, voided, log({ userId: "owner-b", dayNumber: 2 }),
    log({ trainingPlanId: "old-plan", dayNumber: 2 }), log({ weekNumber: 99 })];
  const progress = currentPlanProgress(fixture(), logs, new Date("2026-03-07T19:00:00Z"), "UTC");
  assert.equal(progress.recordedDays, 1); assert.equal(progress.nextDay?.id, "w1d2");
});
test("undo or removing the only real set reopens that training day", () => {
  const entry = log();
  assert.equal(currentPlanProgress(fixture(), [entry], new Date(), "UTC").recordedDays, 1);
  entry.exercises = [];
  assert.equal(currentPlanProgress(fixture(), [entry], new Date(), "UTC").recordedDays, 0);
});
test("sorts training slots without mutating state and retains unknown start date", () => {
  const plan = fixture(); plan.weeks.reverse(); plan.weeks.forEach(week => week.days.reverse()); plan.createdAt = "unknown";
  const before = JSON.stringify(plan), progress = currentPlanProgress(plan, [], new Date(), "UTC");
  assert.equal(progress.nextDay?.id, "w1d1"); assert.equal(progress.calendarDay, null); assert.equal(progress.startDate, null);
  assert.equal(JSON.stringify(plan), before);
  plan.createdAt = "2030-01-01T00:00:00Z";
  assert.equal(currentPlanProgress(plan, [], new Date("2026-01-01"), "UTC").calendarDay, 0);
});
test("recording every training slot leaves no invented next workout", () => {
  const plan = fixture(), logs = plan.weeks.flatMap(week => week.days.map(day => log({ weekNumber: week.weekNumber, dayNumber: day.dayNumber })));
  const progress = currentPlanProgress(plan, logs, new Date(), "UTC");
  assert.equal(progress.recordedDays, 36); assert.equal(progress.nextDay, null);
});
