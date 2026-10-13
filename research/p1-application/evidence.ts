import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
export const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export function localDatabase(name = "P1_TEST_DATABASE_URL") {
  const text = process.env[name]; assert.ok(text, `${name} required`);
  const url = new URL(text);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.startsWith("/liftcut_p1_"), "Disposable loopback fixture database required");
  return url;
}
export function runtimeUrl() { const url = localDatabase(); url.username = "liftcut_agent"; url.password = "p1-local-fixture-only"; return url.toString(); }
export async function snapshot(db: Pool, user: string, runId: string) {
  const query = async (sql: string, params = [user]) => (await db.query(sql, params)).rows;
  // JSON round-trip normalizes pg Date objects, preserving exact SQL values and timestamps.
  return JSON.parse(JSON.stringify({
    settings: await query("select * from public.user_settings where user_id=$1"),
    run: await query("select * from agent_private.runs where id=$1", [runId]),
    proposals: await query("select * from agent_private.proposals where run_id=$1 order by version", [runId]),
    events: await query("select * from agent_private.events where run_id=$1 order by sequence", [runId]),
    keys: await query("select * from agent_private.execution_keys where run_id=$1 order by key", [runId]),
    receipts: await query("select * from agent_private.receipts where run_id=$1", [runId]),
    plans: await query("select * from public.training_plans where user_id=$1 order by id"),
    weeks: await query("select w.* from public.training_plan_weeks w join public.training_plans p on p.id=w.training_plan_id where p.user_id=$1 order by w.id"),
    days: await query("select d.* from public.training_plan_days d join public.training_plan_weeks w on w.id=d.week_id join public.training_plans p on p.id=w.training_plan_id where p.user_id=$1 order by d.id"),
    exercises: await query("select e.* from public.training_plan_exercises e join public.training_plan_days d on d.id=e.day_id join public.training_plan_weeks w on w.id=d.week_id join public.training_plans p on p.id=w.training_plan_id where p.user_id=$1 order by e.id"),
  }));
}
export const load = async (path: string) => JSON.parse(await readFile(path, "utf8"));
