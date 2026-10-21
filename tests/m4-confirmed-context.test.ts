import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { labelRoleProblems, numericRoleEvidence } from "../packages/core/src/parse-label-roles";
import { confirmReviewedSetDraft, previewInheritedWeight, previewSetCorrection, previewSetVoid,
  resolveConfirmedSet } from "../packages/core/src/confirmed-set-reference";
import type { Session, SetLog } from "../packages/core/src/today";

// Independently authored synthetic regressions. Maintainer acceptance utterances
// and their transformed variants must stay out of public fixtures and training.
const sessionId = randomUUID(), owner = randomUUID();
function set(exercise: string, index: number, weight: number | null): SetLog {
  return { id: randomUUID(), sessionId, planExerciseId: exercise, exerciseName: exercise,
    setIndex: index, revision: 1, status: "done", weightKg: weight, reps: 11, rpe: 6,
    weightSource: weight === null ? null : "user_entered", repsSource: "user_entered",
    inputUnit: "kg", sourceRef: "today-tap", updatedAt: "2026-10-21T00:00:00Z" };
}
function session(): Session {
  return { id: sessionId, userId: owner, status: "active", revision: 1,
    prescription: { title: "Synthetic", exercises: ["row", "curl"].map(id => ({ id, name: id, sets: 10, repRange: "99", targetRpe: 10 })) },
    sets: [set("row", 1, 37.5), set("row", 2, 42.5), set("curl", 1, 12.5)], localDate: "2026-10-21",
    timezone: "UTC", trainingPlanId: randomUUID(), weekNumber: 1, dayNumber: 1,
    startedAt: "2026-10-21T00:00:00Z", endedAt: null };
}

test("role gate rejects numbers borrowed from another role, unit or retracted value", () => {
  const text = "更正划船第5组，27磅，11次，RPE 6，不是13次";
  const correct = { intent: "correct", exercise: "划船", target: 5, changes: { weight: 27, unit: "lb", reps: 11, rpe: 6 } };
  assert.deepEqual(labelRoleProblems(text, correct, ["划船"]), []);
  for (const target of [27, 11, 6, 13]) assert.deepEqual(labelRoleProblems(text, { ...correct, target }), ["target_requires_ordinal"]);
  for (const changes of [{ weight: 11, unit: "lb" }, { weight: 27, unit: "kg" }, { reps: 27 }, { reps: 13 }, { rpe: 5 }])
    assert.ok(labelRoleProblems(text, { ...correct, changes }).length);
  assert.deepEqual(labelRoleProblems("剩下5组先跳过", { intent: "skip", exercise: null, target: 5 }), ["target_requires_ordinal"]);
  assert.deepEqual(labelRoleProblems("再来5组", { intent: "repeat", exercise: null, count: 5 }), []);
  assert.deepEqual(labelRoleProblems("5公斤再来", { intent: "repeat", exercise: null, count: 5 }), ["count_requires_sets"]);
});

test("evidence preserves normalized spans and separates repeated numbers", () => {
  const result = numericRoleEvidence("三头肌下压 第七组 七磅 七次 RPE七", ["三头肌下压"]);
  assert.deepEqual(result.evidence.map(e => [e.role, e.value]), [["ordinal", 7], ["weight", 7], ["reps", 7], ["rpe", 7]]);
  for (const e of result.evidence) assert.equal(result.normalizedSource.slice(e.start, e.end), e.text);
  assert.deepEqual(labelRoleProblems("25 lb, 9 reps, RPE 8", { intent: "record", exercise: null,
    sets: [{ weight: 25, unit: "lb", reps: 9, rpe: 8 }] }), []);
  for (const text of ["25 lb × 9", "25 lb 2 × 9"]) assert.deepEqual(labelRoleProblems(text, { intent: "record", exercise: null,
    sets: [{ weight: 25, unit: "lb", reps: 9, rpe: null }] }), []);
  assert.deepEqual(labelRoleProblems("correct fifth set to 4 reps", { intent: "correct", exercise: null, target: 5, changes: { reps: 4 } }), []);
  assert.ok(labelRoleProblems("不是25lb×9", { intent: "record", exercise: null,
    sets: [{ weight: 25, unit: "lb", reps: 9, rpe: null }] }).length);
  // A necessary numeric check deliberately does not claim semantic validity.
  assert.deepEqual(labelRoleProblems("计划 25 lb 9 reps", { intent: "record", exercise: null,
    sets: [{ weight: 25, unit: "lb", reps: 9, rpe: null }] }), []);
});

