// Offline integrity/semantic check of published observations, not another live DB run.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { contentHash } from "../../src/services/agent/store";
import { cases } from "./cases";
import { load, sha } from "./evidence";
async function main() {
  const directory = process.argv[2]; assert.ok(directory);
  const manifest = await load(join(directory, "sha256.json"));
  for (const [name, wanted] of Object.entries(manifest)) {
    assert.ok(!name.includes("..") && !name.startsWith("/") && !name.includes(":"));
    assert.equal(sha(await readFile(join(directory, name))), wanted, name);
  }
  const root = join(directory, "workflows"), hashes = await load(join(root, "sha256.json"));
  assert.deepEqual(Object.keys(hashes).sort(), [...cases.map(c => `${c.id}.json`), "summary.json"].sort());
  let writes = 0, attempts = 0;
  for (const fixture of cases) {
    const filename = `${fixture.id}.json`, bytes = await readFile(join(root, filename));
    assert.equal(sha(bytes), hashes[filename]); assert.ok(manifest[`workflows/${filename}`]);
    const e = JSON.parse(bytes.toString("utf8"));
    assert.equal(e.modelCalls, 0); assert.equal(e.evidenceKind, "scripted_application_postgres");
    assert.deepEqual(e.fixture, fixture); assert.equal(e.final.status, fixture.expectedStatus);
    assert.equal(e.database.run.length, 1); assert.equal(e.database.run[0].id, e.runId);
    assert.equal(e.database.run[0].user_id, e.user);
    for (const table of ["plans", "weeks", "days", "exercises", "receipts"]) assert.equal(e.database[table].length, fixture.expectedWrites);
    for (const p of e.database.proposals) assert.equal(p.content_hash, contentHash(p.plan));
    const events = e.database.events as { type: string; actor: string; data: Record<string, unknown> }[];
    assert.equal(events.filter(x => x.type === "plan_committed").length, fixture.expectedWrites);
    assert.equal(events.filter(x => x.type === "execute_attempt").length, e.final.attempts);
    const committed = events.findIndex(x => x.type === "plan_committed");
    if (committed >= 0) {
      const receipt = e.database.receipts[0].receipt;
      assert.deepEqual(receipt, e.final.receipt);
      assert.deepEqual(events[committed].data, receipt);
      assert.equal(e.database.plans[0].id, receipt.planId);
      const approval = events.findIndex(x => x.type === "approve" && x.actor === "user" && x.data.approvalId === receipt.approvalId);
      assert.ok(approval >= 0 && approval < committed);
      for (const key of ["proposalId", "contentHash", "contextRevision"]) assert.equal(events[approval].data[key], receipt[key]);
      assert.ok(!events.slice(approval + 1, committed).some(x => ["revoke", "decline", "context_updated", "profile_changed", "proposal_published"].includes(x.type)));
    }
    writes += fixture.expectedWrites; attempts += e.final.attempts;
  }
  const summary = await load(join(root, "summary.json"));
  assert.equal(sha(await readFile(join(root, "summary.json"))), hashes["summary.json"]);
  assert.equal(summary.businessCommits, writes); assert.equal(summary.executeAttempts, attempts);
  assert.equal(summary.cases, 24); assert.equal(summary.passed, 24); assert.equal(summary.modelCalls, 0); assert.equal(summary.gpuReady, false);
  console.log(`P1 published evidence integrity: ${Object.keys(manifest).length} files, 24 scripted workflows, ${writes} commits/${attempts} attempts. No live DB/model claims.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
