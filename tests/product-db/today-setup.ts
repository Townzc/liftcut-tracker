import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
export function testUrl() {
  const url = process.env.W1B_TEST_DATABASE_URL;
  if (!url || !["localhost","127.0.0.1"].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith("/liftcut_p1_w1b_")) throw new Error("Fresh local W1b test database required");
  return url;
}
export async function setup() {
  const db = new Pool({connectionString:testUrl()});
  try {
    if ((await db.query("select to_regclass('public.workout_sessions') as t")).rows[0].t) throw new Error("Use a fresh disposable database");
    await db.query((await readFile("tests/agent-db/bootstrap.sql","utf8")).replace(/^\uFEFF/,""));
    // Upgrade from the actual reviewed W1a schema, not a mock of our new schema.
    await db.query(execFileSync("git",["show","5ed487de7f05c5c87523abe75ff0419bcf0324c2:supabase/schema.sql"],{encoding:"utf8"}).replace(/^\uFEFF/,""));
    await db.query(await readFile("supabase/migrations/20261014002316_today_session.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261014025246_workout_command_receipts.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261014060607_session_exercise_replacements.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261014090536_personal_record_events.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261014181717_coach_model_access.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261013203030_p1_application_transactions.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261014210256_conversational_plan_approval.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261014222000_plan_lock_jwt_subject.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261015175339_coach_history_and_atomic_quota.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261017044341_guest_ai_import_memory.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261017075002_plan_memory_basis.sql","utf8"));
    await db.query(await readFile("supabase/migrations/20261022010656_workout_conversation_reviews.sql","utf8"));
    // Mirror hosted managed-schema permissions, not a local administrator's grants.
    await db.query("revoke usage on schema auth from liftcut_agent, liftcut_workout");
    await db.query("alter role liftcut_agent login password 'p1-local-fixture-only'");
    await db.query("alter role liftcut_workout login password 'w1b-local-fixture-only'");
    console.log("W1b upgrade: actual W1a schema + migration on local PostgreSQL; synthetic auth.uid, not hosted GoTrue");
  } finally { await db.end(); }
}
