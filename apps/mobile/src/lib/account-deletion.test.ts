import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AccountDeletion, type DeletionApi } from "./account-deletion";
import { OwnerRuntime } from "./owner-runtime";

const a = randomUUID(), b = randomUUID(), receipt = "synthetic-receipt-only-not-a-token".repeat(2), tick = () => new Promise<void>(r => setImmediate(r));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const data = new Map<string, string>(), calls: string[] = [], runtime = new OwnerRuntime(); let current: string | undefined = a;
  const store = { getAllKeys: async () => [...data.keys()], getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); }, removeItem: async (key: string) => { data.delete(key); } };
  let requestId = "";
  const api: DeletionApi = {
    begin: async (owner, _token, id) => { calls.push("POST"); assert.equal(owner, a); assert.equal(runtime.isBlocked(a), true);
      assert.equal(JSON.parse(data.get(`liftcut-deletion-v1:${a}`)!).requestId, id); requestId = id; return { status: "pending", requestId: id, receipt }; },
    resume: async (owner, value) => { assert.equal(owner, a); calls.push(value); return { status: "deleted", requestId }; },
  };
  const io = { store, runtime, api, uuid: randomUUID, currentOwner: () => current,
    purge: async (owner: string) => { calls.push(`purge:${owner}`); }, signOut: async (owner: string) => { calls.push(`out:${owner}`); current = undefined; } };
  const client = new AccountDeletion(io), fresh = async () => ({ owner: a, token: "fresh synthetic", close: async () => { calls.push("close"); } });
  return { data, calls, runtime, store, api, io, client, fresh, switchTo: (owner?: string) => { current = owner; } };
}
test("deletion requires confirmation and fresh same-owner auth; intent is durable before POST", async () => {
  const f = fixture(); await f.client.load();
  await f.client.begin(a, "a@local.test", false, f.fresh); assert.equal(f.calls.length, 0);
  await f.client.begin(a, "a@local.test", true, async () => ({ ...await f.fresh(), owner: b }));
  assert.equal(f.data.size, 0); assert.equal(f.calls.includes("POST"), false);
  await f.client.begin(a, "a@local.test", true, f.fresh);
  assert.equal(f.client.records.get(a)?.stage, "pending"); assert.equal(f.calls.includes(`purge:${a}`), false);
  const row = f.data.get(`liftcut-deletion-v1:${a}`)!; assert.equal(row.includes("fresh synthetic"), false);
  const restored = new AccountDeletion(f.io); await restored.load();
  assert.equal(restored.records.get(a)?.receipt, receipt); assert.equal(f.runtime.isBlocked(a), true); assert.equal(f.runtime.isBlocked(b), false);
});
test("lost POST answer retains intent; reauthentication restores the server's original request", async () => {
  const f = fixture(), original = f.api.begin;
  f.api.begin = async (...args) => { await original(...args); throw Error("NETWORK"); };
  await f.client.begin(a, "a@local.test", true, f.fresh); const id = f.client.records.get(a)!.requestId;
  assert.equal(f.client.records.get(a)?.stage, "preparing"); assert.equal(f.runtime.isBlocked(a), true);
  f.api.begin = original; f.switchTo(); // Recovery remains possible after the main session expired.
  await f.client.begin(a, "a@local.test", true, f.fresh);
  assert.equal(f.client.records.get(a)?.requestId, id); assert.equal(f.client.records.get(a)?.stage, "pending");
});
test("unknown DELETE, expired receipt and a different response request never purge; retries reuse receipt", async () => {
  const f = fixture(); await f.client.begin(a, "a@local.test", true, f.fresh);
  const original = f.api.resume, before = f.data.get(`liftcut-deletion-v1:${a}`);
  for (const error of ["NETWORK", "invalid_receipt"]) {
    f.api.resume = async (_owner, value) => { assert.equal(value, receipt); throw Error(error); };
    await f.client.resume(a); assert.equal(f.data.get(`liftcut-deletion-v1:${a}`), before);
  }
  f.api.resume = async () => ({ status: "deleted", requestId: randomUUID() }); await f.client.resume(a);
  assert.equal(f.calls.includes(`purge:${a}`), false);
  f.api.resume = original; await f.client.resume(a);
  assert.equal(f.data.size, 0); assert.equal(f.client.completed, true); assert.equal(f.calls.includes(`out:${a}`), true);
});
test("confirmed server deletion survives local cleanup failure/restart and refuses active account B", async () => {
  const f = fixture(); await f.client.begin(a, "a@local.test", true, f.fresh);
  f.io.purge = async () => { throw Error("DISK"); }; await f.client.resume(a);
  assert.equal(f.client.records.get(a)?.stage, "deleted"); assert.equal(f.data.size, 1);
  f.io.purge = async owner => { assert.equal(owner, a); }; const restored = new AccountDeletion(f.io); await restored.load(); f.switchTo(b);
  f.api.resume = async () => { throw Error("must not repeat server deletion"); }; await restored.resume(a);
  assert.equal(restored.error, "ACCOUNT_CHANGED"); assert.equal(restored.completed, false); f.switchTo(); await restored.resume(a);
  assert.equal(restored.completed, true); assert.equal(f.calls.includes(`out:${b}`), false); assert.equal(f.calls.includes(`out:${a}`), false);
});
test("storage failure prevents POST and a corrupt restart fails closed", async () => {
  const f = fixture(); f.store.setItem = async () => { throw Error("DISK"); };
  await f.client.begin(a, "a@local.test", true, f.fresh); assert.equal(f.calls.includes("POST"), false);
  f.data.set(`liftcut-deletion-v1:${a}`, "bad"); await f.client.load(); assert.equal(f.client.ready, false);
});
test("owner fence aborts streaming, waits late storage, stops workers and refuses remount without touching B", async () => {
  const runtime = new OwnerRuntime(), late = deferred<void>(); let stopped = 0, signal: AbortSignal | undefined, idle = false;
  const unregister = runtime.register(a, { stop: () => { stopped++; }, idle: async () => {} });
  const task = runtime.run(a, async s => { signal = s; await late.promise; }); const rejected = assert.rejects(task, /ACCOUNT_DELETING/);
  runtime.block(a); const waiting = runtime.idle(a).then(() => { idle = true; }); await tick();
  assert.equal(signal?.aborted, true); assert.equal(idle, false); assert.ok(stopped > 0);
  assert.throws(() => runtime.register(a, { stop() {}, idle: async () => {} }), /ACCOUNT_DELETING/);
  assert.equal(await runtime.run(b, async () => "B remains active"), "B remains active");
  late.resolve(); await rejected; await waiting; unregister(); assert.equal(idle, true);
});
