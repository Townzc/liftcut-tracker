import assert from "node:assert/strict";
import { test, after } from "node:test";
import { Pool } from "pg";
import { AgentStore } from "../../src/services/agent/store";
import { localDatabase, runtimeUrl } from "../../research/p1-application/evidence";
import { cases } from "../../research/p1-application/cases";
import { ApplicationTools, publicState, LIMITS } from "../../research/p1-model/contract";
import { createCase, parseReply, step, scripted } from "../../research/p1-model/engine";
import { checkData, semantic, sourceTimeZone } from "../../research/p1-model/replay";
import { snapshot } from "../../research/p1-model/database";

const db = new Pool({ connectionString: localDatabase().toString() });
const pool = new Pool({ connectionString: runtimeUrl() }), store = new AgentStore(pool);
after(async () => { await pool.end(); await db.end(); });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
async function prepared(index = 1) {
  const c = await createCase(db, store, index);
  await step(c, db, store, async p => scripted(p)); await step(c, db, store, async p => scripted(p));
  const run = await store.get(c.owner, c.runId); assert.ok(run.ok);
  const state = publicState(run.value, cases[index].plan);
  return { c, state, adapter: () => new ApplicationTools(store, c.owner, c.runId, cases[index].plan) };
}

test("model cannot inject a human event, owner, run or modified supplied draft", async () => {
  const f = await prepared(0);
  for (const action of [{ name: "approve", arguments: {} }, { name: "read_state", arguments: { owner: f.c.owner } },
    { name: "execute_plan", arguments: { proposal: "proposal-1", approval: "approval-1", key: "execution-1", run: f.c.runId } },
    { name: "propose_draft", arguments: { draft: cases[0].plan, revision: 1 } }])
    assert.deepEqual(await f.adapter().dispatch(action), { ok: false, error: "INVALID_TOOL_CALL" });
  const data = await snapshot(db, f.c.owner, f.c.runId);
  assert.equal(data.plans.length, 0); assert.equal(data.events.filter((e: { type: string }) => e.type === "approve").length, 0);
});

test("same public intent after adapter recreation returns the original receipt, one write", async () => {
  const f = await prepared(), action = { name: "execute_plan", arguments: { proposal: f.state.proposal!.handle, approval: f.state.approval, key: f.state.executionKey } };
  const first = await f.adapter().dispatch(action), second = await f.adapter().dispatch(action);
  assert.deepEqual(first, second); assert.equal(first.ok, true);
  const data = await snapshot(db, f.c.owner, f.c.runId);
  assert.equal(data.plans.length, 1); assert.equal(data.receipts.length, 1); assert.equal(data.keys.length, 1); assert.equal(data.run[0].attempts, 2);
  checkData(data);
});

test("revocation and updated constraints make previously plausible handles unusable", async () => {
  for (const index of [4, 5]) {
    const f = await prepared(index);
    const result = await f.adapter().dispatch({ name: "execute_plan", arguments: { proposal: "proposal-1", approval: "approval-1", key: "execution-1" } });
    assert.deepEqual(result, { ok: false, error: "UNKNOWN_OR_EXPIRED_BINDING" });
    assert.equal((await snapshot(db, f.c.owner, f.c.runId)).plans.length, 0);
  }
});

test("unknown aliases do not reach SQL execution and claimed success needs an actual receipt", async () => {
  const f = await prepared();
  assert.equal((await f.adapter().dispatch({ name: "execute_plan", arguments: { proposal: "proposal-other", approval: "approval-1", key: "execution-1" } })).ok, false);
  const claimed = await f.adapter().dispatch({ name: "finish", arguments: { status: "applied" } });
  assert.equal(claimed.ok, false); assert.equal((await snapshot(db, f.c.owner, f.c.runId)).run[0].attempts, 0);
});

