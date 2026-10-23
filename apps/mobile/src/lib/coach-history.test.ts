import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mobileHistory, type HistoryAuth } from "./coach-history";

test("history uses bearer credentials refreshed per request, rejects account changes and preserves local drafts", async () => {
  const entries = new Map<string, string>(), owner = randomUUID(), requests: RequestInit[] = [];
  let auth: HistoryAuth | null = { access_token: "first", user: { id: owner } };
  const storage = { getItem: async (k: string) => entries.get(k) ?? null, setItem: async (k: string, v: string) => { entries.set(k, v); }, removeItem: async (k: string) => { entries.delete(k); } };
  const fetcher = (async (_url, init) => { requests.push(init!); return Response.json({ items: [], next: null }); }) as typeof fetch;
  const history = mobileHistory(owner, false, storage, randomUUID, () => auth, fetcher); await history.activate();
  auth.access_token = "refreshed"; await history.refreshList();
  assert.deepEqual(requests.at(-1)?.headers, { Authorization: "Bearer refreshed", "X-Workout-Owner": owner, "Content-Type": "application/json" });
  assert.equal(requests.at(-1)?.credentials, undefined);
  const n = requests.length; auth = { access_token: "foreign", user: { id: randomUUID() } }; await history.refreshList();
  assert.equal(requests.length, n); assert.equal(history.snapshot().error, "ACCOUNT_CHANGED");
  history.setText("local draft"); const id = history.snapshot().id; history.dispose(false); await history.whenStored();
  auth = { access_token: "again", user: { id: owner } };
  const restored = mobileHistory(owner, false, storage, randomUUID, () => auth, fetcher); await restored.activate();
  assert.equal(restored.snapshot().text, "local draft"); assert.equal(restored.snapshot().id, id);
  restored.dispose(); await restored.whenStored(); assert.equal(entries.size, 0);
});

test("account changes while reading a remote page never reveal that page", async () => {
  const owner = randomUUID(); let auth: HistoryAuth | null = { access_token: "token", user: { id: owner } };
  const storage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  const fetcher = (async () => { auth = null; return Response.json({ items: [{ id: randomUUID(), title: "old account", updatedAt: new Date().toISOString() }], next: null }); }) as typeof fetch;
  const history = mobileHistory(owner, false, storage, randomUUID, () => auth, fetcher);
  await history.activate(); await history.refreshList(); assert.deepEqual(history.snapshot().threads, []); history.dispose();
});
