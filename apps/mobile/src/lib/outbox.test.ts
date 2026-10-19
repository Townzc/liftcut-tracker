import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { tapSetRequest } from "@liftcut/core/set-requests";
import type { Session, TodayData } from "@liftcut/core/today";
import { projectOperation, type OutboxState, type WorkoutOperation } from "@liftcut/core/workout-outbox";
import { MobileOutbox, type OutboxApi } from "./outbox";

const owner = randomUUID(), sessionId = randomUUID();
const today = (): TodayData => ({ days: [], previous: {}, session: { id: sessionId, userId: owner, localDate: "2026-10-19", timezone: "Asia/Shanghai",
  trainingPlanId: "p", weekNumber: 1, dayNumber: 1, status: "active", revision: 1, startedAt: "2026-10-19T00:00:00Z", endedAt: null, sets: [],
  prescription: { title: "A", exercises: [{ id: "bench", name: "卧推", sets: 3, repRange: "5", targetRpe: 8 }] } } });
const set = (setIndex: number, reps = 5): WorkoutOperation => {
  const r = tapSetRequest({ id: randomUUID(), sessionId, planExerciseId: "bench", setIndex, prefilled: false, changed: { weight: false, reps: false },
    status: "done", weightKg: 60, reps, rpe: null });
  assert.ok(r.success); return { action: "set", body: r.data };
};
/** A store on disk is a JSON string; a cold start is a new client reading it. */
function memoryStore() { let saved: string | null = null; return { read: async () => saved ? JSON.parse(saved) as OutboxState : null,
  write: async (_: string, s: OutboxState) => { saved = JSON.stringify(s); } }; }
/** The fake server applies the same projection the real one validates against, and can be offline or lose responses. */
function server() {
  let data = today(); const received: string[] = []; const mode = { offline: false, loseResponse: false, reject: null as null | { status: number; code: string } };
  const api: OutboxApi = {
    async today() { if (mode.offline) throw new Error("offline"); return structuredClone(data); },
    async send(action, bodyJson) {
      if (mode.offline) throw new Error("offline");
      received.push(bodyJson);
      if (mode.reject) return { ok: false, ...mode.reject };
      const body = JSON.parse(bodyJson), already = data.session!.sets.find(s => s.id === body.id && s.revision === body.revision);
      if (!already) data = projectOperation(data, { action, body }, new Date().toISOString());
      if (mode.loseResponse) { mode.loseResponse = false; throw new Error("connection reset"); }
      return { ok: true, value: structuredClone(data.session as Session) };
    } };
  return { api, mode, received, data: () => data };
}

test("offline cold start shows the stored day, queues three sets in order and syncs exactly three once online", async () => {
  const store = memoryStore(), remote = server(); let clock = 0;
  await new MobileOutbox(owner, store, remote.api, () => {}).refresh(); // Last time online.
  remote.mode.offline = true;
  let shown: OutboxState | null = null;
  const app = new MobileOutbox(owner, store, remote.api, s => { shown = s; }, () => clock);
  assert.equal((await app.load()).confirmed?.session?.id, sessionId); // Cold start without a network.
  for (const n of [1, 2, 3]) await app.enqueue(set(n));
  await app.drain();
  assert.equal(shown!.items.length, 3); assert.equal(shown!.items[0].status, "retry");
  assert.equal(remote.received.length, 0);
  remote.mode.offline = false; clock = 60_000;
  await app.drain();
  assert.equal(shown!.items.length, 0);
  assert.deepEqual(remote.data().session!.sets.map(s => s.setIndex), [1, 2, 3]);
  assert.deepEqual(remote.received.map(b => JSON.parse(b).setIndex), [1, 2, 3]); // Exact order.
});

test("a double tap is one write; a lost response resends the same bytes and still records once", async () => {
  const remote = server(), app = new MobileOutbox(owner, memoryStore(), remote.api, () => {}, () => 0);
  await app.refresh();
  const op = set(1);
  remote.mode.loseResponse = true;
  await app.enqueue(op); await app.enqueue(op);
  await app.drain();
  assert.equal(remote.received.length, 1);
  await app.retry();
  assert.equal(remote.received.length, 2); assert.equal(remote.received[0], remote.received[1]);
  assert.equal(remote.data().session!.sets.length, 1);
  await assert.rejects(app.enqueue({ action: "set", body: { ...(op.body as object), reps: 6 } }), /LOCAL_CONFLICT/); // Same id, new bytes.
});

test("a conflict pauses the whole tail until the user keeps the cloud version; auth pauses too", async () => {
  const remote = server(), store = memoryStore(), app = new MobileOutbox(owner, store, remote.api, () => {}, () => 0);
  await app.refresh();
  remote.mode.reject = { status: 409, code: "STALE_REVISION" };
  await app.enqueue(set(1)); await app.enqueue(set(2)); await app.drain();
  let state = await app.load();
  assert.deepEqual(state.items.map(i => i.status), ["conflict", "pending"]); assert.equal(remote.received.length, 1);
  await assert.rejects(app.enqueue(set(3)), /LOCAL_CONFLICT/);
  await app.retry(); assert.equal(remote.received.length, 1); // A conflict is never retried blindly.
  state = await app.discardConflict();
  assert.deepEqual([state.items.length, state.discarded?.[0].items.length], [0, 2]);
  remote.mode.reject = { status: 401, code: "UNAUTHORIZED" };
  await app.enqueue(set(1)); await app.drain();
  assert.equal((await app.load()).items[0].status, "auth");
});
