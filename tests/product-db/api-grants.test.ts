import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

// Run against two newly created local databases. No auto-exposure grants and no
// owner/superuser queries for application operations. Auth identity is synthetic;
// the separately documented local Supabase browser check uses real GoTrue.
const configured = process.env.API_GRANTS_TEST_DATABASE_URL;
const grantsFile = "supabase/migrations/20261021034000_explicit_legacy_api_grants.sql";
const expected: Record<string, string[]> = {
  profiles: ["INSERT", "SELECT", "UPDATE"], user_settings: ["INSERT", "SELECT", "UPDATE"],
  training_plans: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  training_plan_weeks: ["DELETE", "INSERT", "SELECT"],
  training_plan_days: ["INSERT", "SELECT"], training_plan_exercises: ["INSERT", "SELECT"],
  workout_logs: ["INSERT", "SELECT", "UPDATE"], workout_log_exercises: ["DELETE", "INSERT", "SELECT"],
  food_logs: ["DELETE", "INSERT", "SELECT", "UPDATE"], body_metric_logs: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  ai_training_plan_generations: ["DELETE", "INSERT", "SELECT"],
  ai_nutrition_plan_generations: ["DELETE", "INSERT", "SELECT"],
  nutrition_plans: ["INSERT", "SELECT", "UPDATE"],
  nutrition_plan_days: ["INSERT", "SELECT"], nutrition_plan_meals: ["INSERT", "SELECT"],
};

