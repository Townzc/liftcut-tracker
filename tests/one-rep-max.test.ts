import assert from "node:assert/strict";
import { test } from "node:test";
import { bestOf, bestOneRepMax, estimateOneRepMax, MAX_ESTIMATE_REPS, mergeBest, recordBroken } from "@liftcut/core/one-rep-max";
import { getOneRepMaxByExercise, getPersonalRecords, getRecentPRs, getExerciseProgressData } from "../src/lib/pr-tracker";
import type { WorkoutLog } from "@liftcut/core/types";

const set = (date: string, weightKg: number | null, reps: number | null) => ({ date, weightKg, reps });

test("estimates only from a confirmed load and 1–12 reps, returning the set used", () => {
  const source = set("2026-10-01", 60, 5);
  assert.deepEqual(estimateOneRepMax(source), { kg: 67.5, set: source });
  assert.equal(estimateOneRepMax(set("d", 100, 1))?.kg, 100);
  assert.equal(estimateOneRepMax(set("d", 50, MAX_ESTIMATE_REPS))?.kg, 72);
  for (const unusable of [set("d", 50, 13), set("d", 50, 40), set("d", null, 5), set("d", 60, null), set("d", 0, 5),
    set("d", -5, 5), set("d", 60, 0), set("d", 60, 4.5), { ...source, status: "skipped" as const }, { ...source, status: "voided" as const }])
    assert.equal(estimateOneRepMax(unusable), null, JSON.stringify(unusable));
});

test("best estimate keeps the earliest set on a tie and ignores sets it cannot estimate", () => {
  const sets = [set("2026-10-03", 70, 3), set("2026-10-01", 60, 5), set("2026-10-02", 40, 20), set("2026-10-04", null, 3)];
  const best = bestOneRepMax(sets);
  assert.equal(best?.kg, 74.1); assert.equal(best?.set, sets[0]);
  const tie = [set("2026-10-05", 100, 1), set("2026-10-02", 100, 1)];
  assert.equal(bestOneRepMax(tie)?.set, tie[1]);
  assert.equal(bestOneRepMax([set("2026-10-01", 20, 15)]), null);
  assert.equal(bestOneRepMax([]), null);
});

const log = (date: string, rows: [string, number | null, number | null][]): WorkoutLog => ({
  id: date, userId: "u", date, trainingPlanId: "p", weekNumber: 1, dayNumber: 1, durationMinutes: 40, completed: true, notes: "", createdAt: date,
  exercises: rows.map(([name, actualWeight, actualReps], i) => ({ id: `${date}-${i}`, workoutLogId: date, exercisePlanId: name, name,
    actualWeight, actualReps, actualRpe: null, completed: true })),
});

test("history: high-rep sets never produce or beat a 1RM; the estimate cites its set", () => {
  const logs = [log("2026-10-01", [["卧推", 60, 5], ["俯卧撑", 20, 15]]), log("2026-10-03", [["卧推", 40, 30]])];
  const byExercise = getOneRepMaxByExercise(logs);
  assert.deepEqual(byExercise.map(r => [r.exerciseName, r.estimate?.kg ?? null]), [["俯卧撑", null], ["卧推", 67.5]]);
  assert.deepEqual([byExercise[1].estimate?.set.date, byExercise[1].estimate?.set.weight, byExercise[1].estimate?.set.reps], ["2026-10-01", 60, 5]);
  // 40 kg × 30 used to compute 40 × 36 / 7 ≈ 205.7 kg; it is now not estimated at all.
  assert.equal(getPersonalRecords(logs).find(r => r.exerciseName === "卧推")?.bestEstimated1RM, 67.5);
  assert.equal(getPersonalRecords(logs).find(r => r.exerciseName === "俯卧撑")?.bestEstimated1RM, null);
  assert.ok(!getRecentPRs(logs, 10).some(pr => pr.type === "1rm" && pr.date === "2026-10-03"));
  assert.deepEqual(getExerciseProgressData(logs, "卧推").map(p => p.estimated1RM), [67.5, null]);
});

test("set records need a confirmed set that beats an earlier best", () => {
  const prior = bestOf([set("2026-10-01", 60, 5), set("2026-10-02", 62.5, 1), set("2026-10-03", 80, null), set("2026-10-04", 40, 30)]);
  assert.deepEqual(prior, { weightKg: 62.5, oneRepMaxKg: 67.5 }); // 80 kg without reps proves nothing.
  assert.deepEqual(recordBroken(set("d", 65, 3), prior), { kind: "weight", value: 65, previous: 62.5 });
  assert.deepEqual(recordBroken(set("d", 60, 6), prior), { kind: "one_rep_max", value: 69.7, previous: 67.5 });
  assert.deepEqual(recordBroken(set("d", 62.5, 5), prior), { kind: "one_rep_max", value: 70.3, previous: 67.5 }); // Same load, more reps.
  for (const no of [set("d", 62.5, 1), set("d", 60, 20), set("d", null, 8), set("d", 70, null), { ...set("d", 70, 5), status: "voided" as const }])
    assert.equal(recordBroken(no, prior), null, JSON.stringify(no));
  assert.equal(recordBroken(set("d", 100, 5), { weightKg: null, oneRepMaxKg: null }), null); // First-ever set is not a "record".
  assert.deepEqual(mergeBest({ weightKg: 60, oneRepMaxKg: null }, { weightKg: null, oneRepMaxKg: 70 }), { weightKg: 60, oneRepMaxKg: 70 });
});
