// Read-only audit against an original OR freshly restored real Postgres database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { AgentStore } from "../../src/services/agent/store";
import { cases } from "./cases";
import { load, localDatabase, runtimeUrl, sha, snapshot } from "./evidence";
async function main() {
  const directory = process.argv[2]; assert.ok(directory, "Evidence directory required");
  const hashes = await load(join(directory, "sha256.json"));
  assert.deepEqual(Object.keys(hashes).sort(), [...cases.map(c => `${c.id}.json`), "summary.json"].sort());
  for (const [name, hash] of Object.entries(hashes)) assert.equal(sha(await readFile(join(directory, name))), hash, name);
  const db = new Pool({ connectionString: localDatabase().toString() }), pool = new Pool({ connectionString: runtimeUrl() });
  const store = new AgentStore(pool);
  try {
    let writes = 0, attempts = 0;
    for (const fixture of cases) {
      const evidence = await load(join(directory, `${fixture.id}.json`));
      assert.deepEqual(evidence.fixture, fixture); assert.equal(evidence.modelCalls, 0);
      assert.equal(evidence.evidenceKind, "scripted_application_postgres");
      assert.deepEqual(await snapshot(db, evidence.user, evidence.runId), evidence.database);
      const actual = await store.get(evidence.user, evidence.runId); assert.ok(actual.ok);
      assert.deepEqual(JSON.parse(JSON.stringify(actual.value)), evidence.final);
      assert.equal(actual.value.status, fixture.expectedStatus);
      assert.equal(evidence.database.plans.length, fixture.expectedWrites);
      writes += evidence.database.plans.length; attempts += actual.value.attempts;
    }
    const summary = await load(join(directory, "summary.json"));
    assert.equal(summary.passed, 24); assert.equal(summary.businessCommits, writes); assert.equal(summary.executeAttempts, attempts);
    console.log(JSON.stringify({ evidenceKind: "scripted_application_postgres", database: localDatabase().pathname,
      workflowsVerified: 24, exactSnapshotsAndRestrictedReads: true, writes, attempts, modelCalls: 0, backupReceiptForModelExperiment: false }));
  } finally { await pool.end(); await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
