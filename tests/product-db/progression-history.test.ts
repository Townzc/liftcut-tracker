import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { nextTarget, ruleForExercise } from "@liftcut/core/progression";
import { TodayStore } from "../../src/services/today/store";
import type { SetRequest } from "../../src/lib/today";
import { testUrl } from "./today-setup";

test("today load returns owner-only ended history with every set status and all-time bests", async () => {
  const admin = new Pool({ connectionString: testUrl() }), target = new URL(testUrl());
  target.username = "liftcut_workout"; target.password = "w1b-local-fixture-only";
  const pool = new Pool({ connectionString: target.toString() }), store = new TodayStore(pool);
  const [user, other] = [randomUUID(), randomUUID()], name = `进阶历史-${randomUUID().slice(0, 8)}`;
  const plan = (owner: string) => ({ plan: randomUUID(), day: randomUUID(), day2: randomUUID(), exercise: randomUUID(), owner });
  const mine = plan(user), theirs = plan(other);
  try {
    await admin.query("insert into auth.users values($1),($2)", [user, other]);
    for (const p of [mine, theirs]) {
      await admin.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Synthetic progression',true)", [p.plan, p.owner]);
      await admin.query("insert into public.training_plan_weeks values($1,$2,1)", [p.plan + "w", p.plan]);
      await admin.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$3,1,'A'),($2,$3,2,'B')", [p.day, p.day2, p.plan + "w"]);
      await admin.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,$3,3,'5',8),($4,$5,$6,3,'8-12',8)",
        [p.exercise, p.day, name, randomUUID(), p.day2, `${name}-B`]);
    }
    // A legacy log counts toward the all-time best but is not a session for the engine.
    await admin.query("insert into public.workout_logs(id,user_id,date,training_plan_id,week_number,day_number,duration_minutes,completed) values($1,$2,'2026-10-01',$1,1,1,30,true)", [mine.plan, user]);
    await admin.query("insert into public.workout_log_exercises(id,workout_log_id,exercise_plan_id,name,actual_weight,actual_reps,actual_rpe,completed) values($1,$2,$3,$4,70,2,null,true)",
      [randomUUID(), mine.plan, mine.exercise, name]);
    const session = async (p: typeof mine, sets: [number, SetRequest["status"], number | null, number | null][], end = true) => {
      const id = randomUUID(); await store.start(p.owner, { id, dayId: p.day, timezone: "UTC" });
      for (const [setIndex, status, weightKg, reps] of sets) await store.writeSet(p.owner, { id: randomUUID(), sessionId: id, planExerciseId: p.exercise,
        setIndex, revision: 1, status, weightKg, reps, rpe: null, weightSource: weightKg === null ? null : "user_entered",
        repsSource: reps === null ? null : "user_entered", inputUnit: "kg", sourceRef: "today-tap" });
      if (end) await store.end(p.owner, { id, revision: 2, status: "ended" });
    };
    await session(theirs, [[1, "done", 100, 5]]);
    await session(mine, [[1, "done", 60, 5], [2, "done", 60, 5], [3, "skipped", null, null]]);
    await session(mine, [[1, "done", 80, 5]], false); // Active: never history yet.
    const { history } = await store.load(user);
    assert.deepEqual(Object.keys(history!).sort(), [name, `${name}-B`].sort());
    const h = history![name];
    assert.equal(h.sessions.length, 1);
    assert.deepEqual(h.sessions[0].sets, [{ setIndex: 1, status: "done", weightKg: 60, reps: 5 },
      { setIndex: 2, status: "done", weightKg: 60, reps: 5 }, { setIndex: 3, status: "skipped", weightKg: null, reps: null }]);
    assert.deepEqual(h.best, { weightKg: 70, oneRepMaxKg: 72 }); // Legacy 70 × 2; the other user's 100 kg is invisible.
    assert.deepEqual(history![`${name}-B`], { sessions: [], best: { weightKg: null, oneRepMaxKg: null } });
    const t = nextTarget(ruleForExercise({ sets: 3, repRange: "5" })!, h.sessions);
    assert.deepEqual([t.outcome, t.weight, t.miss], ["baseline", 60, { set: 3, reason: "skipped" }]);
  } finally {
    await admin.query("delete from auth.users where id=any($1::uuid[])", [[user, other]]);
    await pool.end(); await admin.end();
  }
});
