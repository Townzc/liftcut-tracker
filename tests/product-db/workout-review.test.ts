import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Outcome, RunView } from "@liftcut/core/agent-contracts";
import type { SetRequest } from "@liftcut/core/today";
import { AgentStore } from "../../src/services/agent/store";
import { TodayStore } from "../../src/services/today/store";
import { acceptReview, reviewWorkout, rollbackReview, type ReviewModel, type ReviewOutcome } from "../../src/services/ai/workout-review";
import { COACH_CONSENT_VERSION } from "../../src/lib/coach-model";
import { trainingFixture, planContextFixture as context } from "../fixtures/coach-plans";
import { testUrl } from "./today-setup";

const value = <T>(r: Outcome<T>): T => { assert.equal(r.ok, true, JSON.stringify(r)); return (r as { ok: true; value: T }).value; };
const binding = (r: RunView) => ({ proposalId: r.proposal!.proposalId, contentHash: r.proposal!.contentHash, contextRevision: r.proposal!.contextRevision });
const proposed = (o: ReviewOutcome) => { assert.equal(o.status, "proposed", JSON.stringify(o)); return (o as { run: RunView }).run; };
const role = (name: string, password: string) => { const url = new URL(testUrl()); url.username = name; url.password = password; return new Pool({ connectionString: url.toString(), max: 4 }); };

