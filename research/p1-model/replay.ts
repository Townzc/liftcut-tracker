// Native output is independently audited in Python before this real-database replay.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { AgentStore, contentHash } from "../../src/services/agent/store";
import { cases } from "../p1-application/cases";
import { localDatabase, runtimeUrl, load } from "../p1-application/evidence";
import { snapshot } from "./database";
import { createCase, step, score, type Checkpoint } from "./engine";
import { publicState, LIMITS, VERSION } from "./contract";

type Data = Awaited<ReturnType<typeof snapshot>>;
// timestamptz values are absolute, but to_jsonb renders their source session's
// offset. Recover that recorded representation before checking the ORIGINAL
// profile hash. Never rewrite the archive's timestamps or weaken the hash check.
export function sourceTimeZone(data: Data[]): string {
  const offsets = data.map(d => {
    const text = d.settings_json?.updated_at;
    assert.equal(typeof text, "string");
    const match = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(text);
    assert.ok(match, "source profile timezone offset missing");
    if (match[1] === "Z") return "UTC";
    const hours = Number(match[3]), minutes = Number(match[4]);
    assert.ok(hours <= 14 && minutes < 60 && (hours < 14 || minutes === 0), "invalid source offset");
    if (!hours && !minutes) return "UTC";
    // PostgreSQL POSIX timezone offsets have the opposite sign to ISO8601.
    return `UTC${match[2] === "+" ? "-" : "+"}${match[3]}:${match[4]}`;
  });
  assert.ok(offsets.length > 0 && offsets.every(x => x === offsets[0]), "mixed source offsets require explicit recovery");
  return offsets[0];
}
// SQL snapshots are deserialized data; their contents are checked below and against actual SQL.
export function checkData(d: Data) {
  assert.equal(d.run.length, 1); assert.equal(d.settings.length, 1);
  const run = d.run[0];
  assert.equal(run.user_id, d.settings[0].user_id);
  assert.equal(run.profile_hash, contentHash(d.settings_json));
  assert.equal(run.request_hash, contentHash(d.events[0].data.context));
  for (const p of d.proposals) { assert.equal(p.content_hash, contentHash(p.plan)); assert.equal(p.run_id, run.id); }
  for (const name of ["proposals", "events", "keys", "receipts", "plans"])
    for (const row of d[name]) { assert.equal(row.user_id, run.user_id); if (row.run_id) assert.equal(row.run_id, run.id); }
  let sequence = BigInt(-1), commits = 0, attempts = 0;
  for (let i = 0; i < d.events.length; i++) {
    const event = d.events[i]; assert.ok(BigInt(event.sequence) > sequence); sequence = BigInt(event.sequence);
    if (event.type === "execute_attempt") attempts++;
    if (event.type !== "plan_committed") continue;
    commits++; assert.equal(event.actor, "database");
    const receipt = event.data;
    const approval = d.events.findIndex((x: { type: string; actor: string; data: Record<string, unknown> }) =>
      x.type === "approve" && x.actor === "user" && x.data.approvalId === receipt.approvalId);
    assert.ok(approval >= 0 && approval < i, "commit has no prior human approval");
    for (const field of ["proposalId", "contentHash", "contextRevision"]) assert.equal(d.events[approval].data[field], receipt[field]);
    assert.ok(!d.events.slice(approval + 1, i).some((x: { type: string }) =>
      ["revoke", "decline", "context_updated", "profile_changed", "proposal_published"].includes(x.type)), "approval invalidated before commit");
    assert.equal(receipt.runId, run.id);
    assert.ok(d.proposals.some((p: { id: string; content_hash: string; context_revision: number }) =>
      p.id === receipt.proposalId && p.content_hash === receipt.contentHash && p.context_revision === receipt.contextRevision));
    assert.ok(d.receipts.some((r: { receipt: unknown }) => contentHash(r.receipt) === contentHash(receipt)));
    assert.ok(d.plans.some((p: { id: string }) => p.id === receipt.planId));
  }
  assert.equal(run.attempts, attempts); assert.equal(d.receipts.length, commits); assert.equal(d.plans.length, commits);
  assert.ok(commits <= 1, "duplicate business commit");
  for (const key of d.keys) {
    const attempt = d.events.find((e: { type: string; data: { key: string } }) => e.type === "execute_attempt" && e.data.key === key.key);
    assert.ok(attempt);
    const { proposalId, contentHash: hash, contextRevision, approvalId } = attempt.data;
    assert.equal(key.intent_hash, contentHash({ runId: run.id, binding: { proposalId, contentHash: hash, contextRevision }, approvalId }));
  }
}

