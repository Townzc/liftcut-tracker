import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { emptyOutbox, type OutboxState } from "@liftcut/core/workout-outbox";
import type { TodayData } from "@liftcut/core/today";
import { MobileOutbox, type OutboxApi } from "./outbox";
import { PersonalQueue } from "./personal-queue";
import { purgeDeletedOwner, stopOwnerQueues } from "./owner-cleanup";

const a = randomUUID(), b = randomUUID(), tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const today = (): TodayData => ({ days: [], session: null, previous: { squat: { weightKg: 80, reps: 8 } } });
const command = () => ({ action: "create" as const, id: randomUUID(), entry: { kind: "body" as const, date: "2026-10-27", weightKg: 70, waistCm: null },
  source: "manual" as const, text: "", anchorDate: "2026-10-27" });
function fixture(api: OutboxApi = { today: async () => today(), send: async () => { throw Error("unused"); } }) {
  const rows = new Map<string, OutboxState>([[a, emptyOutbox(a)], [b, emptyOutbox(b)]]);
  const data = new Map<string, string>([[`liftcut-chat-history:${a}`, "A prose"], [`liftcut-review:${a}`, "A review"],
    [`liftcut-coach-consent:${a}`, "A consent"], [`liftcut-chat-history:${b}`, "B prose"], [`liftcut-personal-v1:${b}:saved`, "B pending"],
    ["liftcut-guest-fact-v1:workspace:one", "guest"], ["liftcut-locale", "en"], [`deletion-receipt:${a}`, "keep until cleanup confirmed"]]);
  const outboxStore = { read: async (owner: string) => structuredClone(rows.get(owner) ?? null),
    write: async (owner: string, state: OutboxState) => { rows.set(owner, structuredClone(state)); },
    removeOwner: async (owner: string) => { rows.delete(owner); } };
  const storage = { getAllKeys: async () => [...data.keys()], getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); }, removeItem: async (key: string) => { data.delete(key); } };
  const outbox = new MobileOutbox(a, outboxStore, api, () => {}), personal = new PersonalQueue(a, storage, async () => 200);
  const history = { owner: a, client: { dispose: () => {}, whenStored: async () => {} } };
  return { rows, data, stores: { outboxStore, storage }, clients: { outbox, personal, history } };
}

test("late refresh cannot restore a deleted owner's rows; other accounts, guest, preferences and receipt survive", async () => {
  const reply = deferred<TodayData>(); let signal: AbortSignal | undefined;
  const f = fixture({ today: async s => { signal = s; return reply.promise; }, send: async () => { throw Error("unused"); } });
  const refresh = f.clients.outbox.refresh(); const rejected = assert.rejects(refresh, /QUEUE_DISPOSED/);
  await tick(); let finished = false;
  const purging = purgeDeletedOwner({ status: "deleted", owner: a }, f.clients, f.stores).then(() => { finished = true; });
  await tick(); assert.equal(signal?.aborted, true); assert.equal(finished, false);
  reply.resolve(today()); await rejected; await purging;
  assert.equal(f.rows.has(a), false); assert.equal(f.rows.has(b), true);
  for (const key of [`liftcut-chat-history:${a}`, `liftcut-review:${a}`, `liftcut-coach-consent:${a}`]) assert.equal(f.data.has(key), false);
  for (const key of [`liftcut-chat-history:${b}`, `liftcut-personal-v1:${b}:saved`, "liftcut-guest-fact-v1:workspace:one", "liftcut-locale", `deletion-receipt:${a}`]) assert.equal(f.data.has(key), true);
  await assert.rejects(f.clients.outbox.refresh(), /QUEUE_DISPOSED/);
});

