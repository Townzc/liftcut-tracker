import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { groundExercise, groundWorkout } from "../src/lib/coach-grounding";
import type { Session, SetLog } from "@liftcut/core/today";

// Synthetic API-boundary regressions, not private acceptance text or training.
function session(): Session {
  const id = randomUUID();
  const set = (exercise: string, index: number): SetLog => ({ id: randomUUID(), sessionId: id,
    planExerciseId: exercise, exerciseName: exercise, setIndex: index, revision: 3, status: "done",
    weightKg: 32.5, reps: 10, rpe: 6, inputUnit: "kg", weightSource: "user_entered",
    repsSource: "user_entered", sourceRef: "synthetic-input", updatedAt: "2026-10-21T00:00:00Z" });
  return { id, userId: randomUUID(), status: "active", revision: 1, localDate: "2026-10-21",
    timezone: "UTC", trainingPlanId: randomUUID(), weekNumber: 1, dayNumber: 1,
    startedAt: "2026-10-21T00:00:00Z", endedAt: null,
    prescription: { title: "Synthetic", exercises: [{ id: "row", name: "坐姿划船", sets: 12, repRange: "99", targetRpe: 10 },
      { id: "press", name: "杠铃卧推", sets: 12, repRange: "99", targetRpe: 10 }] },
    sets: [set("row", 1), set("row", 2), set("press", 1)] };
}
const proposal = { exerciseId: "row", kind: "record" as const, weightQuote: null as string | null,
  repsQuotes: ["9次"], rpeQuote: null as string | null, rpeScope: null as "last" | "each" | null,
  correctionSet: null as number | "last" | null };

test("standalone exercise memory enforces current roles too, with explicit historical dates allowed", () => {
  const p = { exerciseQuote: "坐姿划船", dateQuote: null as string | null, weightQuote: null as string | null,
    repsQuote: "9次", setsQuote: null as string | null, rpeQuote: null };
  const ground = (v: typeof p, ...texts: string[]) => groundExercise(v, texts, "2026-10-21");
  assert.throws(() => ground({ ...p, weightQuote: "32.5公斤" }, "坐姿划船32.5公斤10次", "坐姿划船9次"), /QUOTE_NOT/);
  assert.throws(() => ground({ ...p, repsQuote: "22" }, "坐姿划船22公斤"), /REPS_ROLE/);
  assert.throws(() => ground({ ...p, setsQuote: "2组" }, "坐姿划船第2组9次"), /SETS_ROLE/);
  for (const text of ["更正坐姿划船9次", "坐姿划船同样的重量9次", "坐姿划船左右各22公斤9次", "坐姿划船大概9次"])
    assert.throws(() => ground(p, text), /WORKOUT_/);
  const result = ground({ ...p, dateQuote: "2026-08-21", weightQuote: "32.5公斤" }, "2026-08-21坐姿划船32.5公斤9次");
  assert.equal(result.date, "2026-08-21");
  assert.equal(result.kind === "exercise" && result.weightKg, 32.5);
});

test("live workout proposals cannot borrow a load from chat history or from the plan", () => {
  const s = session(), input = "坐姿划船做了9次";
  assert.throws(() => groundWorkout({ ...proposal, weightQuote: "32.5公斤" }, ["坐姿划船32.5公斤10次", input], s), /QUOTE_NOT/);
  const result = groundWorkout(proposal, [input], s);
  assert.equal(result.draft.kind, "record");
  if (result.draft.kind === "record") assert.deepEqual(result.draft.sets.map(x => [x.weightKg, x.reps, x.rpe]), [[null, 9, null]]);
  // A symbolic reference must not silently degrade to an unknown load either.
  assert.throws(() => groundWorkout(proposal, ["坐姿划船同样的重量9次"], s), /CONFIRMED_REFERENCE/);
  assert.equal(groundWorkout({ ...proposal, weightQuote: "32.5公斤" },
    ["刚才那组坐姿划船我实打实做了9次，用的是32.5公斤，帮我记上"], s).draft.kind, "record");
});

test("a bare quote must still have the reps role; retracted loads cannot be selected", () => {
  const s = session();
  assert.throws(() => groundWorkout({ ...proposal, repsQuotes: ["22"] }, ["坐姿划船22公斤"], s), /REPS_ROLE/);
  assert.throws(() => groundWorkout({ ...proposal, weightQuote: "22公斤" }, ["坐姿划船不是22公斤，是25公斤，9次"], s), /WEIGHT_ROLE/);
  const result = groundWorkout({ ...proposal, weightQuote: "25公斤" }, ["坐姿划船不是22公斤，是25公斤，9次"], s);
  assert.equal(result.draft.kind === "record" && result.draft.sets[0].weightKg, 25);
});