for (const installation of ["fresh", "upgrade"] as const) {
  test(`explicit API grants: ${installation} without automatic exposure`, { skip: !configured }, async t => {
    const url = new URL(configured!);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    const name = url.pathname.slice(1) + "_" + installation;
    assert.match(name, /^liftcut_p1_grants_[a-z0-9_]+$/);
    const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
    const cluster = new Pool({ connectionString: adminUrl.toString() });
    // CREATE fails if this name already exists; never reset an existing database.
    await cluster.query(`create database "${name}"`);
    await cluster.end(); url.pathname = "/" + name;
    const db = new Pool({ connectionString: url.toString() });
    const owner = randomUUID(), other = randomUUID();
    async function asRole<T>(role: "authenticated" | "anon", id: string, fn: (c: PoolClient) => Promise<T>) {
      const c = await db.connect();
      try {
        await c.query("begin"); await c.query(`set local role ${role}`);
        await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
        const result = await fn(c); await c.query("commit"); return result;
      } catch (error) { await c.query("rollback"); throw error; } finally { c.release(); }
    }
    const denied = (fn: () => Promise<unknown>) => assert.rejects(fn, { code: "42501" });
    try {
      await db.query(await readFile("tests/agent-db/bootstrap.sql", "utf8"));
      await db.query("do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end$$");
      await db.query(`alter default privileges in schema public revoke all on tables from anon,authenticated,service_role;
        alter default privileges in schema public revoke all on sequences from anon,authenticated,service_role;
        alter default privileges in schema public revoke execute on functions from public,anon,authenticated,service_role;`);
      const schema = await readFile("supabase/schema.sql", "utf8");
      await db.query(installation === "fresh" ? schema : schema.split("-- Fresh installs use the same explicit API grants")[0]);
      for (const file of (await readdir("supabase/migrations")).sort()) {
        // These two migrations are already included in schema.sql.
        if (["20261014002316_today_session.sql", "20261014181717_coach_model_access.sql"].includes(file) || file.endsWith("explicit_legacy_api_grants.sql")) continue;
        await db.query(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      await db.query("insert into auth.users values($1),($2)", [owner, other]);
      if (installation === "upgrade") {
        await denied(() => asRole("authenticated", owner, c => c.query("select * from public.user_settings")));
      }
      await db.query(await readFile(grantsFile, "utf8"));
      await db.query(await readFile(grantsFile, "utf8")); // additive/idempotent upgrade

      await t.test("exact per-table capabilities; private and transaction writes stay unavailable", async () => {
        for (const [table, privileges] of Object.entries(expected)) {
          const actual = await db.query(`select p from unnest(array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) p
            where has_table_privilege('authenticated',$1,p)`, [`public.${table}`]);
          assert.deepEqual(actual.rows.map(r => r.p), privileges, table);
          for (const role of ["anon", "service_role"]) {
            assert.equal((await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as ok", [role, `public.${table}`])).rows[0].ok, false, `${role}:${table}`);
          }
        }
        for (const table of ["workout_sessions", "set_logs", "workout_commands", "workout_session_events", "workout_exercise_changes", "personal_record_events"]) {
          assert.equal((await db.query("select has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') as ok", [`public.${table}`])).rows[0].ok, false, table);
        }
        for (const table of ["coach_conversations", "coach_turns", "coach_request_usage"]) {
          assert.equal((await db.query("select has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') as ok", [`public.${table}`])).rows[0].ok, false, table);
        }
        assert.equal((await db.query("select has_schema_privilege('authenticated','agent_private','USAGE') as ok")).rows[0].ok, false);
        await denied(() => asRole("anon", "", c => c.query("select * from public.user_settings")));
      });

      await t.test("onboarding upsert/read/update and owner isolation", async () => {
        await asRole("authenticated", owner, async c => {
          assert.equal((await c.query("select * from user_settings where user_id=$1", [owner])).rowCount, 0);
          await c.query("insert into profiles(id,email) values($1,'synthetic@example.invalid')", [owner]);
          await c.query(`insert into user_settings(user_id,gender,age,height,current_weight,target_weight,weekly_training_days)
            values($1,'male',25,175,75,70,3) on conflict(user_id) do update set weekly_training_days=excluded.weekly_training_days`, [owner]);
          await c.query("update user_settings set weekly_training_days=4 where user_id=$1", [owner]);
          assert.equal((await c.query("select gender,age,height,current_weight,target_weight,weekly_training_days from user_settings where user_id=$1", [owner])).rows[0].weekly_training_days, 4);
        });
        await asRole("authenticated", other, async c => {
          assert.equal((await c.query("select * from user_settings")).rowCount, 0);
          assert.equal((await c.query("update user_settings set age=30 where user_id=$1", [owner])).rowCount, 0);
        });
        await denied(() => asRole("authenticated", other, c => c.query("insert into user_settings(user_id) values($1)", [owner])));
        await denied(() => asRole("authenticated", owner, c => c.query("update user_settings set user_id=$1 where user_id=$2", [other, owner])));
        await denied(() => asRole("authenticated", owner, c => c.query("delete from user_settings where user_id=$1", [owner])));
      });

      await t.test("legacy plan replacement, cascading children and log CRUD work under RLS", async () => {
        await asRole("authenticated", owner, async c => {
          await c.query("insert into training_plans(id,user_id,name) values('p',$1,'Synthetic')", [owner]);
          await c.query("insert into training_plan_weeks values('w','p',1)");
          await c.query("insert into training_plan_days(id,week_id,day_number,title) values('d','w',1,'Day')");
          await c.query("insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values('e','d','Squat',3,'8',7)");
          assert.equal((await c.query("select * from training_plan_exercises")).rowCount, 1);
          await c.query("delete from training_plan_weeks where id='w'");
          assert.equal((await c.query("select * from training_plan_exercises")).rowCount, 0);
          await c.query("insert into food_logs(id,user_id,date,meal_type,food_name,calories,protein) values('food',$1,current_date,'lunch','Synthetic',300,20) on conflict(id) do update set calories=excluded.calories", [owner]);
          await c.query("insert into body_metric_logs(id,user_id,date,weight,waist) values('body',$1,current_date,75,80) on conflict(user_id,date) do update set weight=excluded.weight", [owner]);
          await c.query("delete from food_logs where id='food'");
          await c.query("delete from body_metric_logs where id='body'");
        });
        await asRole("authenticated", other, async c => {
          assert.equal((await c.query("select * from training_plans")).rowCount, 0);
          assert.equal((await c.query("delete from training_plans where id='p'")).rowCount, 0);
        });
        await denied(() => asRole("authenticated", other, c => c.query("insert into training_plan_weeks values('foreign','p',1)")));
      });
    } finally { await db.end(); }
  });
}
