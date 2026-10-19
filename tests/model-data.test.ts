import assert from "node:assert/strict";
import { test } from "node:test";
import { allowModelRows, MODEL_DATA, MODEL_DATA_HASH } from "@liftcut/core/model-data";
import { COACH_CONSENT_VERSION } from "../src/lib/coach-model";
import { memoryFacts } from "../src/lib/fitness-memory";
import { personalEntrySchema, type PersonalRecord } from "../src/lib/personal-records";

/** The list each consent version showed. A new list needs a new consent version, so users are asked again. */
const CONSENTED_LISTS: Record<string, string> = { "coach-model-v1": "c62a75a7" };

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