test("purge waits for an already-started outbox storage write and history write before erasing", async () => {
  const f = fixture(), started = deferred<void>(), write = deferred<void>(), history = deferred<void>();
  const original = f.stores.outboxStore.write;
  f.stores.outboxStore.write = async (owner, state) => { started.resolve(); await write.promise; await original(owner, state); };
  f.clients.history.client.whenStored = async () => { await history.promise; f.data.set(`liftcut-chat-history:${a}`, "late draft"); };
  const refresh = f.clients.outbox.refresh(); await started.promise;
  let finished = false;
  const purging = purgeDeletedOwner({ status: "deleted", owner: a }, f.clients, f.stores).then(() => { finished = true; });
  write.resolve(); await refresh; await tick(); assert.equal(finished, false);
  history.resolve(); await purging; assert.equal(f.rows.has(a), false); assert.equal(f.data.has(`liftcut-chat-history:${a}`), false);
});

test("pending stops personal HTTP work without removing unconfirmed bytes; purge waits for local submits", async () => {
  const f = fixture(), response = deferred<number>(); let signal: AbortSignal | undefined;
  f.clients.personal = new PersonalQueue(a, f.stores.storage, async (_body, s) => { signal = s; return response.promise; });
  await f.clients.personal.submit(command()); const keys = await f.clients.personal.pending();
  const draining = f.clients.personal.drain(); await tick(); stopOwnerQueues(a, f.clients);
  response.resolve(200); await draining; await f.clients.personal.whenIdle();
  assert.equal(signal?.aborted, true); assert.equal(f.data.has(keys[0]), true); assert.equal(f.rows.has(a), true);
  await assert.rejects(f.clients.personal.submit(command()), /QUEUE_DISPOSED/);
  const next = fixture(), writing = deferred<void>(), started = deferred<void>(), original = next.stores.storage.setItem;
  next.stores.storage.setItem = async (key, value) => { started.resolve(); await writing.promise; await original(key, value); };
  const submitting = next.clients.personal.submit(command()); await started.promise;
  const purging = purgeDeletedOwner({ status: "deleted", owner: a }, next.clients, next.stores);
  writing.resolve(); await submitting; await purging;
  assert.equal([...next.data.keys()].some(key => key.startsWith(`liftcut-personal-v1:${a}:`)), false);
});

test("pending stop retains the exact workout head after a late transport answer", async () => {
  const reply = deferred<Awaited<ReturnType<OutboxApi["send"]>>>(); let requests = 0;
  const f = fixture({ today: async () => today(), send: async () => { requests++; return reply.promise; } });
  f.rows.get(a)!.items.push({ id: randomUUID(), action: "end", bodyJson: '{"same":"bytes"}', createdAt: "2026-10-27T00:00:00Z", status: "pending", attempts: 0, nextAttempt: 0 });
  const before = JSON.stringify(f.rows.get(a)), draining = f.clients.outbox.drain(); await tick();
  stopOwnerQueues(a, f.clients); reply.resolve({ ok: false, status: 401, code: "SIGNED_OUT" });
  await draining; await f.clients.outbox.whenIdle(); await f.clients.outbox.drain();
  assert.equal(JSON.stringify(f.rows.get(a)), before); assert.equal(requests, 1);
});

test("unknown result or mismatched owner never stops or purges another account; cleanup errors can be retried", async () => {
  const f = fixture();
  await assert.rejects(purgeDeletedOwner({ status: "pending" as "deleted", owner: a }, f.clients, f.stores));
  await assert.rejects(purgeDeletedOwner({ status: "deleted", owner: b }, f.clients, f.stores), /ACCOUNT_CHANGED/);
  assert.throws(() => stopOwnerQueues(a, { ...f.clients, history: { ...f.clients.history, owner: b } }), /ACCOUNT_CHANGED/);
  await f.clients.outbox.refresh(); assert.equal(f.rows.has(a), true); assert.equal(f.rows.has(b), true);
  const remove = f.stores.storage.removeItem;
  f.stores.storage.removeItem = async () => { throw Error("disk unavailable"); };
  await assert.rejects(purgeDeletedOwner({ status: "deleted", owner: a }, f.clients, f.stores), /disk unavailable/);
  f.stores.storage.removeItem = remove;
  await purgeDeletedOwner({ status: "deleted", owner: a }, f.clients, f.stores);
  assert.equal(f.rows.has(a), false); assert.equal(f.rows.has(b), true);
});
