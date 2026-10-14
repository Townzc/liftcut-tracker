import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const url = process.env.P1_TEST_DATABASE_URL;
if (!url) throw new Error("P1_TEST_DATABASE_URL is required");
const target = new URL(url);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !target.pathname.startsWith("/liftcut_p1_"))
  throw new Error("Refusing to initialize a non-local/non-test database");
const db = new Pool({ connectionString: url });
async function main() {
try {
  const exists = await db.query("select to_regclass('agent_private.runs') as table_name");
  if (exists.rows[0].table_name) throw new Error("Database already initialized; use a fresh disposable database");
  await db.query("begin");
  for (const path of ["tests/agent-db/bootstrap.sql", "supabase/schema.sql",
    "supabase/migrations/20261013203030_p1_application_transactions.sql",
    "supabase/migrations/20261014210256_conversational_plan_approval.sql",
    "supabase/migrations/20261014222000_plan_lock_jwt_subject.sql"])
    await db.query((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  // Hosted auth is managed by supabase_admin; custom runtime roles lack USAGE.
  await db.query("revoke usage on schema auth from liftcut_agent");
  // Test-only logins. These known passwords have no privileges outside the local fixture DB.
  await db.query("alter role liftcut_agent login password 'p1-local-fixture-only'");
  await db.query("commit");
  console.log("P1: real PostgreSQL schema + restricted runtime role installed in disposable local DB");
} catch (error) { await db.query("rollback"); throw error; }
finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
