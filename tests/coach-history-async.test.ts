import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CoachHistoryClient, type HistoryIO } from "@liftcut/core/coach-history-client";
import { coachFixture } from "./fixtures/coach-contract";

const turn = () => ({ id: randomUUID(), text: "synthetic", at: new Date().toISOString(), reply: "data" as const });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function io(entries = new Map<string, string>()): HistoryIO {
  return { storage: { getItem: async k => entries.get(k) ?? null, setItem: async (k, v) => { entries.set(k, v); }, removeItem: async k => { entries.delete(k); } },
    request: async () => { throw Error("offline"); }, activate() {}, dispose() {}, online: () => false, uuid: randomUUID };
}

test("asynchronous writes stay ordered; leaving retains prose but never executable proposals", async () => {
  const entries = new Map<string, string>(), adapter = io(entries), gate = deferred(), owner = randomUUID();
  const write = adapter.storage.setItem; let first = true;
  adapter.storage.setItem = async (k, v) => { if (first) { first = false; await gate.promise; } await write(k, v); };
  const a = new CoachHistoryClient(owner, false, adapter); await a.activate();
  const id = a.snapshot().id, t = { ...turn(), pending: true, lines: ["provisional"], proposal: coachFixture().reply.proposal };
  a.setTurns([t]); a.setText("older draft"); a.setText("latest draft"); a.dispose(false);
  gate.resolve(); await a.whenStored();
  const raw = entries.get(`liftcut-chat-history:${owner}`)!;
  assert.equal(raw.includes('"proposal":'), false); assert.equal(raw.includes("provisional"), false);
  const b = new CoachHistoryClient(owner, false, io(entries)); await b.activate();
  assert.equal(b.snapshot().id, id); assert.equal(b.snapshot().text, "latest draft");
  assert.equal(b.snapshot().turns[0].interrupted, true); assert.equal("proposal" in b.snapshot().turns[0], false);
  const other = new CoachHistoryClient(randomUUID(), false, io(entries)); await other.activate(); assert.deepEqual(other.snapshot().turns, []);
  b.dispose(); await b.whenStored(); assert.equal(entries.has(`liftcut-chat-history:${owner}`), false); other.dispose();
});

test("a late storage read cannot reopen a disposed account", async () => {
  const adapter = io(), gate = deferred(), id = randomUUID(); let published = 0;
  adapter.storage.getItem = async () => { await gate.promise; return JSON.stringify({ version: 1, active: id, chats: [{ id, text: "old account", items: [], dirty: [] }] }); };
  const client = new CoachHistoryClient(randomUUID(), false, adapter); client.subscribe(() => { published++; });
  const activating = client.activate(); await Promise.resolve(); client.dispose(); gate.resolve(); await activating;
  assert.equal(published, 0); assert.equal(client.snapshot().ready, false); assert.equal(client.snapshot().text, "");
});

test("effect cleanup followed by immediate reactivation preserves the stored draft", async () => {
  const entries = new Map<string, string>(), owner = randomUUID(), a = new CoachHistoryClient(owner, false, io(entries));
  await a.activate(); a.setText("persisted draft"); await a.whenStored(); a.dispose(false);
  const b = new CoachHistoryClient(owner, false, io(entries)), first = b.activate();
  b.dispose(); await b.activate(); await first;
  assert.equal(b.snapshot().text, "persisted draft"); b.dispose(); await b.whenStored(); assert.equal(entries.size, 0);
});

test("cache failures are reported and malformed remote history is not adopted", async () => {
  const adapter = io(); adapter.storage.setItem = async () => { throw Error("full"); };
  const client = new CoachHistoryClient(randomUUID(), false, adapter); await client.activate(); client.setText("unsaved");
  await client.whenStored(); assert.equal(client.snapshot().sync, "error"); assert.equal(client.snapshot().error, "LOCAL_STORAGE");
  adapter.request = async () => ({ items: [{ turn: { ...turn(), proposal: { kind: "unknown" } }, revision: 1 }], next: null });
  const id = client.snapshot().id; await client.select(randomUUID());
  assert.equal(client.snapshot().id, id); assert.deepEqual(client.snapshot().turns, []); client.dispose();
});
