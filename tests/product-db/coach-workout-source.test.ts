import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Pool } from "pg";
import { testUrl } from "./today-setup";
import { runCoach } from "../../src/services/ai/coach-agent";
import { TodayStore } from "../../src/services/today/store";
import { todayPool } from "../../src/services/today/database";

test("live SDK workout tool rejects unsupported values before issuing an approval, then patches one confirmed ID", async t => {
  const admin = new Pool({ connectionString: testUrl() }), url = new URL(testUrl());
  url.username = "liftcut_workout"; url.password = "w1b-local-fixture-only";
  process.env.WORKOUT_DATABASE_URL = url.toString(); process.env.AI_PROVIDER = "local";
  process.env.COACH_SIGNING_SECRET = "synthetic-workout-source-test-not-production";
  const store = new TodayStore(todayPool()), owner = randomUUID(), plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
  let sessionId = "", round = 0, mode: "ordinal" | "history" | "standalone" | "correct" = "ordinal";
  const server = createServer(async (req, res) => {
    for await (const part of req) void part;
    round++;
    const args = { exerciseId: exercise, kind: mode === "history" ? "record" : "correct",
      weightQuote: mode === "history" ? "32.5公斤" : null, repsQuotes: ["7次"], rpeQuote: null, rpeScope: null,
      correctionSet: mode === "ordinal" ? 17 : mode === "correct" ? 2 : null };
    const name = round === 1 ? "current_workout" : round === 2 ? mode === "standalone" ? "prepare_exercise" : "prepare_workout" : "finish_response";
    const input = round === 1 ? {} : round === 2 ? mode === "standalone"
      ? { exerciseQuote: "坐姿划船", dateQuote: null, weightQuote: "32.5公斤", repsQuote: "7次", setsQuote: null, rpeQuote: null }
      : args : { message: "Please clarify the unsupported detail.", sourceIds: [`workout:current:${sessionId}`] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "synthetic", object: "chat.completion", created: 1, model: "scripted-not-real",
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
        tool_calls: [{ id: `call_${round}`, type: "function", function: { name, arguments: JSON.stringify(input) } }] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  process.env.LOCAL_AI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  try {
    await admin.query("insert into auth.users values($1)", [owner]);
    await admin.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'Synthetic source binding',true)", [plan, owner]);
    await admin.query("insert into training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
    await admin.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'Synthetic')", [day, plan + "w"]);
    await admin.query("insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'坐姿划船',20,'99',10)", [exercise, day]);
    let session = await store.start(owner, { id: randomUUID(), dayId: day, timezone: "UTC" }); sessionId = session.id;
    for (const setIndex of [1, 2, 17]) session = await store.writeSet(owner, { id: randomUUID(), sessionId, planExerciseId: exercise,
      setIndex, revision: 1, status: "done", weightKg: 32.5, reps: 10, rpe: 6,
      weightSource: "user_entered", repsSource: "user_entered", inputUnit: "kg", sourceRef: "today-tap" });
    const before = await store.current(owner), target = session.sets.find(s => s.setIndex === 2)!;
    const input = { id: randomUUID(), text: "更正坐姿划船，17公斤，7次", history: [], locale: "en" as const,
      timezone: "UTC", consent: "coach-model-v1" as const };
    await t.test("a load cannot select an existing set number", async () => {
      let trace = "";
      const result = await runCoach(owner, input, AbortSignal.timeout(15000), async steps => { trace = JSON.stringify(steps); });
      assert.equal(result.proposal, undefined); assert.match(trace, /WORKOUT_TARGET_ROLE_MISMATCH/);
      assert.deepEqual(await store.current(owner), before);
    });
    await t.test("older actuals remain history, not this turn's unreported weight", async () => {
      mode = "history"; round = 0; let trace = "";
      const result = await runCoach(owner, { ...input, id: randomUUID(), text: "坐姿划船7次",
        history: [{ role: "user", content: "坐姿划船32.5公斤10次" }] }, AbortSignal.timeout(15000), async steps => { trace = JSON.stringify(steps); });
      assert.equal(result.proposal, undefined); assert.match(trace, /QUOTE_NOT_IN_USER_TEXT/);
      assert.deepEqual(await store.current(owner), before);
    });
    await t.test("choosing standalone exercise memory cannot bypass the current-report check", async () => {
      mode = "standalone"; round = 0; let trace = "";
      const result = await runCoach(owner, { ...input, id: randomUUID(), text: "坐姿划船7次",
        history: [{ role: "user", content: "坐姿划船32.5公斤10次" }] }, AbortSignal.timeout(15000), async steps => { trace = JSON.stringify(steps); });
      assert.equal(result.proposal, undefined); assert.match(trace, /QUOTE_NOT_IN_USER_TEXT/);
      assert.deepEqual(await store.current(owner), before);
      assert.equal((await admin.query("select count(*)::int n from personal_record_events where user_id=$1", [owner])).rows[0].n, 0);
    });
    await t.test("valid correction is unsaved until approval; exact retries patch one row once", async () => {
      mode = "correct"; round = 0;
      const result = await runCoach(owner, { ...input, id: randomUUID(), text: "更正坐姿划船第2组7次" }, AbortSignal.timeout(15000));
      assert.equal(result.proposal?.kind, "workout");
      if (result.proposal?.kind !== "workout") throw new Error("expected unsaved workout preview");
      assert.deepEqual(await store.current(owner), before);
      const operation = result.proposal.operation; assert.equal(operation.action, "apply");
      if (operation.action !== "apply") throw new Error("expected approval operation");
      const results = await Promise.all([store.command(owner, operation.body), store.command(owner, operation.body)]);
      assert.deepEqual(results[0], results[1]);
      const after = results[0].session, patched = after.sets.find(s => s.id === target.id)!;
      assert.equal(after.sets.length, 3); assert.equal(patched.revision, target.revision + 1); assert.equal(patched.reps, 7);
      assert.equal(patched.weightKg, 32.5); assert.equal(patched.rpe, 6);
      assert.equal(after.sets.find(s => s.setIndex === 17)!.reps, 10);
      assert.equal((await admin.query("select count(*)::int n from workout_commands where user_id=$1", [owner])).rows[0].n, 1);
    });
  } finally {
    try { await admin.query("delete from auth.users where id=$1", [owner]); }
    finally {
      await Promise.all([todayPool().end(), admin.end()]);
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});
