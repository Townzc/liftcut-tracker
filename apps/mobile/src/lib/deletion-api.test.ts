import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { deletionApi, freshDeletionAuth } from "./deletion-api";
import { OwnerRuntime } from "./owner-runtime";

const owner = randomUUID(), user = { id: owner, email: "synthetic@local.test", aud: "authenticated", created_at: new Date().toISOString() };
const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.synthetic`;
test("isolated SDK reauthentication verifies the server user and closes only its temporary session", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const path = new URL(String(url)).pathname; calls.push(path);
    if (path.endsWith("/token")) { assert.equal(JSON.parse(String(options?.body)).password, "synthetic password");
      return Response.json({ access_token: token, token_type: "bearer", refresh_token: "synthetic-refresh", expires_in: 3600, user }); }
    assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${token}`);
    return path.endsWith("/user") ? Response.json(user) : new Response(null, { status: 204 });
  };
  const auth = await freshDeletionAuth(owner, user.email, "synthetic password", { url: "http://127.0.0.1:55460", key: "synthetic-anon" }, fetcher);
  assert.equal(auth.owner, owner); assert.equal(auth.token, token); await auth.close();
  assert.deepEqual(calls, ["/auth/v1/token", "/auth/v1/user", "/auth/v1/logout"]);
  const wrong: typeof fetch = async url => String(url).includes("/token")
    ? Response.json({ access_token: token, token_type: "bearer", refresh_token: "test", expires_in: 3600, user: { ...user, id: randomUUID() } }) : new Response(null, { status: 204 });
  await assert.rejects(freshDeletionAuth(owner, user.email, "test", { url: "http://127.0.0.1:55460", key: "synthetic-anon" }, wrong), /AUTH/);
});
test("native receipt retries send no bearer/cookies; feature-off and expiry are explicit", async () => {
  const seen: RequestInit[] = []; const api = deletionApi(async (_url, options) => {
    seen.push(options!);
    return options?.method === "GET" ? Response.json({ available: false }) : options?.method === "POST" ? Response.json({ status: "pending" })
      : Response.json({ error: "receipt_expired" }, { status: 400 });
  });
  assert.equal(await api.available(), false); await api.begin(owner, token, randomUUID());
  assert.equal(new Headers(seen[1].headers).get("x-workout-owner"), owner);
  await assert.rejects(api.resume(owner, "synthetic receipt"), /receipt_expired/);
  const headers = new Headers(seen[2].headers);
  assert.equal(headers.get("authorization"), null); assert.equal(headers.get("cookie"), null); assert.equal(headers.get("x-liftcut-deletion-receipt"), "1");
  assert.equal(headers.get("x-workout-owner"), owner);
});
test("effect replay retains a worker; real release still stops and drains it", async () => {
  const runtime = new OwnerRuntime(); let stopped = 0;
  const worker = { stop: () => { stopped++; }, idle: async () => {} };
  runtime.register(owner, worker)(); const release = runtime.register(owner, worker);
  await Promise.resolve(); assert.equal(stopped, 0);
  release(); await Promise.resolve(); assert.equal(stopped, 1);
});
