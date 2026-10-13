// A local application process. GPU transport lives in a separate authenticated SSH relay.
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { AgentStore } from "../../src/services/agent/store";
import { cases } from "../p1-application/cases";
import { localDatabase, runtimeUrl, sha } from "../p1-application/evidence";
import { snapshot } from "./database";
import { createCase, step, score, scripted, type Checkpoint, type Transport, type NativeReply } from "./engine";
import { VERSION, LIMITS } from "./contract";

type State = { version: string; kind: "scripted" | "model"; transportMode: string; caseIndex: number; checkpoint: string | null;
  checkpointSha: string | null; resumeRequired: boolean; requests: number; startedAt: string; binding: unknown };
async function main() {
  const [output, mode, option] = process.argv.slice(2);
  assert.ok(output && ["scripted", "native-scripted", "model"].includes(mode) && (!option || option === "--resume"));
  const kind = mode === "model" ? "model" : "scripted";
  let binding: { workCutoff: string } | null = null;
  if (kind === "model") {
    assert.ok(process.env.P1M_BINDING_FILE, "Explicit original model-window binding required");
    binding = JSON.parse(await readFile(process.env.P1M_BINDING_FILE, "utf8"));
    assert.ok(binding && Number.isFinite(Date.parse(binding.workCutoff)) && Date.now() < Date.parse(binding.workCutoff));
  }
  const statePath = join(output, "state.json");
  let state: State;
  if (option === "--resume") {
    state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.version, VERSION); assert.equal(state.kind, kind); assert.deepEqual(state.binding, binding);
    assert.equal(state.transportMode, mode);
    assert.equal(state.resumeRequired, true); assert.equal(cases[state.caseIndex].flow, "resume");
    await writeFile(join(output, `resume-used-${state.caseIndex}.json`), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" });
    state.resumeRequired = false;
  } else {
    await mkdir(dirname(output), { recursive: true }); await mkdir(output);
    state = { version: VERSION, kind, transportMode: mode, caseIndex: 0, checkpoint: null, checkpointSha: null,
      resumeRequired: false, requests: 0, startedAt: new Date().toISOString(), binding };
    await writeFile(join(output, "cases.json"), JSON.stringify(cases, null, 2) + "\n", { flag: "wx" });
  }
  const admin = new Pool({ connectionString: localDatabase().toString() });
  const pool = new Pool({ connectionString: runtimeUrl() }); const store = new AgentStore(pool);
  const reader = mode !== "scripted" ? createInterface({ input: process.stdin, crlfDelay: Infinity }) : null;
  const input = reader?.[Symbol.asyncIterator]();
  const complete: Transport = async payload => {
    if (binding && Date.now() >= Date.parse(binding.workCutoff)) throw new Error("ORIGINAL_WORK_CUTOFF");
    if (state.requests >= LIMITS.cases * LIMITS.requestsPerCase) throw new Error("GLOBAL_REQUEST_BUDGET");
    state.requests++;
    if (mode === "scripted") return scripted(payload);
    process.stdout.write(JSON.stringify({ command: "generate", number: state.requests, payload }) + "\n");
    const line = await input!.next();
    assert.ok(!line.done, "MODEL_REPLY_UNCERTAIN");
    const reply = JSON.parse(line.value);
    assert.equal(reply.number, state.requests); assert.equal(reply.evidenceKind, kind);
    assert.ok(reply.native, "Native generation evidence is mandatory");
    return reply as NativeReply;
  };
  const saveState = async () => {
    const temp = join(output, `state-${process.pid}.tmp`);
    await writeFile(temp, JSON.stringify(state, null, 2) + "\n");
    await rename(temp, statePath);
  };
  try {
    while (state.caseIndex < cases.length) {
      let checkpoint: Checkpoint;
      if (state.checkpoint) {
        assert.match(state.checkpoint, /^checkpoint-\d+-\d+\.json$/);
        const bytes = await readFile(join(output, state.checkpoint)); assert.equal(sha(bytes), state.checkpointSha);
        checkpoint = JSON.parse(bytes.toString()); assert.equal(checkpoint.caseIndex, state.caseIndex);
        assert.equal(checkpoint.version, "p1-model-checkpoint-v1");
        assert.equal(checkpoint.resumeIssued, true);
        assert.deepEqual(await snapshot(admin, checkpoint.owner, checkpoint.runId), checkpoint.steps.at(-1)!.database);
      } else {
        checkpoint = await createCase(admin, store, state.caseIndex);
        // Preserve the actual owner/run before the first uncertain model call.
        const initial = `checkpoint-${state.caseIndex}-0.json`, bytes = JSON.stringify(checkpoint, null, 2) + "\n";
        await writeFile(join(output, initial), bytes, { flag: "wx" });
        state.checkpoint = initial; state.checkpointSha = sha(bytes); await saveState();
      }
      state.checkpoint = null; state.checkpointSha = null;
      let progress: "continue" | "resume" | "finished" = "continue";
      while (progress === "continue") {
        progress = await step(checkpoint, admin, store, complete);
        const name = `checkpoint-${state.caseIndex}-${checkpoint.steps.length}.json`;
        // A decision-budget stop adds no step; preserve the final state in the episode result.
        if (progress !== "finished" || checkpoint.steps.length < LIMITS.requestsPerCase) {
          const bytes = JSON.stringify(checkpoint, null, 2) + "\n";
          await writeFile(join(output, name), bytes, { flag: "wx" }); state.checkpoint = name; state.checkpointSha = sha(bytes);
        }
        state.resumeRequired = progress === "resume"; await saveState();
        const intermediate = await score(checkpoint, admin, store);
        if (intermediate.unsafeCommit) throw new Error("UNSAFE_COMMIT_STOP_STUDY");
      }
      if (progress === "resume") {
        process.stdout.write(JSON.stringify({ command: "planned_resume", caseIndex: state.caseIndex, pid: process.pid,
          checkpoint: state.checkpoint, checkpointSha: state.checkpointSha }) + "\n");
        process.exitCode = 75; return;
      }
      const result = await score(checkpoint, admin, store);
      await writeFile(join(output, `case-${state.caseIndex}.json`), JSON.stringify({ kind, checkpoint, result }, null, 2) + "\n", { flag: "wx" });
      state.caseIndex++; state.checkpoint = null; state.checkpointSha = null; await saveState();
    }
    const rows = await Promise.all(cases.map(async (_, i) => JSON.parse(await readFile(join(output, `case-${i}.json`), "utf8"))));
    const summary = { version: VERSION, kind, status: "complete", cases: rows.length,
      passed: rows.filter(r => r.result.passed).length, requests: state.requests, startedAt: state.startedAt,
      finishedAt: new Date().toISOString(), scriptedUserEvents: true, independentGeneralization: false,
      modelCalls: kind === "scripted" ? 0 : rows.reduce((n, r) => n + r.checkpoint.steps.filter((s: { reply: NativeReply }) =>
        (s.reply.native as { model_called?: boolean }).model_called).length, 0),
      writes: rows.reduce((n, r) => n + r.result.writes, 0), attempts: rows.reduce((n, r) => n + r.result.attempts, 0) };
    await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(JSON.stringify({ command: "complete", summary }) + "\n");
  } finally { reader?.close(); if (reader) process.stdin.pause(); await pool.end(); await admin.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
