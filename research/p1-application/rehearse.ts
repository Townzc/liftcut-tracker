// Runs real DB transactions using a scripted policy. NO model/network inference, NO cloud.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { AgentStore } from "../../src/services/agent/store";
import type { Outcome, RunView, Binding } from "../../src/lib/agent/contracts";
import { cases } from "./cases";
import { localDatabase, runtimeUrl, snapshot, sha } from "./evidence";
const unwrap = <T>(r: Outcome<T>): T => { assert.equal(r.ok, true, JSON.stringify(r)); return (r as { ok: true; value: T }).value; };
const bind = (r: RunView): Binding => ({ proposalId: r.proposal!.proposalId, contentHash: r.proposal!.contentHash, contextRevision: r.proposal!.contextRevision });
async function main() {
  const output = process.argv[2]; assert.ok(output, "Pass a new evidence directory");
  await mkdir(output); // Existing output is never overwritten or silently resumed.
  const db = new Pool({ connectionString: localDatabase().toString() });
  const pool = new Pool({ connectionString: runtimeUrl() });
  let store = new AgentStore(pool);
  const start = new Date().toISOString(), monotonic = performance.now();
  const hashes: Record<string, string> = {}, rows = [];
  async function save(name: string, data: unknown) {
    const bytes = JSON.stringify(data, null, 2) + "\n";
    await writeFile(join(output, name), bytes, { flag: "wx" }); hashes[name] = sha(bytes);
  }
  try {
    for (const fixture of cases) {
      const user = randomUUID(), requestKey = randomUUID();
      await db.query("insert into auth.users values($1)", [user]);
      await db.query("insert into public.user_settings(user_id) values($1)", [user]);
      const trace: unknown[] = [];
      async function call<T>(action: string, input: unknown, operation: () => Promise<T>): Promise<T> {
        const at = new Date().toISOString(), tick = performance.now(), result = await operation();
        trace.push({ action, input, result, at, elapsedMs: performance.now() - tick }); return result;
      }
      const create = { requestKey, context: fixture.context };
      let run = unwrap(await call("create", create, () => store.create(user, create)));
      const runId = run.id;
      const propose = { expectedRevision: run.revision, plan: fixture.plan };
      run = unwrap(await call("propose", propose, () => store.publish(user, runId, propose)));
      if (fixture.flow === "resume") {
        store = new AgentStore(pool); // New object is not claimed as a process kill (separate test does that).
        assert.equal(unwrap(await call("resume_create_key", create, () => store.create(user, create))).id, runId);
        run = unwrap(await call("read", {}, () => store.get(user, runId)));
      }
      const userAction = async (action: "approve" | "revoke" | "decline") => {
        const input = { action, binding: bind(run), expectedRevision: run.revision };
        run = unwrap(await call("external_user_event", input, () => store.userEvent(user, runId, input)));
      };
      if (fixture.flow === "decline") await userAction("decline");
      if (fixture.flow === "no_reply") run = unwrap(await call("read_without_user_reply", {}, () => store.get(user, runId)));
      if (["approve", "revoke", "context_update", "lost_response", "resume"].includes(fixture.flow)) {
        await userAction("approve");
        const execute = { binding: bind(run), approvalId: run.approvalId!, idempotencyKey: randomUUID() };
        if (fixture.flow === "revoke") await userAction("revoke");
        if (fixture.flow === "context_update") {
          const input = { action: "context", expectedRevision: run.revision, context: { ...fixture.context, sessionMinutes: 25 } };
          run = unwrap(await call("external_user_event", input, () => store.userEvent(user, runId, input)));
        }
        const result = await call("execute", execute, () => store.execute(user, runId, execute));
        assert.equal(result.ok, !["revoke", "context_update"].includes(fixture.flow));
        if (fixture.flow === "lost_response") {
          trace.push({ action: "scripted_response_loss", transportFault: false, realBrowserFaultCoveredSeparately: true });
          const original = unwrap(result);
          const replay = unwrap(await call("retry_same_key", execute, () => store.execute(user, runId, execute)));
          assert.deepEqual(replay, original);
        }
        if (fixture.flow === "context_update") {
          const newProposal = { expectedRevision: run.revision, plan: fixture.plan };
          run = unwrap(await call("revised_preview_requires_new_approval", newProposal, () => store.publish(user, runId, newProposal)));
        }
      }
      run = unwrap(await call("final_read", {}, () => store.get(user, runId)));
      const data = await snapshot(db, user, runId);
      assert.equal(run.status, fixture.expectedStatus);
      for (const key of ["plans", "weeks", "days", "exercises", "receipts"]) assert.equal(data[key].length, fixture.expectedWrites);
      assert.equal(data.events.filter((e: { type: string }) => e.type === "plan_committed").length, fixture.expectedWrites);
      if (run.receipt) { assert.equal(run.receipt.contentHash, run.proposal!.contentHash); assert.equal(run.receipt.approvalId, run.approvalId); }
      const row = { id: fixture.id, status: run.status, writes: data.plans.length, attempts: run.attempts, passed: true };
      rows.push(row);
      await save(`${fixture.id}.json`, { evidenceKind: "scripted_application_postgres", modelCalls: 0, fixture, user, runId, trace, final: run, database: data });
    }
    await save("summary.json", { version: "p1-cpu-workflows-v1", startedAt: start, finishedAt: new Date().toISOString(),
      elapsedSeconds: (performance.now() - monotonic) / 1000, databaseVersion: (await db.query("show server_version")).rows[0].server_version,
      cases: rows.length, passed: rows.filter(x => x.passed).length, businessCommits: rows.reduce((n, r) => n + r.writes, 0),
      executeAttempts: rows.reduce((n, r) => n + r.attempts, 0), rows, modelCalls: 0, cloudCalls: 0,
      authentication: "synthetic_identity_fixture_not_GoTrue", independentGeneralization: false, gpuReady: false });
    await writeFile(join(output, "sha256.json"), JSON.stringify(hashes, null, 2) + "\n", { flag: "wx" });
    console.log(`P1 scripted Postgres workflows: ${rows.length}/24 passed; 0 model calls. Evidence: ${output}`);
  } finally { await pool.end(); await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
