import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AccountDeletion } from "../packages/core/src/account-deletion-client";
const a = randomUUID(), b = randomUUID(), receipt = "synthetic-receipt-not-a-real-proof".repeat(2);
function fixture() {
  const data = new Map<string, string>(); let posts = 0;
  const io = { store: { getAllKeys: async () => [...data.keys()], getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); }, removeItem: async (key: string) => { data.delete(key); } },
    runtime: { block() {}, idle: async () => {} }, uuid: randomUUID, currentOwner: () => a,
    api: { begin: async (owner: string, _token: string, requestId: string) => { assert.equal(owner, a); posts++; return { status: "pending", requestId, receipt }; },
      resume: async () => { throw Error("unused"); } }, purge: async () => {}, signOut: async () => {} };
  const fresh = async () => ({ owner: a, token: "synthetic", close: async () => {} });
  return { data, io, fresh, client: new AccountDeletion(io), posts: () => posts };
}
test("a verified OAuth identity without email persists null without inventing an address; old email records still load", async () => {
  const f = fixture(); await f.client.begin(a, null, true, f.fresh);
  assert.equal(f.client.error, ""); assert.equal(f.posts(), 1); assert.equal(f.client.records.get(a)?.email, null);
  f.data.set(`liftcut-deletion-v1:${b}`, JSON.stringify({ owner: b, email: "old@local.test", requestId: randomUUID(), receipt, stage: "pending" }));
  const restored = new AccountDeletion(f.io); await restored.load();
  assert.equal(restored.records.get(a)?.email, null); assert.equal(restored.records.get(b)?.email, "old@local.test");
});
test("missing email does not weaken confirmation or verified-owner checks, and malformed email remains invalid", async () => {
  const f = fixture(); await f.client.begin(a, null, false, f.fresh);
  await f.client.begin(a, null, true, async () => ({ ...await f.fresh(), owner: b }));
  await f.client.begin(a, "not-an-email", true, f.fresh);
  assert.equal(f.posts(), 0); assert.equal(f.data.size, 0);
});
