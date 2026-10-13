import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, after } from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";
import { AgentStore } from "../../src/services/agent/store";
import { type Outcome, type RunView, type Execution } from "../../src/lib/agent/contracts";

const adminUrl = process.env.P1_TEST_DATABASE_URL;
if (!adminUrl) throw new Error("P1_TEST_DATABASE_URL required; DB tests never silently skip");
const target = new URL(adminUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !target.pathname.startsWith("/liftcut_p1_")) throw new Error("Local test DB only");
const runtimeUrl = new URL(adminUrl); runtimeUrl.username = "liftcut_agent"; runtimeUrl.password = "p1-local-fixture-only";
const admin = new Pool({ connectionString: adminUrl });
const pool = new Pool({ connectionString: runtimeUrl.toString(), max: 8 });
const store = new AgentStore(pool);
after(async () => { await pool.end(); await admin.end(); });
const context = { weeklyDays: 2, sessionMinutes: 45, equipment: ["bodyweight"], notes: "Synthetic fixture" };
const plan = { plan_name: "P1 synthetic", goal_type: "maintenance", summary: "Test only", reasoning_summary: "", warnings: [],
  weeks: [{ week_number: 1, focus: "", days: [{ day_number: 1, title: "A", notes: "", estimated_duration_minutes: 30,
    exercises: [{ name: "Bodyweight squat", sets: 2, rep_range: "8", target_rpe: 6, rest_seconds: 90, notes: "", alternative_exercises: [] }] }] }] };
function value<T>(result: Outcome<T>): T { assert.equal(result.ok, true, JSON.stringify(result)); return (result as { ok: true; value: T }).value; }
function binding(run: RunView) { assert.ok(run.proposal); const p = run.proposal; return { proposalId: p.proposalId, contentHash: p.contentHash, contextRevision: p.contextRevision }; }
async function fixture() {
  const user = randomUUID();
  await admin.query("insert into auth.users values($1)", [user]);
  await admin.query("insert into public.user_settings(user_id) values($1)", [user]);
  const run = value(await store.create(user, { requestKey: randomUUID(), context }));
  return { user, run: value(await store.publish(user, run.id, { expectedRevision: run.revision, plan })) };
}
async function approved() {
  const f = await fixture();
  const run = value(await store.userEvent(f.user, f.run.id, { action: "approve", expectedRevision: f.run.revision, binding: binding(f.run) }));
  const execution: Execution = { binding: binding(run), approvalId: run.approvalId!, idempotencyKey: randomUUID() };
  return { user: f.user, run, execution };
}
async function commits(user: string) { return Number((await admin.query("select count(*) from public.training_plans where user_id=$1", [user])).rows[0].count); }

