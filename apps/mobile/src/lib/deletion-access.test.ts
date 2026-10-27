import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileDeletionAccess } from "./deletion-access";
import { AccountDeletion, type DeletionRecord } from "./account-deletion";

const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const intent: DeletionRecord = { owner, email: "synthetic@local.test", requestId: "33333333-3333-4333-8333-333333333333", receipt: null, stage: "preparing" };
test("server availability alone cannot enable a new mobile deletion; both explicit gates are needed", t => {
  const prior = process.env.EXPO_PUBLIC_MOBILE_ACCOUNT_DELETION;
  delete process.env.EXPO_PUBLIC_MOBILE_ACCOUNT_DELETION;
  t.after(() => { if (prior === undefined) delete process.env.EXPO_PUBLIC_MOBILE_ACCOUNT_DELETION; else process.env.EXPO_PUBLIC_MOBILE_ACCOUNT_DELETION = prior; });
  for (const flag of [undefined, "false", "TRUE", "1", ""]) assert.deepEqual(mobileDeletionAccess(true, undefined, owner, flag), { showEntry: false, canBegin: false });
  assert.equal(mobileDeletionAccess(false, undefined, owner, "true").canBegin, false);
  assert.deepEqual(mobileDeletionAccess(true, undefined, owner, "true"), { showEntry: true, canBegin: true });
});
test("only the prior owner's intent can recover with build gate off, and recovery never skips confirmation", async () => {
  let current: string | undefined = owner, posts = 0;
  const data = new Map([[`liftcut-deletion-v1:${owner}`, JSON.stringify(intent)]]);
  const client = new AccountDeletion({ store: { getAllKeys: async () => [...data.keys()], getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); }, removeItem: async key => { data.delete(key); } },
    currentOwner: () => current, uuid: () => { throw Error("must reuse prior intent"); }, runtime: { block() {}, async idle() {} },
    api: { async begin(actualOwner, _token, id) { posts++; assert.equal(actualOwner, owner); assert.equal(id, intent.requestId);
      return { status: "pending", requestId: id, receipt: "synthetic-receipt".repeat(4) }; }, async resume() { throw Error("not part of this check"); } },
    async purge() {}, async signOut() {} });
  await client.load(); const record = client.records.get(owner);
  assert.equal(mobileDeletionAccess(true, record, owner, "false").canBegin, true);
  const fresh = async () => ({ owner, token: "synthetic", async close() {} });
  await client.begin(owner, intent.email, false, fresh); assert.equal(posts, 0);
  current = other; assert.equal(mobileDeletionAccess(true, record, current, "false").canBegin, false);
  assert.equal(mobileDeletionAccess(true, record, current, "true").canBegin, false);
  await client.begin(owner, intent.email, true, fresh); assert.equal(posts, 0);
  current = undefined; await client.begin(owner, intent.email, true, fresh); assert.equal(posts, 1);
  assert.equal(mobileDeletionAccess(false, record, current, "false").showEntry, true);
  assert.equal(mobileDeletionAccess(false, record, current, "false").canBegin, false);
  assert.equal(mobileDeletionAccess(true, { ...record!, stage: "deleted" }, current, "false").canBegin, false);
});
