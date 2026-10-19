import assert from "node:assert/strict";
import { test } from "node:test";
import { levelOf, trainingCalendar } from "@liftcut/core/training-calendar";
import { sessionsToWorkoutLogs, type Session } from "@liftcut/core/today";

const row = (completed: boolean, recordedSets?: number) => ({ id: "r", workoutLogId: "w", exercisePlanId: "e", name: "深蹲",
  actualWeight: 60, actualReps: 5, actualRpe: null, completed, ...(recordedSets === undefined ? {} : { recordedSets }) });
const day = (cal: ReturnType<typeof trainingCalendar>, date: string) => cal.weeks.flat().find(d => d?.date === date);

test("weeks run Monday to Sunday, end with today's week, and never include days after today", () => {
  const cal = trainingCalendar([], "2026-10-19"); // A Monday.
  assert.equal(cal.weeks.length, 53);
  assert.deepEqual(cal.weeks[52].map(d => d?.date ?? null), ["2026-10-19", null, null, null, null, null, null]);
  assert.equal(cal.weeks[0][0]!.date, "2025-10-20");
  assert.deepEqual([cal.trainedDays, cal.sets, cal.unknownDays], [0, 0, 0]);
  const leap = trainingCalendar([], "2028-03-01", 2); // Crosses 29 February.
  assert.deepEqual(leap.weeks[1].slice(0, 3).map(d => d?.date), ["2028-02-28", "2028-02-29", "2028-03-01"]);
});

test("only confirmed completed rows count; a row without a set count marks the day without inventing sets", () => {
  const logs = [
    { date: "2026-10-12", exercises: [row(true, 1), row(true, 1), row(false, 1)] },
    { date: "2026-10-12", exercises: [row(true, 1)] }, // A second workout on the same day adds up.
    { date: "2026-10-14", exercises: [row(true), row(true)] }, // Older log: completed, set count unknown.
    { date: "2026-10-20", exercises: [row(true, 1)] }, // After today: not shown.
  ];
  const cal = trainingCalendar(logs, "2026-10-19");
  assert.deepEqual(day(cal, "2026-10-12"), { date: "2026-10-12", sets: 3, unknownRows: 0, level: 1 });
  assert.deepEqual(day(cal, "2026-10-14"), { date: "2026-10-14", sets: 0, unknownRows: 2, level: 1 });
  assert.equal(day(cal, "2026-10-13")!.level, 0);
  assert.deepEqual([cal.trainedDays, cal.sets, cal.unknownDays], [2, 3, 1]);
  assert.deepEqual([0, 1, 5, 6, 11, 12, 19, 20].map(n => levelOf(n, 0)), [0, 1, 1, 2, 2, 3, 3, 4]);
});

test("sessions count their done sets on the session's own local date; skipped and voided sets never count", () => {
  const set = (status: "done" | "skipped" | "voided", setIndex: number) => ({ id: `s${setIndex}`, sessionId: "a", planExerciseId: "e", setIndex, revision: 1, status,
    weightKg: 60, reps: 5, rpe: null, weightSource: "user_entered", repsSource: "user_entered", inputUnit: "kg", sourceRef: "today-tap", exerciseName: "深蹲", updatedAt: "" });
  // Started at 23:30 in Shanghai on the 18th and ended after local midnight: the workout stays on its own local date.
  const session = { id: "a", userId: "u", trainingPlanId: "p", dayId: "d", weekNumber: 1, dayNumber: 1, localDate: "2026-10-18", timezone: "Asia/Shanghai",
    status: "ended", revision: 4, prescription: { title: "A", exercises: [] }, startedAt: "2026-10-18T15:30:00Z", endedAt: "2026-10-18T16:30:00Z",
    sets: [set("done", 1), set("done", 2), set("skipped", 3), set("voided", 4)] } as unknown as Session;
  const cal = trainingCalendar(sessionsToWorkoutLogs([session]), "2026-10-19");
  assert.deepEqual(day(cal, "2026-10-18"), { date: "2026-10-18", sets: 2, unknownRows: 0, level: 1 });
  assert.equal(day(cal, "2026-10-19")!.sets, 0); // The UTC date of endedAt does not move the workout.
});