test("runtime login is non-owner, no BYPASSRLS, private tables inaccessible to browser roles", async () => {
  const roles = await pool.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user");
  assert.deepEqual(roles.rows[0], { rolsuper: false, rolbypassrls: false });
  const owners = await pool.query(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='agent_private' and c.relkind='r' and pg_has_role(current_user,c.relowner,'USAGE')`);
  assert.equal(owners.rows[0].count, "0");
  for (const role of ["anon", "authenticated"]) {
    const r = await admin.query("select has_schema_privilege($1,'agent_private','usage') as access", [role]);
    assert.equal(r.rows[0].access, false);
  }
});
test("preview and no approval: attempt1, business commits0", async () => {
  const { user, run } = await fixture();
  assert.equal((await store.execute(user, run.id, { binding: binding(run), approvalId: randomUUID(), idempotencyKey: randomUUID() })).ok, false);
  assert.equal(await commits(user), 0);
  assert.equal(value(await store.get(user, run.id)).attempts, 1);
});
test("12 concurrent same-key executes commit one complete plan and return one receipt", async () => {
  const { user, run, execution } = await approved();
  const receipts = await Promise.all(Array.from({ length: 12 }, () => store.execute(user, run.id, execution)));
  const ids = new Set(receipts.map(r => value(r).id)); assert.equal(ids.size, 1);
  assert.equal(await commits(user), 1);
  assert.equal(value(await store.get(user, run.id)).attempts, 12);
  assert.equal(Number((await admin.query("select count(*) from public.training_plan_exercises where day_id like $1", [value(receipts[0]).planId + "%"])).rows[0].count), 1);
});
test("different keys for same approved proposal still at most one business commit", async () => {
  const { user, run, execution } = await approved();
  const results = await Promise.all([store.execute(user, run.id, execution), store.execute(user, run.id, { ...execution, idempotencyKey: randomUUID() })]);
  assert.equal(value(results[0]).id, value(results[1]).id); assert.equal(await commits(user), 1);
});
test("response lost then connection pool replaced: recover and replay original receipt", async () => {
  const { user, run, execution } = await approved();
  const original = value(await store.execute(user, run.id, execution)); // Deliberately discard transport response.
  const freshPool = new Pool({ connectionString: runtimeUrl.toString() });
  try {
    const resumed = new AgentStore(freshPool);
    assert.deepEqual(value(await resumed.execute(user, run.id, execution)), original);
    assert.deepEqual(value(await resumed.get(user, run.id)).receipt, original);
    assert.equal(await commits(user), 1);
  } finally { await freshPool.end(); }
});

test("actual child process dies after COMMIT; a new worker reads and replays the durable result", { timeout: 15000 }, async () => {
  const { user, run, execution } = await approved();
  const child = fork("tests/agent-db/commit-worker.ts", [], { execArgv: ["--conditions=react-server", "--import", "tsx"], silent: true });
  try {
    const message = once(child, "message", { signal: AbortSignal.timeout(10000) });
    child.send({ user, runId: run.id, execution, url: runtimeUrl.toString() });
    assert.deepEqual((await message)[0], { committed: true });
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    const recovered = value(await store.get(user, run.id));
    assert.ok(recovered.receipt);
    assert.deepEqual(value(await store.execute(user, run.id, execution)), recovered.receipt);
    assert.equal(await commits(user), 1);
  } finally { if (child.exitCode === null) child.kill("SIGKILL"); }
});

test("unsafe database administrator connection is refused before entering the transaction", async () => {
  const { user, run } = await fixture();
  await assert.rejects(new AgentStore(admin).get(user, run.id), /UNSAFE_DATABASE_ROLE/);
});

test("uncommitted profile update serializes before execution and invalidates old approval", async () => {
  const { user, run, execution } = await approved();
  const client = await admin.connect();
  try {
    await client.query("begin");
    await client.query("update public.user_settings set available_equipment='{changed}' where user_id=$1", [user]);
    const executing = store.execute(user, run.id, execution);
    await client.query("commit");
    assert.equal((await executing as { error: string }).error, "CONTEXT_STALE");
    assert.equal(await commits(user), 0);
  } finally { await client.query("rollback"); client.release(); }
});
test("same key changed content or changed run rejected, even after success", async () => {
  const { user, run, execution } = await approved();
  value(await store.execute(user, run.id, execution));
  assert.deepEqual(await store.execute(user, run.id, { ...execution, binding: { ...execution.binding, contentHash: "a".repeat(64) } }), { ok: false, error: "KEY_CONFLICT", retryable: false });
  const other = value(await store.create(user, { requestKey: randomUUID(), context }));
  assert.equal((await store.execute(user, other.id, execution) as { error: string }).error, "KEY_CONFLICT");
  assert.equal(await commits(user), 1);
});
test("revoke before execution blocks commit and late approval cannot revive the proposal", async () => {
  const { user, run, execution } = await approved();
  const revoked = value(await store.userEvent(user, run.id, { action: "revoke", expectedRevision: run.revision, binding: binding(run) }));
  assert.equal((await store.execute(user, run.id, execution) as { error: string }).error, "NOT_APPROVED");
  assert.equal((await store.userEvent(user, run.id, { action: "approve", expectedRevision: revoked.revision, binding: binding(run) })).ok, false);
  assert.equal(await commits(user), 0);
});
test("concurrent revoke/execute obey one linear order with auditable events", async () => {
  for (let i = 0; i < 4; i++) {
    const { user, run, execution } = await approved();
    const [revoke, apply] = await Promise.all([
      store.userEvent(user, run.id, { action: "revoke", expectedRevision: run.revision, binding: binding(run) }), store.execute(user, run.id, execution)]);
    assert.notEqual(revoke.ok, apply.ok);
    assert.equal(await commits(user), apply.ok ? 1 : 0);
    const current = value(await store.get(user, run.id));
    assert.equal(current.status, apply.ok ? "applied" : "revoked");
  }
});
test("execute committed first: subsequent revoke does not pretend to undo the plan", async () => {
  const { user, run, execution } = await approved();
  value(await store.execute(user, run.id, execution));
  const current = value(await store.get(user, run.id));
  assert.equal((await store.userEvent(user, run.id, { action: "revoke", expectedRevision: current.revision, binding: binding(current) }) as { error: string }).error, "RUN_CLOSED");
  assert.equal(await commits(user), 1);
});
test("new context, new proposal or actual profile update invalidate old approval", async () => {
  for (const change of ["context", "proposal", "profile"]) {
    const { user, run, execution } = await approved();
    if (change === "context") value(await store.userEvent(user, run.id, { action: "context", expectedRevision: run.revision, context: { ...context, sessionMinutes: 25 } }));
    if (change === "proposal") value(await store.publish(user, run.id, { expectedRevision: run.revision, plan: { ...plan, plan_name: "New" } }));
    if (change === "profile") await admin.query("update public.user_settings set available_equipment='{new}' where user_id=$1", [user]);
    assert.equal((await store.execute(user, run.id, execution)).ok, false); assert.equal(await commits(user), 0);
  }
});
test("cross-user read, approve, revoke, execute and direct RLS query denied", async () => {
  const a = await approved(), b = await fixture();
  assert.equal((await store.get(b.user, a.run.id) as { error: string }).error, "NOT_FOUND");
  for (const action of ["approve", "revoke"])
    assert.equal((await store.userEvent(b.user, a.run.id, { action, expectedRevision: a.run.revision, binding: binding(a.run) }) as { error: string }).error, "NOT_FOUND");
  assert.equal((await store.execute(b.user, a.run.id, a.execution) as { error: string }).error, "NOT_FOUND");
  const db = await pool.connect();
  try {
    await db.query("begin"); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [b.user]);
    assert.equal((await db.query("select * from agent_private.runs where id=$1", [a.run.id])).rowCount, 0);
    await db.query("rollback");
  } finally { db.release(); }
  assert.equal(await commits(a.user), 0);
});
test("fault on exercise insertion rolls back activation and ALL partial rows, same-key retry works", async () => {
  const { user, run, execution } = await approved();
  const prior = `prior-${randomUUID()}`;
  await admin.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Old',true)", [prior,user]);
  // A real database trigger injects the failure after plan/week/day writes, not a mocked store.
  await admin.query(`create or replace function public.p1_test_fault() returns trigger language plpgsql as $$begin
    if new.name='Bodyweight squat' then raise exception 'synthetic storage failure'; end if; return new; end$$;
    create trigger p1_test_fault before insert on public.training_plan_exercises for each row execute function public.p1_test_fault()`);
  try {
    assert.equal((await store.execute(user, run.id, execution) as { error: string }).error, "WRITE_ROLLED_BACK");
    assert.equal(await commits(user), 1);
    assert.equal((await admin.query("select is_active from public.training_plans where id=$1", [prior])).rows[0].is_active, true);
    assert.equal(value(await store.get(user, run.id)).receipt, null);
  } finally { await admin.query("drop trigger p1_test_fault on public.training_plan_exercises; drop function public.p1_test_fault()"); }
  value(await store.execute(user, run.id, execution)); assert.equal(await commits(user), 2);
  assert.equal(value(await store.get(user, run.id)).attempts, 2);
});
test("schema, invalid aliases, constraint feedback and budget deny before business writes", async () => {
  const { user, run, execution } = await approved();
  await assert.rejects(store.execute(user, run.id, { ...execution, binding: { ...execution.binding, proposalId: "alias-1" } }));
  await assert.rejects(store.execute(user, run.id, { ...execution, actor: "user" }));
  const tooLong = structuredClone(plan); tooLong.weeks[0].days[0].estimated_duration_minutes = 120;
  assert.equal((await store.publish(user, run.id, { expectedRevision: run.revision, plan: tooLong }) as { error: string }).error, "CONSTRAINT_VIOLATION");
  await admin.query("update agent_private.runs set attempts=64 where id=$1", [run.id]);
  assert.equal((await store.execute(user, run.id, execution) as { error: string }).error, "BUDGET_EXHAUSTED");
  assert.equal(await commits(user), 0);
});
test("runtime cannot rewrite proposals, receipts or events", async () => {
  const { user, run } = await fixture();
  const db = await pool.connect();
  try {
    for (const table of ["proposals", "receipts", "events"]) {
      await db.query("begin"); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      await assert.rejects(db.query(`delete from agent_private.${table} where run_id=$1`, [run.id]), /permission denied/);
      await db.query("rollback");
    }
  } finally { db.release(); }
});
test("creation key replay returns same run; changed context conflicts", async () => {
  const { user } = await fixture(), requestKey = randomUUID();
  const a = value(await store.create(user, { requestKey, context }));
  assert.equal(value(await store.create(user, { requestKey, context })).id, a.id);
  assert.equal((await store.create(user, { requestKey, context: { ...context, weeklyDays: 1 } }) as { error: string }).error, "KEY_CONFLICT");
});
