import assert from "node:assert/strict";
import { test } from "node:test";
import { PersonalQueue, type KeyValueStore } from "./personal-queue";

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: async k => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); }, removeItem: async k => { data.delete(k); }, getAllKeys: async () => [...data.keys()] };
};
const body = (id: string, weightKg = 72.5) => ({ action: "create" as const, id, entry: { kind: "body" as const, date: "2026-10-18", weightKg, waistCm: null },
  source: "conversation" as const, text: "昨天早上称了七十二点五公斤", anchorDate: "2026-10-19" });
const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];

test("a confirmed entry is stored once, resent with the same bytes and removed only after the server acknowledges it", async () => {
  const store = memory(), sent: string[] = [], replies = [503, 200, 200];
  const queue = new PersonalQueue("owner-1", store, async b => { sent.push(b); return replies.shift()!; });
  await queue.submit(body(ids[0])); await queue.submit(body(ids[0])); // A double tap is one request.
  await assert.rejects(queue.submit(body(ids[0], 80)), /CONFLICT/); // Same id, different content.
  assert.equal(await queue.drain(), "retry"); assert.equal(store.data.size, 1);
  await queue.submit(body(ids[1]));
  assert.equal(await queue.drain(), "synced"); assert.equal(store.data.size, 0);
  assert.equal(sent[0], sent[1]); assert.equal(JSON.parse(sent[1]).entry.waistCm, null); // Unknown stays null, never 0.
  assert.deepEqual(sent.map(s => JSON.parse(s).id), [ids[0], ids[0], ids[1]]);
});

test("auth failures keep the queue; a rejected entry stops it until discarded; accounts never mix", async () => {
  const store = memory(), replies = [401, 409, 200];
  const queue = new PersonalQueue("owner-1", store, async () => replies.shift()!);
  await new PersonalQueue("owner-2", store, async () => 200).submit(body(ids[1]));
  await queue.submit(body(ids[0]));
  assert.equal(await queue.drain(), "auth"); assert.deepEqual(await queue.pending(), ["liftcut-personal-v1:owner-1:" + ids[0]]);
  assert.equal(await queue.drain(), "conflict"); assert.equal(await queue.drain(), "conflict");
  await assert.rejects(queue.submit(body(ids[1])), /CONFLICT/);
  await queue.discard(); assert.deepEqual(await queue.pending(), []);
  assert.deepEqual([...store.data.keys()], ["liftcut-personal-v1:owner-2:" + ids[1]]);
});
