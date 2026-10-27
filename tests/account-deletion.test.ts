import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { deletionReceipt, executeDeletion, matchDeletionOwner, recentAuthentication, startDeletion, verifyDeletionReceipt, type DeletionAdapter } from "../src/services/account-deletion/operations";

const owner = randomUUID(), other = randomUUID(), requestId = randomUUID(), secret = "local-test-deletion-receipt-only-secret";
test("deletion requires literal confirmation, a closed request and actual recent authentication", () => {
  for (const input of [{ requestId }, { requestId, confirmed: false }, { requestId, confirmed: true, owner: other }]) assert.equal(startDeletion.safeParse(input).success, false);
  const claims = { sub: owner, role: "authenticated", session_id: randomUUID(), amr: [{ method: "password", timestamp: 1000 }] };
  assert.equal(recentAuthentication(claims, owner, 1100), true);
  assert.equal(recentAuthentication(claims, other, 1100), false);
  assert.equal(recentAuthentication({ ...claims, iat: 1500 }, owner, 1500), false);
  assert.equal(recentAuthentication({ ...claims, amr: [{ method: "token_refresh", timestamp: 1100 }] }, owner, 1100), false);
});
test("receipt rejects tampering, expiry, another signing key and training-token purposes", () => {
  const receipt = deletionReceipt(owner, requestId, secret, 1000);
  assert.equal(verifyDeletionReceipt(receipt, secret, 2000).owner, owner);
  const otherPurpose = Buffer.from(JSON.stringify({ owner, requestId, purpose: "training", expires: 3601000 })).toString("base64url");
  const training = `${otherPurpose}.${createHmac("sha256", secret).update(otherPurpose).digest("base64url")}`;
  for (const [value, key, time] of [[receipt + ".extra", secret, 2000], [receipt + ".", secret, 2000], [receipt, secret + "x", 2000], [receipt, secret, 3601000], [training, secret, 2000]] as const) {
    assert.throws(() => verifyDeletionReceipt(value, key, time), /invalid_receipt/);
  }
});
test("partial Storage failure stays pending; retry removes all pages and final response loss does not repeat Auth delete", async () => {
  const files = [...Array.from({ length: 2410 }, (_, i) => `${owner}/${"nested/".repeat(20)}file-${i}`), `${other}/photo`];
  let exists = true, failed = false, deleted = 0;
  const calls: string[] = [];
  const adapter: DeletionAdapter = {
    async exists(id) { assert.equal(id, owner); return exists; },
    async begin(id, request) { assert.equal(id, owner); assert.equal(request, requestId); calls.push("barrier"); },
    async files(prefix, request) { assert.equal(prefix, owner); assert.equal(request, requestId); assert.equal(calls[0], "barrier"); return files.filter(p => p.startsWith(`${prefix}/`)).slice(0, 100); },
    async remove(paths) { if (!failed) { failed = true; throw new Error("storage unavailable"); } for (const path of paths) { assert.ok(path.startsWith(`${owner}/`)); files.splice(files.indexOf(path), 1); } },
    async deleteUser(id) { assert.equal(id, owner); assert.deepEqual(files, [`${other}/photo`]); exists = false; deleted++; },
  };
  const identity = verifyDeletionReceipt(deletionReceipt(owner, requestId, secret), secret);
  await assert.rejects(executeDeletion(adapter, identity)); assert.equal(exists, true); assert.equal(deleted, 0);
  await assert.rejects(executeDeletion(adapter, identity), /pending/); assert.equal(files.length, 11); assert.equal(deleted, 0);
  assert.equal((await executeDeletion(adapter, identity)).status, "deleted");
  assert.equal((await executeDeletion(adapter, identity)).status, "deleted"); assert.equal(deleted, 1);
  assert.deepEqual(files, [`${other}/photo`]);
});
test("unknown Auth state, unsafe paths and unsuccessful deletion never report success", async () => {
  const identity = verifyDeletionReceipt(deletionReceipt(owner, requestId, secret), secret);
  let deleted = false;
  const adapter: DeletionAdapter = { exists: async () => true, begin: async () => {}, files: async () => [`${other}/photo`],
    remove: async () => {}, deleteUser: async () => { deleted = true; } };
  await assert.rejects(executeDeletion(adapter, identity), /pending/); assert.equal(deleted, false);
  adapter.files = async () => [];
  await assert.rejects(executeDeletion(adapter, identity), /pending/);
  adapter.exists = async () => { throw new Error("transport"); };
  await assert.rejects(executeDeletion(adapter, identity), /transport/);
});
test("switched accounts cannot consume another owner's proof; expired proof only recovers completed deletion", async () => {
  assert.throws(() => matchDeletionOwner(owner, other, owner), /owner_mismatch/);
  assert.throws(() => matchDeletionOwner(owner, null, other), /owner_mismatch/);
  matchDeletionOwner(owner, null, owner); matchDeletionOwner(owner, owner, null);
  const identity = verifyDeletionReceipt(deletionReceipt(owner, requestId, secret, 1000), secret, 3601001, true);
  let exists = true, writes = 0;
  const adapter: DeletionAdapter = { exists: async () => exists, begin: async () => { writes++; }, files: async () => [], remove: async () => { writes++; }, deleteUser: async () => { writes++; } };
  await assert.rejects(executeDeletion(adapter, identity, 3601001), /receipt_expired/);
  assert.equal(writes, 0);
  exists = false;
  assert.equal((await executeDeletion(adapter, identity, 3601001)).status, "deleted");
  assert.equal(writes, 0);
  assert.throws(() => verifyDeletionReceipt(deletionReceipt(owner, requestId, secret, 1000), secret + "bad", 3601001, true), /invalid_receipt/);
});