test("a requested review becomes a ledger proposal only when its closed changes cite real sets", async t => {
  const admin = new Pool({ connectionString: testUrl() }), workoutPool = role("liftcut_workout", "w1b-local-fixture-only");
  const agent = new AgentStore(role("liftcut_agent", "p1-local-fixture-only")), today = new TodayStore(workoutPool);
  const owner = randomUUID(), other = randomUUID(), runs = () => admin.query("select status from agent_private.runs where user_id=$1 order by created_at", [owner]);
  let seen = ""; // What the model was sent, to check the allowlist.
  const scripted = (answer: (ids: string[]) => unknown): ReviewModel => async ({ user }) => { seen = user; return answer(JSON.parse(user).sets.map((s: { id: string }) => s.id)); };
  const request = (sessionId: string) => ({ sessionId, requestKey: randomUUID(), consent: COACH_CONSENT_VERSION, locale: "zh", timezone: "UTC" });
  try {
    await admin.query("insert into auth.users values($1),($2)", [owner, other]);
    await admin.query("insert into user_settings(user_id,weekly_training_days,session_duration_minutes,injury_notes) values($1,2,45,'膝盖旧伤')", [owner]);
    // An active plan created through the ledger, then one finished workout of its first day.
    let run = value(await agent.prepare(owner, randomUUID(), await agent.planContext(owner, "training"), context, trainingFixture));
    run = value(await agent.userEvent(owner, run.id, { action: "approve", expectedRevision: run.revision, binding: binding(run) }));
    value(await agent.execute(owner, run.id, { binding: binding(run), approvalId: run.approvalId!, idempotencyKey: run.proposal!.proposalId }));
    const day = (await admin.query(`select d.id from training_plan_days d join training_plan_weeks w on w.id=d.week_id join training_plans p on p.id=w.training_plan_id
      where p.user_id=$1 and p.is_active and d.day_number=1`, [owner])).rows[0].id;
    const session = await today.start(owner, { id: randomUUID(), dayId: day, timezone: "UTC" });
    const squat = session.prescription.exercises.find(e => e.name === "深蹲")!.id;
    let latest = session;
    for (const setIndex of [1, 2, 3]) latest = await today.writeSet(owner, { id: randomUUID(), sessionId: session.id, planExerciseId: squat, setIndex, revision: 1, status: "done",
      weightKg: 60, reps: 10, rpe: 6, weightSource: "user_entered", repsSource: "user_entered", inputUnit: "kg", sourceRef: "today-tap" } satisfies SetRequest);
    await today.end(owner, { id: session.id, revision: latest.revision + 1, status: "ended" });
    const before = (await runs()).rows.length;

    await t.test("valid changes become one proposal awaiting approval; the active plan is untouched", async () => {
      const outcome = await reviewWorkout(owner, request(session.id), { pool: workoutPool, agent, model: scripted(ids => ({ outcome: "changes",
        changes: [{ type: "adjust_sets", exercise: "深蹲", delta: 1, why: "三组都很轻松", evidence: ids.slice(0, 3) }] })) });
      assert.equal(outcome.status, "proposed");
      const proposed = outcome.status === "proposed" ? outcome.run : null;
      assert.equal(proposed?.status, "awaiting_approval");
      const plan = (await admin.query("select plan from agent_private.proposals where run_id=$1", [proposed!.id])).rows[0].plan;
      assert.equal(plan.weeks[0].days[0].exercises.find((e: { name: string }) => e.name === "深蹲").sets, 4);
      assert.equal((await admin.query(`select e.sets from training_plan_exercises e join training_plan_days d on d.id=e.day_id where d.id=$1 and e.name='深蹲'`, [day])).rows[0].sets, 3);
      const event = (await admin.query("select data from agent_private.events where run_id=$1 and type='workout_review'", [proposed!.id])).rows[0].data;
      assert.equal(event.sessionId, session.id);
      // The model saw set rows and plan targets only: no settings notes, no user ids.
      assert.doesNotMatch(seen, /膝盖|user_?id/i); assert.match(seen, /"setIndex":1/);
    });
    await t.test("invented evidence, unknown types and nochange never reach the ledger", async () => {
      const count = (await runs()).rows.length;
      const forged = await reviewWorkout(owner, request(session.id), { pool: workoutPool, agent, model: scripted(() => ({ outcome: "changes",
        changes: [{ type: "adjust_sets", exercise: "深蹲", delta: 1, why: "x", evidence: [randomUUID()] }] })) });
      assert.equal(forged.status, "invalid");
      const load = await reviewWorkout(owner, request(session.id), { pool: workoutPool, agent, model: scripted(ids => ({ outcome: "changes",
        changes: [{ type: "set_weight", exercise: "深蹲", weightKg: 65, why: "x", evidence: ids }] })) });
      assert.deepEqual(load, { status: "invalid", problems: ["schema"] });
      const none = await reviewWorkout(owner, request(session.id), { pool: workoutPool, agent, model: scripted(ids => ({ outcome: "nochange", why: "按计划继续", evidence: ids.slice(0, 1) })) });
      assert.equal(none.status, "nochange");
      assert.equal((await runs()).rows.length, count);
    });
    await t.test("another account's session yields nothing to review", async () => {
      const outcome = await reviewWorkout(other, request(session.id), { pool: workoutPool, agent, model: async () => { throw new Error("must not call the model"); } });
      assert.deepEqual(outcome, { status: "unavailable", error: "NO_FINISHED_SETS" });
    });
    const twoChanges = scripted(ids => ({ outcome: "changes", changes: [{ type: "adjust_sets", exercise: "深蹲", delta: 1, why: "三组都很轻松", evidence: ids.slice(0, 2) },
      { type: "adjust_rpe", exercise: "深蹲", delta: -0.5, why: "最后一组偏重", evidence: ids.slice(2, 3) }] }));
    const squatNow = async () => (await admin.query(`select e.sets, e.target_rpe::float as rpe from training_plan_exercises e join training_plan_days d on d.id=e.day_id
      join training_plan_weeks w on w.id=d.week_id join training_plans p on p.id=w.training_plan_id
      where p.user_id=$1 and p.is_active and w.week_number=1 and d.day_number=1 and e.name='深蹲'`, [owner])).rows[0];
    const apply = async (r: RunView) => {
      const approved = value(await agent.userEvent(owner, r.id, { action: "approve", expectedRevision: r.revision, binding: binding(r) }));
      value(await agent.execute(owner, r.id, { binding: binding(approved), approvalId: approved.approvalId!, idempotencyKey: approved.proposal!.proposalId }));
    };
    const status = async (id: string) => (await admin.query("select status from agent_private.runs where id=$1", [id])).rows[0].status;

    await t.test("accepting some changes replaces the preview; applying and rolling back both go through approval", async () => {
      const review = proposed(await reviewWorkout(owner, request(session.id), { pool: workoutPool, agent, model: twoChanges }));
      const accept = { runId: review.id, requestKey: randomUUID(), timezone: "UTC", accepted: [0] };
      const narrowed = proposed(await acceptReview(owner, accept, { agent }));
      assert.notEqual(narrowed.id, review.id);
      assert.equal(await status(review.id), "declined");
      assert.equal(proposed(await acceptReview(owner, accept, { agent })).id, narrowed.id); // A retry returns the same preview.
      assert.deepEqual(await acceptReview(owner, { ...accept, requestKey: randomUUID() }, { agent }), { status: "unavailable", error: "REVIEW_CLOSED" });
      assert.deepEqual(await squatNow(), { sets: 3, rpe: 7 }); // Nothing applies before approval.
      await apply(narrowed);
      assert.deepEqual(await squatNow(), { sets: 4, rpe: 7 }); // Only the accepted change.

      const undo = { runId: narrowed.id, requestKey: randomUUID(), timezone: "UTC" };
      const restore = proposed(await rollbackReview(owner, undo, { agent }));
      assert.equal(proposed(await rollbackReview(owner, undo, { agent })).id, restore.id);
      assert.deepEqual(await squatNow(), { sets: 4, rpe: 7 });
      await apply(restore);
      assert.deepEqual(await squatNow(), { sets: 3, rpe: 7 });
      assert.equal(await status(narrowed.id), "applied"); // History is kept; the undo is a new applied run.
      assert.equal(proposed(await rollbackReview(owner, undo, { agent })).id, restore.id);
      assert.deepEqual(await rollbackReview(owner, { ...undo, requestKey: randomUUID() }, { agent }), { status: "unavailable", error: "CONTEXT_STALE" });
    });
    await t.test("a review made before the plan changed can no longer be accepted, and keys cannot be reused across actions", async () => {
      const older = proposed(await reviewWorkout(owner, request(session.id), { pool: workoutPool, agent, model: twoChanges }));
      const newer = proposed(await reviewWorkout(owner, request(session.id), { pool: workoutPool, agent, model: twoChanges }));
      const key = randomUUID();
      const easier = proposed(await acceptReview(owner, { runId: newer.id, requestKey: key, timezone: "UTC", accepted: [1] }, { agent }));
      assert.deepEqual(await rollbackReview(owner, { runId: newer.id, requestKey: key, timezone: "UTC" }, { agent }), { status: "unavailable", error: "KEY_CONFLICT" });
      await apply(easier);
      assert.deepEqual(await squatNow(), { sets: 3, rpe: 6.5 });
      const again = { runId: easier.id, requestKey: randomUUID(), timezone: "UTC", accepted: [0] }; // All of it, after it was applied.
      assert.deepEqual([proposed(await acceptReview(owner, again, { agent })).id, await status(easier.id)], [easier.id, "applied"]);
      assert.deepEqual(await acceptReview(owner, { runId: older.id, requestKey: randomUUID(), timezone: "UTC", accepted: [0] }, { agent }),
        { status: "unavailable", error: "CONTEXT_STALE" });
      assert.deepEqual(await acceptReview(owner, { runId: older.id, requestKey: randomUUID(), timezone: "UTC", accepted: [3] }, { agent }),
        { status: "unavailable", error: "REVIEW_NOT_FOUND" });
    });
    assert.ok(before >= 1);
  } finally {
    await admin.query("delete from workout_sessions where user_id=$1", [owner]);
    await admin.end(); await workoutPool.end();
  }
});
