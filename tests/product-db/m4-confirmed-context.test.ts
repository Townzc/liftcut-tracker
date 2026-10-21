import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { TodayStore } from "../../src/services/today/store";
import { previewInheritedWeight, previewSetCorrection, previewSetVoid, type ReviewedSetDraft } from "@liftcut/core/confirmed-set-reference";
import type { Session, SetRequest } from "@liftcut/core/today";
import { testUrl } from "./today-setup";

test("M4 internal approval port: confirmed context, concurrent retries, stale inheritance and compensation", async t => {
  const admin = new Pool({ connectionString: testUrl() }), url = new URL(testUrl());
  url.username = "liftcut_workout"; url.password = "w1b-local-fixture-only";
  const pool = new Pool({ connectionString: url.toString(), max: 6 }), store = new TodayStore(pool);
  const owner = randomUUID(), other = randomUUID(), plan = randomUUID(), day = randomUUID();
  const row = randomUUID(), curl = randomUUID();
  const confirm = (p: ReviewedSetDraft) => store.confirmReviewedSet(owner, p, structuredClone(p), "confirm_preview");
  let s: Session;
  try {
    await admin.query("insert into auth.users values($1),($2)", [owner, other]);
    await admin.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'M4 synthetic context',true)", [plan, owner]);
    await admin.query("insert into training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
    await admin.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'Synthetic')", [day, plan + "w"]);
    for (const [id, name] of [[row, "划船"], [curl, "弯举"]]) await admin.query(
      "insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,$3,12,'99',10)", [id, day, name]);
    s = await store.start(owner, { id: randomUUID(), dayId: day, timezone: "UTC" });
    const record = async (exercise: string, index: number, weight: number | null, reps: number) => {
      const request: SetRequest = { id: randomUUID(), sessionId: s.id, planExerciseId: exercise, setIndex: index,
        revision: 1, status: "done", weightKg: weight, reps, rpe: null, weightSource: weight === null ? null : "user_entered",
        repsSource: "user_entered", inputUnit: "kg", sourceRef: "today-tap" };
      s = await store.writeSet(owner, request); return request;
    };
    const first = await record(row, 1, 35, 11); await record(row, 2, 40, 9); await record(curl, 1, 15, 12);
    await t.test("preview changes nothing; only the confirmed ordinal is patched and retry creates one event", async () => {
      const before = await store.current(owner), p = previewSetCorrection(s, { exerciseId: row, target: 1 }, { reps: 7 });
      assert.deepEqual(await store.current(owner), before);
      await assert.rejects(store.confirmReviewedSet(owner, p, p, undefined as never), /INVALID_APPROVAL/);
      await assert.rejects(store.confirmReviewedSet(other, p, p, "confirm_preview"), /NOT_FOUND/);
      const results = await Promise.all([confirm(p), confirm(p), confirm(p)]); s = results[0];
      const corrected = s.sets.find(r => r.id === first.id)!;
      assert.equal(corrected.reps, 7); assert.equal(corrected.revision, 2); assert.equal(corrected.weightKg, 35);
      assert.equal(s.sets.length, 3); assert.equal((await store.trace(owner, first.id)).events.length, 2);
    });
    await t.test("same load binds the named exercise and rejects a source corrected after preview", async () => {
      const stale = previewInheritedWeight(s, row, randomUUID(), 4);
      assert.equal(stale.requests[0].weightKg, 40);
      s = await confirm(previewSetCorrection(s, { exerciseId: row, target: 2 }, { weightKg: 42.5 }));
      await assert.rejects(confirm(stale), /STALE_CONTEXT/);
      assert.equal((await store.current(owner))!.sets.length, 3);
      const fresh = previewInheritedWeight(s, row, randomUUID(), 4);
      await Promise.all([confirm(fresh), confirm(fresh)]); s = (await store.current(owner))!;
      const inherited = s.sets.find(r => r.id === fresh.requests[0].id)!;
      assert.equal(inherited.weightKg, 42.5); assert.equal(inherited.reps, 4); assert.equal(inherited.rpe, null);
      assert.equal(inherited.weightSource, "user_confirmed_prefill");
    });
    await t.test("void keeps its event history; separately confirmed redo is counted once", async () => {
      const p = previewSetVoid(s, { exerciseId: row, target: "last" });
      await Promise.all([confirm(p), confirm(p)]); s = (await store.current(owner))!;
      const voided = s.sets.find(r => r.id === p.requests[0].id)!;
      assert.equal(voided.status, "voided"); assert.equal(voided.revision, 2);
      assert.deepEqual((await store.trace(owner, voided.id)).events.map(e => e.type), ["recorded", "voided"]);
      // New reps explicitly supplied at a new approval; never infer a redo from "redo" alone.
      const redo = await record(row, 4, null, 3);
      await Promise.all([store.writeSet(owner, redo), store.writeSet(owner, redo)]);
      s = (await store.current(owner))!;
      assert.equal(s.sets.filter(r => r.status === "done").length, 4);
      assert.equal(s.sets.find(r => r.id === redo.id)!.weightKg, null);
      assert.equal((await store.trace(owner, redo.id)).events.length, 1);
      await assert.rejects(confirm(previewSetCorrection({ ...s, sets: s.sets.filter(r => r.id !== redo.id) },
        { exerciseId: row, target: 2 }, { reps: 1 })), /STALE_CONTEXT/);
    });
  } finally { await pool.end(); await admin.end(); }
});
