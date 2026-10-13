// Real local PostgreSQL migration/round-trip evidence; synthetic auth.uid(), not hosted GoTrue.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { mapWorkoutLogs } from "../../src/services/data-repository";

test("nullable migration preserves legacy facts, supports null round trips and keeps owner RLS", async () => {
  const url = process.env.W1A_TEST_DATABASE_URL;
  if (!url) throw new Error("W1A_TEST_DATABASE_URL must name a fresh disposable local database");
  const target = new URL(url);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.match(target.pathname, /^\/liftcut_p1_w1a_[a-z0-9_]+$/);
  const db = new Pool({ connectionString: url });
  try {
    assert.equal((await db.query("select to_regclass('public.workout_logs') as t")).rows[0].t, null,
      "Use a fresh database; existing data must not be overwritten");
    await db.query((await readFile("tests/agent-db/bootstrap.sql", "utf8")).replace(/^\uFEFF/, ""));
    await db.query((await readFile("supabase/schema.sql", "utf8")).replace(/^\uFEFF/, ""));
    // Recreate the legacy constraints before testing the forward migration.
    await db.query(`alter table workout_log_exercises alter actual_weight set not null,
      alter actual_reps set not null, alter actual_rpe set not null`);
    const owner = "22222222-2222-4222-8222-222222222222";
    await db.query("insert into auth.users values($1)", [owner]);
    await db.query(`insert into workout_logs(id,user_id,date,training_plan_id,week_number,day_number,duration_minutes,completed,notes)
      values('w1a-log',$1,'2026-10-13','synthetic-plan',1,1,60,true,'Synthetic W1a fixture')`, [owner]);
    await db.query(`insert into workout_log_exercises(id,workout_log_id,exercise_plan_id,name,actual_weight,actual_reps,actual_rpe)
      values('legacy-zero','w1a-log','synthetic-ex','Legacy zero',0,0,0),
      ('target-equal','w1a-log','synthetic-ex','Do not guess',50,8,8)`);
    await assert.rejects(db.query(`insert into workout_log_exercises(id,workout_log_id,exercise_plan_id,name,actual_weight,actual_reps,actual_rpe)
      values('before','w1a-log','synthetic-ex','Unknown',null,8,null)`), { code: "23502" });
    const policiesBefore = (await db.query("select policyname,qual,with_check from pg_policies where tablename in ('workout_logs','workout_log_exercises') order by policyname")).rows;
    const migration = await readFile("supabase/migrations/20261013234503_unknown_workout_actuals.sql", "utf8");
    await db.query(migration);
    await db.query(migration); // Repeatable; no extra destructive cleanup.
    const legacy = (await db.query("select id,actual_weight,actual_reps,actual_rpe from workout_log_exercises order by id")).rows;
    assert.deepEqual(legacy, [
      { id: "legacy-zero", actual_weight: "0", actual_reps: 0, actual_rpe: null },
      { id: "target-equal", actual_weight: "50", actual_reps: 8, actual_rpe: "8" },
    ]);
    await db.query(`insert into workout_log_exercises(id,workout_log_id,exercise_plan_id,name,actual_weight,actual_reps,actual_rpe)
      values('null-actuals','w1a-log','synthetic-ex','Unknown',null,8,null)`);
    const rows = (await db.query("select * from workout_log_exercises where id='null-actuals'")).rows;
    const [mapped] = mapWorkoutLogs((await db.query("select * from workout_logs")).rows, rows);
    assert.deepEqual([mapped.exercises[0].actualWeight, mapped.exercises[0].actualReps, mapped.exercises[0].actualRpe], [null, 8, null]);
    const columns = (await db.query(`select is_nullable from information_schema.columns where table_name='workout_log_exercises'
      and column_name in ('actual_weight','actual_reps','actual_rpe')`)).rows;
    assert.equal(columns.length, 3); assert.ok(columns.every(c => c.is_nullable === "YES"));
    assert.deepEqual((await db.query("select policyname,qual,with_check from pg_policies where tablename in ('workout_logs','workout_log_exercises') order by policyname")).rows, policiesBefore);
    await db.query("grant usage on schema public,auth to authenticated; grant select,insert on workout_logs,workout_log_exercises to authenticated");
    const client = await db.connect();
    try {
      await client.query("begin; set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      await client.query(`insert into workout_log_exercises(id,workout_log_id,exercise_plan_id,name,actual_reps)
        values('owner-null','w1a-log','synthetic-ex','Owner reports reps only',8)`);
      await client.query("commit");
      assert.deepEqual((await db.query("select actual_weight,actual_reps,actual_rpe from workout_log_exercises where id='owner-null'")).rows,
        [{ actual_weight: null, actual_reps: 8, actual_rpe: null }]);
      await client.query("begin; set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", ["33333333-3333-4333-8333-333333333333"]);
      assert.equal((await client.query("select * from workout_log_exercises")).rowCount, 0);
      await assert.rejects(client.query(`insert into workout_log_exercises(id,workout_log_id,exercise_plan_id,name)
        values('cross-owner','w1a-log','synthetic-ex','Blocked')`), { code: "42501" });
    } finally { await client.query("rollback"); client.release(); }
    console.log("W1a: legacy constraints→migration twice→SQL null→application read; legacy facts and cross-owner RLS verified");
  } finally { await db.end(); }
});