test("public model requests contain no expected scores, identities or database access", async () => {
  const f = await prepared(); const payload = JSON.stringify(f.c.steps.map(s => s.request));
  for (const forbidden of [f.c.owner, f.c.runId, "expectedWrites", "expectedStatus", "p1-1-approve", "postgresql://", "P1_TEST_DATABASE_URL"])
    assert.equal(payload.includes(forbidden), false, forbidden);
  assert.equal(payload.includes("draft-1"), true);
});

test("prose and multi-action native outputs are rejected without fixing model text", () => {
  const body = scripted({ messages: [{ role: "user", content: "read" }], tools: [] as never }).body as { choices: { message: { content: string | null; tool_calls: unknown[] } }[] };
  const prose = clone(body); prose.choices[0].message.content = "I saved the plan";
  assert.throws(() => parseReply(prose), /SINGLE_TOOL/);
  const multi = clone(body); multi.choices[0].message.tool_calls.push(multi.choices[0].message.tool_calls[0]);
  assert.throws(() => parseReply(multi), /SINGLE_TOOL/);
});

test("durable case budget stops a non-finishing policy after twelve decisions", async () => {
  const c = await createCase(db, store, 0);
  const readOnly = async () => scripted({ messages: [{ role: "user", content: "read" }], tools: [] as never });
  for (let n = 0; n < LIMITS.requestsPerCase + 1; n++) await step(c, db, store, readOnly);
  assert.equal(c.steps.length, 12); assert.equal(c.policyFailure, "DECISION_BUDGET"); assert.equal(c.finished, true);
  assert.equal((await snapshot(db, c.owner, c.runId)).plans.length, 0);
});

test("SQL evidence audit rejects a deleted approval, altered intent and extra commit", async () => {
  const f = await prepared();
  await f.adapter().dispatch({ name: "execute_plan", arguments: { proposal: "proposal-1", approval: "approval-1", key: "execution-1" } });
  const data = await snapshot(db, f.c.owner, f.c.runId); checkData(data); semantic(data);
  const missing = clone(data); missing.events = missing.events.filter((e: { type: string }) => e.type !== "approve");
  assert.throws(() => checkData(missing), /approval/);
  const intent = clone(data); intent.keys[0].intent_hash = "0".repeat(64); assert.throws(() => checkData(intent));
  const extra = clone(data); extra.plans.push(clone(extra.plans[0])); assert.throws(() => checkData(extra));
});

test("raw PostgreSQL microseconds are kept for exact profile hash reconstruction", async () => {
  const c = await createCase(db, store, 0); const data = await snapshot(db, c.owner, c.runId);
  checkData(data);
  const changed = clone(data); changed.settings_json.updated_at = "2000-01-01T00:00:00+00:00";
  assert.throws(() => checkData(changed));
});

test("restore recovers the recorded SQL timezone without changing timestamp or profile hash", async () => {
  const source = new Pool({ connectionString: localDatabase().toString(), options: "-c TimeZone=UTC-05:30" });
  const agent = new Pool({ connectionString: runtimeUrl(), options: "-c TimeZone=UTC-05:30" });
  const utc = new Pool({ connectionString: localDatabase().toString(), options: "-c TimeZone=UTC" });
  let restored: Pool | undefined;
  try {
    const c = await createCase(source, new AgentStore(agent), 0);
    const original = await snapshot(source, c.owner, c.runId); checkData(original);
    const different = await snapshot(utc, c.owner, c.runId);
    assert.deepEqual(different.settings, original.settings);
    assert.throws(() => checkData(different));
    assert.equal(sourceTimeZone([original]), "UTC-05:30");
    assert.throws(() => sourceTimeZone([original, different]), /mixed source offsets/);
    restored = new Pool({ connectionString: localDatabase().toString(), options: `-c TimeZone=${sourceTimeZone([original])}` });
    const recovered = await snapshot(restored, c.owner, c.runId);
    assert.deepEqual(recovered, original); checkData(recovered);
  } finally { await restored?.end(); await source.end(); await agent.end(); await utc.end(); }
});
