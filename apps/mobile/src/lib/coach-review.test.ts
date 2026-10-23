import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyOutbox } from "@liftcut/core/workout-outbox";
import { coachFixture } from "../../../../tests/fixtures/coach-contract";
import { reviewWriteState } from "./coach-review";
import { MobileOutbox } from "./outbox";

test("review confirmations reuse the outbox; lost answers retry identical bytes without optimistic actuals", async () => {
  const { reply, session, set } = coachFixture(), p = reply.proposal;
  if (p?.kind !== "workoutReview") throw new Error("fixture");
  let stored = emptyOutbox(session.userId), now = 1000, calls = 0;
  stored.confirmed = { session, days: [], previous: {} };
  const payloads: string[] = [], writes = new Set<string>();
  const outbox = new MobileOutbox(session.userId, { read: async () => structuredClone(stored), write: async (_, s) => { stored = structuredClone(s); } }, {
    today: async () => stored.confirmed!, send: async (action, body) => {
      assert.equal(action, "review"); payloads.push(body); writes.add(JSON.parse(body).id);
      if (++calls === 1) throw Error("answer lost");
      return { ok: true, value: { session: { ...session, sets: [{ ...set, exerciseName: "坐姿划船", updatedAt: session.startedAt }] }, receipts: [] } };
    },
  }, () => {}, () => now);
  assert.equal(reviewWriteState(p, stored), "unknown"); assert.equal(calls, 0);
  await outbox.enqueue(p.operation); await outbox.drain();
  assert.equal(stored.confirmed!.session!.sets.length, 0); assert.equal(reviewWriteState(p, stored), "pending");
  await outbox.enqueue(p.operation); assert.equal(stored.items.length, 1);
  now += 100000; await outbox.retry();
  assert.equal(writes.size, 1); assert.equal(payloads[0], payloads[1]); assert.equal(reviewWriteState(p, stored), "saved");
  assert.equal(reviewWriteState(p, { ...stored, owner: "different-owner" }), "unknown");
  stored.confirmed!.session!.sets[0].revision++;
  assert.equal(reviewWriteState(p, stored), "unknown"); // An old reply cannot certify the corrected row.
});