test("correction ordinal and intent must be stated and bind an existing confirmed record", () => {
  const s = session(), p = { ...proposal, kind: "correct" as const, correctionSet: 22 };
  assert.throws(() => groundWorkout(p, ["更正坐姿划船，22公斤，9次"], s), /TARGET_ROLE/);
  assert.throws(() => groundWorkout({ ...p, correctionSet: 7 }, ["更正坐姿划船第7组9次"], s), /NOT_CONFIRMED/);
  assert.throws(() => groundWorkout({ ...p, correctionSet: 2 }, ["坐姿划船第2组9次"], s), /INTENT/);
  const before = structuredClone(s);
  const result = groundWorkout({ ...p, correctionSet: 2 }, ["更正坐姿划船第2组9次"], s);
  assert.equal(result.draft.kind, "correct");
  if (result.draft.kind === "correct") {
    assert.equal(result.draft.recordId, s.sets[1].id); assert.equal(result.draft.revision, 3);
    assert.deepEqual(result.draft.changes, { reps: 9 });
  }
  assert.deepEqual(s, before, "preparing a correction never writes");
  assert.throws(() => groundWorkout({ ...p, correctionSet: "last" }, ["更正坐姿划船9次"], s), /TARGET_ROLE/);
  assert.throws(() => groundWorkout(proposal, ["更正坐姿划船9次"], s), /CORRECTION_INTENT/);
  assert.throws(() => groundWorkout({ ...proposal, correctionSet: 2 }, ["坐姿划船9次"], s), /CORRECTION_INTENT/);
});

test("one quote is not multiple sets; explicit uniform sets and ordered individual reps work", () => {
  const s = session(), p = { ...proposal, repsQuotes: ["9次", "9次", "9次"] };
  assert.throws(() => groundWorkout(p, ["坐姿划船9次"], s), /SET_COUNT/);
  const result = groundWorkout(p, ["坐姿划船三组，每组9次"], s);
  assert.equal(result.draft.kind === "record" && result.draft.sets.length, 3);
  assert.throws(() => groundWorkout(proposal, ["坐姿划船三组，每组9次"], s), /SET_COUNT/);
  assert.throws(() => groundWorkout({ ...proposal, repsQuotes: ["8次", "9次"] }, ["坐姿划船9次、8次"], s), /SET_COUNT/);
  assert.equal(groundWorkout({ ...proposal, repsQuotes: ["9次", "8次"] }, ["坐姿划船9次、8次"], s).draft.kind, "record");
});

test("model-chosen exercise cannot override explicit text or an ambiguous exercise name", () => {
  const s = session();
  assert.throws(() => groundWorkout({ ...proposal, exerciseId: "press" }, ["坐姿划船9次"], s, "press"), /EXERCISE_NEEDS_REFERENCE/);
  assert.throws(() => groundWorkout(proposal, ["9次"], s), /EXERCISE_NEEDS_REFERENCE/);
  assert.equal(groundWorkout(proposal, ["9次"], s, "row").draft.kind, "record");
  s.prescription.exercises.push({ id: "dumbbell-row", name: "单臂哑铃划船", sets: 12, repRange: "99", targetRpe: 10 });
  assert.throws(() => groundWorkout(proposal, ["划船9次"], s, "row"), /EXERCISE_NEEDS_REFERENCE/);
});

test("uncertain, per-hand, multi-load and mixed workflows do not collapse into a scalar set", () => {
  const s = session();
  for (const text of ["坐姿划船9次，重量可能22公斤", "坐姿划船左右各22公斤，9次", "坐姿划船9次，剩余三组不做了",
    "坐姿划船单侧22公斤，9次", "昨天坐姿划船9次", "坐姿划船9次，RPE 6-8", "坐姿划船9次，不超过22公斤"])
    assert.throws(() => groundWorkout(proposal, [text], s), /WORKOUT_(?:QUANTITY_UNCERTAIN|WORKFLOW_REQUIRED)/);
  assert.throws(() => groundWorkout({ ...proposal, weightQuote: "22公斤", repsQuotes: ["9次", "7次"] },
    ["坐姿划船22公斤9次，再用25公斤7次"], s), /MULTIPLE_LOADS/);
  assert.throws(() => groundWorkout(proposal, ["坐姿划船第8组9次"], s), /SLOT_NEEDS_REFERENCE/);
  for (const text of ["坐姿划船9次合适吗", "坐姿划船没有完成9次", "坐姿划船没有做9次"])
    assert.throws(() => groundWorkout(proposal, [text], s), /ACTUAL_REPORT/);
});

test("retracted reps and a last-set effort cannot become every-set actuals", () => {
  const s = session();
  assert.throws(() => groundWorkout({ ...proposal, kind: "correct", correctionSet: 2, repsQuotes: ["7次"] },
    ["更正坐姿划船第2组9次，不是7次"], s), /REPS_ROLE/);
  const p = { ...proposal, repsQuotes: ["9次", "9次", "9次"], rpeQuote: "RPE 8", rpeScope: "each" as const };
  const text = "坐姿划船三组，每组9次，最后一组RPE 8";
  assert.throws(() => groundWorkout(p, [text], s), /RPE_SCOPE/);
  const result = groundWorkout({ ...p, rpeScope: "last" }, [text], s);
  assert.deepEqual(result.draft.kind === "record" && result.draft.sets.map(x => x.rpe), [null, null, 8]);
  assert.throws(() => groundWorkout(p, ["坐姿划船三组，每组9次，每组RPE 6，最后一组RPE 8"], s), /MULTIPLE_EFFORTS/);
});