test("correction targets immutable identity and preserves omitted values; preview never mutates", () => {
  const s = session(), before = structuredClone(s), target = s.sets[0];
  const preview = previewSetCorrection(s, { exerciseId: "row", target: 1 }, { reps: 4 });
  assert.deepEqual(s, before);
  const [patch] = confirmReviewedSetDraft(s, preview, structuredClone(preview), "confirm_preview");
  assert.equal(patch.id, target.id); assert.equal(patch.revision, 2);
  assert.equal(patch.reps, 4); assert.equal(patch.weightKg, 37.5); assert.equal(patch.rpe, 6);
  assert.equal(preview.references[0].recordId, target.id);
  assert.throws(() => previewSetCorrection(s, { exerciseId: "row", target: 5 }, { reps: 4 }), /TARGET_NOT_CONFIRMED/);
  assert.throws(() => previewSetCorrection(s, { exerciseId: "row", target: 1 }, { reps: 4, extra: 8 } as never));
});

test("inherit explicit load from the named exercise, never global-last or plan; no implicit RPE", () => {
  const s = session(), p = previewInheritedWeight(s, "row", randomUUID(), 5);
  assert.equal(p.requests[0].weightKg, 42.5); assert.equal(p.requests[0].reps, 5);
  assert.equal(p.requests[0].rpe, null); assert.equal(p.requests[0].setIndex, 3);
  assert.equal(p.references[0].recordId, s.sets[1].id);
  assert.equal(p.requests[0].weightSource, "user_confirmed_prefill");
  s.sets[1].weightKg = null;
  assert.throws(() => previewInheritedWeight(s, "row", randomUUID(), 5), /SOURCE_WEIGHT_UNKNOWN/);
  assert.throws(() => resolveConfirmedSet(s, { exerciseId: "absent", target: "last" }), /EXERCISE_NOT_FOUND/);
});

test("pending draft references, stale revisions, other owners and edited previews cannot authorize", () => {
  const s = session(), p = previewSetCorrection(s, { exerciseId: "curl", target: 1 }, { rpe: 8 });
  assert.throws(() => confirmReviewedSetDraft(s, p, p, undefined as never), /CONFIRMATION_REQUIRED/);
  assert.throws(() => resolveConfirmedSet(s, { reference: { ...p.references[0], recordId: randomUUID() } }), /STALE_REFERENCE/);
  assert.throws(() => resolveConfirmedSet(s, { reference: { ...p.references[0], exerciseId: "row" } }), /STALE_REFERENCE/);
  assert.throws(() => confirmReviewedSetDraft({ ...s, userId: randomUUID() }, p, p, "confirm_preview"), /STALE_CONTEXT/);
  const edited = structuredClone(p); edited.requests[0].reps = 99;
  assert.throws(() => confirmReviewedSetDraft(s, p, edited, "confirm_preview"), /PREVIEW_CHANGED/);
  s.sets[2].revision++;
  assert.throws(() => resolveConfirmedSet(s, { reference: p.references[0] }), /STALE_REFERENCE/);
  assert.throws(() => confirmReviewedSetDraft(s, p, p, "confirm_preview"), /STALE_CONTEXT/);
});

test("void compensates the same record; redo cannot reuse its slot or infer new actuals", () => {
  const s = session(), p = previewSetVoid(s, { exerciseId: "row", target: "last" });
  const [voided] = confirmReviewedSetDraft(s, p, p, "confirm_preview");
  assert.equal(voided.id, s.sets[1].id); assert.equal(voided.status, "voided"); assert.equal(voided.revision, 2);
  s.sets[1] = { ...s.sets[1], ...voided };
  assert.throws(() => resolveConfirmedSet(s, { reference: { ...p.references[0], revision: 2 } }), /REFERENCE_NOT_DONE/);
  assert.throws(() => confirmReviewedSetDraft(s, p, p, "confirm_preview"), /STALE_CONTEXT/);
  assert.equal(previewInheritedWeight(s, "row", randomUUID(), 3).requests[0].setIndex, 3);
  assert.equal(s.sets.length, 3); // No redo written by void or preview.
});
