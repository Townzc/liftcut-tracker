import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parsePendingWorkoutDraft, correctPendingWorkout, pendingWorkoutRequirements,
  resolveWorkoutFocus, workoutWorkflowBoundary, samePendingDraft } from "../packages/core/src/workout-draft-context";
import type { Session } from "../packages/core/src/today";

const unknown = { value: null, certainty: "unknown" } as const;
const stated = (value: number) => ({ value, certainty: "stated" as const });
function fixture() {
  const session: Session = { id: randomUUID(), userId: randomUUID(), revision: 1, status: "active", sets: [],
    prescription: { title: "Synthetic", exercises: [{ id: "row", name: "划船", sets: 6, repRange: "99", targetRpe: 10 }] },
    startedAt: "2026-10-21T00:00:00Z", endedAt: null, localDate: "2026-10-21", timezone: "UTC",
    trainingPlanId: randomUUID(), weekNumber: 1, dayNumber: 1 };
  const pending = parsePendingWorkoutDraft({ id: randomUUID(), owner: session.userId, sessionId: session.id, revision: 1,
    exerciseId: "row", state: "pending", sets: [{ load: { amount: unknown, unit: null, basis: "unspecified", reference: "previous_confirmed" },
      reps: unknown, rpe: { value: 8.5, certainty: "approximate" } }] });
  return { session, pending, focus: { kind: "pending" as const, id: pending.id, revision: 1 } };
}

test("pending correction changes only the draft; never synthesizes confirmed context", () => {
  const { session, pending, focus } = fixture(), before = structuredClone(pending);
  const next = correctPendingWorkout(session, focus, pending, 1, { rpe: { value: 6.5, certainty: "approximate" } });
  assert.equal(next.revision, 2); assert.equal(next.sets[0].rpe.value, 6.5);
  assert.deepEqual(next.sets[0].reps, unknown); assert.deepEqual(next.sets[0].load, pending.sets[0].load);
  assert.deepEqual(pending, before); assert.equal(session.sets.length, 0);
  assert.deepEqual(pendingWorkoutRequirements(next), ["reps_required", "quantity_uncertain", "confirmed_load_reference_required"]);
  assert.throws(() => resolveWorkoutFocus(session, focus, next), /STALE_PENDING_DRAFT/);
  assert.throws(() => resolveWorkoutFocus(session, focus, null), /PENDING_DRAFT_MISSING/);
  assert.throws(() => resolveWorkoutFocus({ ...session, userId: randomUUID() }, focus, pending), /STALE_PENDING_DRAFT/);
  assert.equal(samePendingDraft(next, before), false);
});

test("load reference, unknown and per-hand units remain distinct; no silent scalar fallback", () => {
  const { session, pending, focus } = fixture();
  const pounds = correctPendingWorkout(session, focus, pending, 1, { load: { amount: stated(33), unit: "lb", basis: "per_hand", reference: "literal" } });
  assert.equal(pounds.sets[0].load.unit, "lb"); assert.equal(pounds.sets[0].load.amount.value, 33);
  assert.ok(pendingWorkoutRequirements(pounds).includes("load_basis_storage_required"));
  assert.throws(() => correctPendingWorkout(session, focus, pending, 1,
    { load: { amount: stated(33), unit: "lb", basis: "unspecified", reference: "previous_confirmed" } }));
  assert.throws(() => correctPendingWorkout(session, focus, pending, 1, { reps: { value: 0, certainty: "unknown" } }));
  assert.throws(() => correctPendingWorkout(session, focus, pending, 1, { rpe: stated(12) }));
  assert.throws(() => correctPendingWorkout(session, focus, pending, 2, { reps: stated(5) }), /PENDING_SET_MISSING/);
  assert.throws(() => correctPendingWorkout(session, focus, pending, 1, { weight: 40 }));
});

test("a known partial preview can be clarified without filling missing fields from the plan", () => {
  const { session, pending, focus } = fixture();
  const partial = correctPendingWorkout(session, focus, pending, 1, { reps: stated(5), rpe: unknown,
    load: { amount: unknown, unit: null, reference: "unknown", basis: "unspecified" } });
  assert.deepEqual(pendingWorkoutRequirements(partial), []);
  assert.equal(partial.sets[0].load.amount.value, null); assert.equal(partial.sets[0].rpe.value, null);
  assert.equal(session.sets.length, 0); // Clarification is still not confirmation.
});

test("compound, invalidation, missing-set queries and per-hand input leave the atomic parser", () => {
  for (const text of ["余下动作有没有漏记", "右手单边33磅", "上一条作废，需要重做", "skip remaining sets", "finish? 结束"])
    assert.equal(workoutWorkflowBoundary(text), "agent_workflow");
  assert.equal(workoutWorkflowBoundary("划船 33 磅 11 次"), "atomic_candidate");
  // A preflight is not proof of semantics or authorization.
  assert.equal(workoutWorkflowBoundary("明天计划划船 33 磅"), "atomic_candidate");
});
