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
    await db.query("alter role liftcut_workout login password 'w1b-local-fixture-only'");
    console.log("W1b upgrade: actual W1a schema + migration on local PostgreSQL; synthetic auth.uid, not hosted GoTrue");
  } finally { await db.end(); }
}