// Explicit identity mapping keeps foreign-key relationships. Only clocks and SQL
// sequence counters differ on a fresh replay. Content hashes remain unchanged.
export function semantic(d: Data) {
  checkData(d);
  const names = new Map<string, string>();
  const put = (value: unknown, name: string) => { if (typeof value === "string") names.set(value, name); };
  put(d.run[0].user_id, "OWNER"); put(d.run[0].id, "RUN"); put(d.run[0].request_key, "CREATE_KEY");
  put(d.run[0].profile_hash, "VERIFIED_PROFILE_HASH");
  for (const table of ["settings", "proposals", "plans", "weeks", "days", "exercises", "receipts"])
    d[table].forEach((row: { id?: string }, i: number) => { if (row.id && !names.has(row.id)) put(row.id, `${table}-${i}`); });
  d.events.filter((e: { type: string }) => e.type === "approve").forEach((e: { data: { approvalId: string } }, i: number) => put(e.data.approvalId, `APPROVAL-${i}`));
  d.keys.forEach((key: { key: string; intent_hash: string }, i: number) => { put(key.key, `KEY-${i}`); put(key.intent_hash, `VERIFIED_INTENT-${i}`); });
  const walk = (value: unknown, key = ""): unknown => {
    if (["created_at", "updated_at", "committedAt"].includes(key)) {
      assert.ok(typeof value === "string" && Number.isFinite(Date.parse(value))); return "CLOCK";
    }
    if (key === "sequence") return "SQL_SEQUENCE";
    if (typeof value === "string") return names.get(value) ?? value;
    if (Array.isArray(value)) return value.map(v => walk(v));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    return value;
  };
  return walk(d);
}

export async function replay(directory: string, reportFile: string) {
  assert.deepEqual(await load(join(directory, "cases.json")), cases);
  const summary = await load(join(directory, "summary.json"));
  assert.equal(summary.version, VERSION); assert.equal(summary.status, "complete"); assert.equal(summary.cases, 24);
  const originals = await Promise.all(cases.map((_, i) => load(join(directory, `case-${i}.json`))));
  const timezone = sourceTimeZone(originals.map(x => x.result.database));
  const options = `-c TimeZone=${timezone}`;
  const db = new Pool({ connectionString: localDatabase().toString(), options }), pool = new Pool({ connectionString: runtimeUrl(), options });
  const store = new AgentStore(pool);
  let requests = 0, writes = 0, attempts = 0, passed = 0;
  try {
    for (let index = 0; index < cases.length; index++) {
      const original = originals[index];
      const saved: Checkpoint = original.checkpoint;
      assert.equal(saved.caseIndex, index); assert.equal(original.kind, summary.kind);
      assert.ok(saved.finished); assert.ok(saved.steps.length > 0 && saved.steps.length <= LIMITS.requestsPerCase);
      const actual = await snapshot(db, saved.owner, saved.runId);
      assert.deepEqual(actual, original.result.database, "restored database bytes/values differ");
      assert.deepEqual(actual, saved.steps.at(-1)!.database);
      const view = await store.get(saved.owner, saved.runId); assert.ok(view.ok);
      assert.deepEqual(publicState(view.value, cases[index].plan), original.result.publicFinal);
      const fresh = await createCase(db, store, index);
      let n = 0;
      while (!fresh.finished) {
        const progress = await step(fresh, db, store, async payload => {
          assert.ok(n < saved.steps.length, "recorded decisions exhausted");
          assert.deepEqual(payload, saved.steps[n].request, "reconstructed public input differs");
          return saved.steps[n++].reply;
        });
        // Application-process restart evidence is independently checked from the
        // actual controller/checkpoint files; replay itself does not simulate a crash.
        if (progress === "resume") assert.ok(saved.resumeIssued);
        if (n) {
          const a = fresh.steps.at(-1)!, b = saved.steps[n - 1];
          assert.deepEqual(a.tool, b.tool); assert.deepEqual(a.actualResult, b.actualResult); assert.deepEqual(a.visibleResult, b.visibleResult);
          assert.deepEqual(semantic(a.database), semantic(b.database));
        }
      }
      assert.equal(n, saved.steps.length); assert.deepEqual(fresh.messages, saved.messages);
      for (const flag of ["injected", "lossInjected", "resumeIssued", "policyFailure", "finished"] as const) assert.equal(fresh[flag], saved[flag]);
      // External event bindings contain new UUIDs; all public fields and SQL
      // chronology have already been compared through every preceding snapshot.
      assert.deepEqual(fresh.external.map((x) => { const e = x as { actor: string; afterDecision: number; resultingRevision: number; input: { action: string; expectedRevision: number } };
        return [e.actor, e.afterDecision, e.resultingRevision, e.input.action, e.input.expectedRevision]; }),
      saved.external.map((x) => { const e = x as { actor: string; afterDecision: number; resultingRevision: number; input: { action: string; expectedRevision: number } };
        return [e.actor, e.afterDecision, e.resultingRevision, e.input.action, e.input.expectedRevision]; }));
      const result = await score(fresh, db, store);
      for (const key of ["caseId", "expectedStatus", "expectedWrites", "status", "writes", "attempts", "decisions", "policyFailure", "unsafeCommit", "passed", "publicFinal"] as const)
        assert.deepEqual(result[key], original.result[key]);
      requests += n; writes += result.writes; attempts += result.attempts; passed += Number(result.passed);
    }
    for (const [key, value] of Object.entries({ requests, writes, attempts, passed })) assert.equal(summary[key], value);
    const report = { version: VERSION, kind: summary.kind, cases: 24, requests, writes, attempts, passed, sourceTimeZone: timezone,
      exactRestoredSnapshots: true, restrictedReads: true, actualFreshSqlReplay: true, nativeValidatedSeparately: true };
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(report));
  } finally { await pool.end(); await db.end(); }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/replay.ts"))
  replay(process.argv[2], process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
