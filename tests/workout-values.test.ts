import assert from "node:assert/strict";
import { test } from "node:test";
import { actualRpeSchema, normalizeExerciseActuals } from "@liftcut/core/workout-values";
import { createDemoSnapshot } from "../src/lib/demo-data";
import { validateAppSnapshot } from "../src/lib/import-export";
import { mapWorkoutLogs } from "../src/services/data-repository";
import { normalizeSnapshotForUser } from "../src/store/utils";
import { getPersonalRecords, getRecentPRs, getExerciseProgressData } from "../src/lib/pr-tracker";
import { useTrackerStore } from "../src/store/use-tracker-store";

test("unreported values normalize to null without coercing booleans or inventing zero", () => {
  for (const value of [null, undefined, "", "  "]) {
    assert.deepEqual(normalizeExerciseActuals({ actualWeight: value, actualReps: value, actualRpe: value }),
      { actualWeight: null, actualReps: null, actualRpe: null });
  }
  assert.deepEqual(normalizeExerciseActuals({ actualWeight: 0, actualReps: 0, actualRpe: "0" }),
    { actualWeight: 0, actualReps: 0, actualRpe: null });
  for (const value of [false, true, [], {}, NaN, Infinity, -1, "not a number"])
    assert.throws(() => normalizeExerciseActuals({ actualWeight: value }));
  assert.equal(actualRpeSchema.safeParse(11).success, false);
  assert.equal(actualRpeSchema.safeParse(0.5).success, false);
});

test("database reads preserve SQL null and reported zero, including numeric strings", () => {
  const [log] = mapWorkoutLogs([{ id: "log", user_id: "user", date: "2026-10-13" }], [
    { id: "ex1", workout_log_id: "log", actual_weight: null, actual_reps: "8", actual_rpe: null },
    { id: "ex2", workout_log_id: "log", actual_weight: "0", actual_reps: 0, actual_rpe: "0" },
    { id: "ex3", workout_log_id: "log" },
  ]);
  assert.deepEqual(log.exercises.map(e => [e.actualWeight, e.actualReps, e.actualRpe]),
    [[null, 8, null], [0, 0, null], [null, null, null]]);
});

test("JSON export/import and guest account normalization retain null, only legacy RPE zero is cleared", () => {
  const snapshot = createDemoSnapshot();
  const rows = snapshot.workoutLogs[0].exercises;
  Object.assign(rows[0], { actualWeight: null, actualReps: 8, actualRpe: null });
  Object.assign(rows[1], { actualWeight: 0, actualReps: 0, actualRpe: 0 });
  const imported = validateAppSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const migrated = normalizeSnapshotForUser(imported, "synthetic-owner");
  assert.deepEqual(migrated.workoutLogs[0].exercises.slice(0, 2).map(e => [e.actualWeight, e.actualReps, e.actualRpe]),
    [[null, 8, null], [0, 0, null]]);
  assert.equal(migrated.workoutLogs[0].userId, "synthetic-owner");
});

test("guest store save, JSON reload and edit do not fill in an empty actual RPE", async () => {
  const snapshot = createDemoSnapshot("guest-local");
  const log = snapshot.workoutLogs[0];
  log.exercises.forEach(e => Object.assign(e, { actualWeight: null, actualReps: 8, actualRpe: null }));
  const previous = useTrackerStore.getState();
  try {
    useTrackerStore.setState({ ...snapshot, authMode: "guest", userId: "guest-local", guestSnapshot: snapshot });
    await useTrackerStore.getState().addWorkoutLog(log);
    const saved = validateAppSnapshot(JSON.parse(JSON.stringify(useTrackerStore.getState().getSnapshot())));
    useTrackerStore.setState({ guestSnapshot: saved });
    await useTrackerStore.getState().initializeGuestSession();
    assert.ok(useTrackerStore.getState().workoutLogs.find(l => l.id === log.id)!.exercises.every(e =>
      e.actualWeight === null && e.actualReps === 8 && e.actualRpe === null));
  } finally { useTrackerStore.setState(previous, true); }
});

test("PR cards and progression skip incomplete measurements but do not require reported RPE", () => {
  const log = createDemoSnapshot().workoutLogs[0];
  const base = { ...log.exercises[0], name: "Synthetic squat", completed: true };
  log.completed = true;
  log.exercises = [
    { ...base, actualWeight: null, actualReps: 100, actualRpe: 10 },
    { ...base, actualWeight: 1000, actualReps: null, actualRpe: 10 },
    { ...base, actualWeight: 50, actualReps: 8, actualRpe: null },
  ];
  const [record] = getPersonalRecords([log]);
  assert.equal(record.maxWeight, 50); assert.equal(record.maxReps, 8);
  assert.equal(getExerciseProgressData([log], base.name)[0].maxWeight, 50);
  assert.equal(getRecentPRs([log]).length, 1);
  log.exercises = log.exercises.slice(0, 2);
  assert.deepEqual(getPersonalRecords([log]), []);
  assert.deepEqual(getRecentPRs([log]), []);
  assert.deepEqual(getExerciseProgressData([log], base.name), []);
});
