import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { coachRequestSchema, coachResponseSchema } from "@liftcut/core/coach-contract";
import { coachRequestSchema as webRequest } from "../src/lib/coach-model";
import { projectOperation } from "@liftcut/core/workout-outbox";
import { coachFixture } from "./fixtures/coach-contract";
import { planContextFixture } from "./fixtures/coach-plans";

test("shared request preserves old clients, optional conversation identity and strict input limits", () => {
  const { request } = coachFixture(), { conversationId, ...legacy } = request;
  assert.equal(webRequest, coachRequestSchema);
  assert.deepEqual(coachRequestSchema.parse(legacy), legacy);
  assert.equal(coachRequestSchema.parse(request).conversationId, conversationId);
  for (const patch of [{ conversationId: "bad" }, { history: Array(13).fill({ role: "user", content: "x" }) },
    { text: " " }, { timezone: "not/a/zone" }, { authorization: "confirm_preview" }, { consent: "old" }])
    assert.equal(coachRequestSchema.safeParse({ ...request, ...patch }).success, false);
});

test("new review and every legacy proposal share one closed response contract", () => {
  const { reply, session, hash } = coachFixture();
  assert.deepEqual(coachResponseSchema.parse(reply), reply);
  const plain = { ...reply }; delete plain.proposal;
  assert.deepEqual(coachResponseSchema.parse(plain), plain);
  const proposals = [
    { kind: "personal", command: { action: "create", id: randomUUID(), entry: { kind: "body", date: "2026-10-22", weightKg: 71, waistCm: null },
      source: "manual", text: "synthetic", anchorDate: "2026-10-22" } },
    { kind: "workout", session, hash, draft: { kind: "end", explicit: false },
      operation: { action: "end", body: { id: session.id, revision: 2, status: "ended" } } },
    { kind: "workout", session, hash, draft: { kind: "record", exerciseId: "row", explicit: true,
      sets: [{ setIndex: 1, weightKg: null, reportedWeight: null, inputUnit: null, reps: 9, rpe: null }] },
      operation: { action: "apply", body: { id: randomUUID(), sessionId: session.id, version: 1, text: "记录 坐姿划船 9 次",
        contextHash: hash, setIds: [randomUUID()], authorization: "confirm_preview" } } },
    { kind: "plan", run: { id: randomUUID(), version: "p1-app-v1", status: "planning", revision: 0, contextRevision: 0,
      kind: "training", baseline: [], context: planContextFixture, attempts: 0, approvalId: null, proposal: null, receipt: null, events: [] } },
  ];
  for (const proposal of proposals) assert.deepEqual(coachResponseSchema.parse({ ...plain, proposal }).proposal, proposal);
  for (const proposal of [{ kind: "future-write" }, { kind: "workoutReview" }, { kind: "plan" },
    { ...proposals[1], operation: { action: "delete", body: {} } }])
    assert.equal(coachResponseSchema.safeParse({ ...plain, proposal }).success, false);
});

test("review rejects mismatched identities, missing confirmation and client-supplied write values", () => {
  const { reply } = coachFixture(); assert.equal(reply.proposal?.kind, "workoutReview");
  if (reply.proposal?.kind !== "workoutReview") throw new Error("fixture");
  const p = reply.proposal;
  for (const patch of [{ id: randomUUID() }, { conversationId: randomUUID() }, { sessionId: randomUUID() },
    { authorization: undefined }, { requests: p.review.requests }]) {
    const proposal = { ...p, operation: { ...p.operation, body: { ...p.operation.body, ...patch } } };
    assert.equal(coachResponseSchema.safeParse({ ...reply, proposal }).success, false);
  }
  assert.equal(coachResponseSchema.safeParse({ ...reply, requestId: randomUUID() }).success, false);
});

test("prose claiming completion and queued review never become confirmed actuals", () => {
  const { reply, session } = coachFixture();
  const parsed = coachResponseSchema.parse({ ...reply, message: "已完成", proposal: undefined });
  assert.equal(parsed.proposal, undefined);
  assert.equal(session.sets.length, 0);
  if (reply.proposal?.kind !== "workoutReview") throw new Error("fixture");
  const today = { session, days: [], previous: {} };
  assert.deepEqual(projectOperation(today, reply.proposal.operation, session.startedAt), today);
});
