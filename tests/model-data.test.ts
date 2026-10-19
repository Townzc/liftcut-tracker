import assert from "node:assert/strict";
import { test } from "node:test";
import { allowModelObject, allowModelRows, MODEL_DATA, MODEL_DATA_HASH } from "@liftcut/core/model-data";
import { COACH_CONSENT_VERSION } from "../src/lib/coach-model";
import { planPersonalization } from "../src/lib/agent/plan-personalization";
import { memoryFacts } from "../src/lib/fitness-memory";
import { personalEntrySchema, type PersonalRecord } from "../src/lib/personal-records";

/** The list each consent version showed. A new list needs a new consent version, so users are asked again. */
const CONSENTED_LISTS: Record<string, string> = { "coach-model-v1": "60c6b0f2" };

test("the consent version matches the data list users agreed to", () => {
  assert.equal(CONSENTED_LISTS[COACH_CONSENT_VERSION], MODEL_DATA_HASH,
    "MODEL_DATA changed: bump COACH_CONSENT_VERSION and record the new hash in CONSENTED_LISTS");
});

test("unlisted fields and topics never pass; nested set lists are filtered, plan foods pass whole", () => {
  assert.deepEqual(allowModelRows("body", [{ id: "a", date: "2026-10-19", weightKg: 70, waistCm: null, note: "private", email: "x@y" }]),
    [{ id: "a", date: "2026-10-19", weightKg: 70, waistCm: null }]);
  assert.deepEqual(allowModelRows("workout", [{ id: "s", status: "ended", actualSets: [{ exercise: "深蹲", reps: 5, weightKg: 100, rpe: null, kind: "exercise", phone: "1" }] }]),
    [{ id: "s", status: "ended", actualSets: [{ exercise: "深蹲", reps: 5, weightKg: 100, rpe: null }] }]);
  const foods = [{ name: "鸡胸", grams: 150, calories: 200 }];
  assert.deepEqual(allowModelRows("nutrition", [{ plan: "P", mealType: "lunch", foods, secret: 1 }]), [{ plan: "P", mealType: "lunch", foods }]);
  assert.deepEqual(allowModelRows("settings", [{ email: "x@y" }]), []);
  assert.ok(MODEL_DATA.every(c => c.zh && c.en) && new Set(MODEL_DATA.map(c => c.id)).size === MODEL_DATA.length);
});

test("every field of a confirmed record and of a memory fact is listed, so filtering never silently drops data", () => {
  const listed = (topic: string) => MODEL_DATA.find(c => c.topics.includes(topic))!.fields;
  const topicOf = { body: "body", food: "food", exercise: "workout", preference: "memory" } as const;
  for (const option of personalEntrySchema.options) {
    const kind = option.shape.kind.value as keyof typeof topicOf;
    // Exercise entries reach the model inside a workout row's actualSets as exercise/weight/reps/sets/rpe.
    const keys = kind === "exercise" ? ["weightKg", "reps", "sets", "rpe"] : kind === "preference" ? [] : Object.keys(option.shape);
    for (const key of keys) assert.ok(listed(topicOf[kind]).includes(key), `${kind}.${key}`);
  }
  const record = (entry: PersonalRecord["entry"]) => ({ id: crypto.randomUUID(), entry, source: "manual", createdAt: "2026-10-19T00:00:00Z" }) as PersonalRecord;
  const facts = memoryFacts([record({ kind: "body", date: "2026-10-19", weightKg: 70, waistCm: 80 }),
    record({ kind: "exercise", date: "2026-10-19", exerciseName: "深蹲", weightKg: 100, reps: 5, sets: 3, rpe: 8 }),
    record({ kind: "preference", date: "2026-10-19", key: "injury", value: "左膝不适" })]);
  for (const fact of facts) for (const key of Object.keys(fact)) assert.ok(listed("memory").includes(key), `memory.${key}`);
  assert.deepEqual(allowModelRows("memory", facts), facts);
});

test("plan and workout tool results pass only listed keys; the planning basis keys are pinned to the consent text", () => {
  const memory = { version: 1 as const, kind: "training" as const, anchorDate: "2026-10-19", timezone: "UTC", facts: [], recentLoads: [], truncated: false };
  const p = planPersonalization({ fitness_goal: "fat_loss", age: 30, gender: "female", height: 165, injury_notes: "膝", food_restrictions: "花生", lifestyle_notes: "久坐" }, memory);
  // Adding a key here means describing it in MODEL_DATA's settings category and asking users again.
  assert.deepEqual(Object.keys(p), ["goal", "schedule", "equipment", "diet", "units", "body", "exerciseLoads", "recentLoads", "precautions", "profileContext", "truncated", "instruction"]);
  assert.deepEqual(Object.keys(p.profileContext), ["trainingExperience", "age", "heightCm", "gender", "lifestyleNotes", "calorieTarget", "proteinTarget", "weight"]);
  assert.deepEqual(Object.keys(p.precautions), ["confirmed", "injuryNotes", "foodRestrictions"]);
  assert.deepEqual(allowModelObject("plan_context", { kind: "training", personalization: p, email: "x@y" }), { kind: "training", personalization: p });
  assert.deepEqual(allowModelObject("current_workout", { id: "s", exercises: [{ id: "e", name: "深蹲", notes: "x" }], actualSets: [{ exerciseId: "e", reps: 5, status: "done", userId: "u" }] }),
    { id: "s", exercises: [{ id: "e", name: "深蹲" }], actualSets: [{ exerciseId: "e", reps: 5, status: "done" }] });
});
