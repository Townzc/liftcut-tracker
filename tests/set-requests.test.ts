import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { tapSetRequest, voidSetRequest } from "@liftcut/core/set-requests";
import type { StoredSet } from "@liftcut/core/today";

const ids = { id: randomUUID(), sessionId: randomUUID(), planExerciseId: "bench", setIndex: 2 };
const untouched = { weight: false, reps: false };

test("an untouched prefill is confirmed, typed values are entered, unknown stays null", () => {
  const prefill = tapSetRequest({ ...ids, prefilled: true, changed: untouched, status: "done", weightKg: 60, reps: 5, rpe: null });
  assert.ok(prefill.success);
  assert.deepEqual([prefill.data.weightSource, prefill.data.repsSource, prefill.data.revision, prefill.data.rpe], ["user_confirmed_prefill", "user_confirmed_prefill", 1, null]);
  const typed = tapSetRequest({ ...ids, prefilled: true, changed: { weight: true, reps: false }, status: "done", weightKg: null, reps: 8, rpe: 8 });
  assert.ok(typed.success);
  assert.deepEqual([typed.data.weightKg, typed.data.weightSource, typed.data.repsSource, typed.data.rpe], [null, null, "user_confirmed_prefill", 8]);
  const fresh = tapSetRequest({ ...ids, prefilled: false, changed: untouched, status: "done", weightKg: 40, reps: 10, rpe: null });
  assert.equal(fresh.success && fresh.data.weightSource, "user_entered");
  // Reps are required for a completed set; nothing is invented to satisfy that.
  assert.equal(tapSetRequest({ ...ids, prefilled: false, changed: untouched, status: "done", weightKg: 40, reps: null, rpe: null }).success, false);
});

test("a skip carries no actuals, and a correction of a saved set keeps it user_entered at the next revision", () => {
  const skip = tapSetRequest({ ...ids, prefilled: true, changed: untouched, status: "skipped", weightKg: 60, reps: 5, rpe: 9 });
  assert.ok(skip.success);
  assert.deepEqual([skip.data.weightKg, skip.data.reps, skip.data.rpe, skip.data.weightSource, skip.data.repsSource], [null, null, null, null, null]);
  const saved: StoredSet = { ...ids, revision: 3, status: "done", weightKg: 60, reps: 5, rpe: null, weightSource: "user_confirmed_prefill", repsSource: "user_said", inputUnit: "kg", sourceRef: "cmd" };
  const correction = tapSetRequest({ ...ids, saved, prefilled: true, changed: { weight: false, reps: true }, status: "done", weightKg: 60, reps: 6, rpe: null });
  assert.ok(correction.success);
  assert.deepEqual([correction.data.revision, correction.data.weightSource, correction.data.repsSource, correction.data.sourceRef], [4, "user_entered", "user_entered", "today-tap"]);
});

test("undo is a compensating voided write with the same values at the next revision", () => {
  const saved = { ...ids, revision: 2, status: "done" as const, weightKg: null, reps: 8, rpe: null, weightSource: null, repsSource: "user_said" as const,
    inputUnit: "lb" as const, sourceRef: "cmd", exerciseName: "卧推", updatedAt: "2026-10-19T00:00:00Z" };
  assert.deepEqual(voidSetRequest(saved), { ...ids, revision: 3, status: "voided", weightKg: null, reps: 8, rpe: null,
    weightSource: null, repsSource: "user_entered", inputUnit: "kg", sourceRef: "today-tap" });
});
