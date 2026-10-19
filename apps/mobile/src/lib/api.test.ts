import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, apiBase, apiHeaders, getJson, todaySchema } from "./api";

const session = { access_token: "aaa.bbb.ccc", user: { id: "11111111-1111-4111-8111-111111111111" } };

test("requests carry the bearer token and the account-switch guard, never cookies", async () => {
  assert.deepEqual(apiHeaders(session), { Authorization: "Bearer aaa.bbb.ccc", "X-Workout-Owner": session.user.id });
  assert.equal(apiHeaders(session, true)["Content-Type"], "application/json");
  let seen: [string, RequestInit | undefined] | null = null;
  const body = { days: [{ id: "d1", weekNumber: 1, dayNumber: 2, title: "A", extra: true }], session: null, previous: {}, receipts: [] };
  const data = await getJson("/api/workout-sessions", session, todaySchema,
    async (url, init) => { seen = [String(url), init]; return Response.json(body); });
  assert.equal(seen![0], `${apiBase}/api/workout-sessions`);
  assert.equal((seen![1]?.headers as Record<string, string>).Authorization, "Bearer aaa.bbb.ccc");
  assert.equal((seen![1] as { credentials?: string }).credentials, undefined);
  assert.deepEqual(data, { days: [{ id: "d1", weekNumber: 1, dayNumber: 2, title: "A" }], session: null });
});

test("server errors keep their status and code; malformed bodies are rejected", async () => {
  await assert.rejects(getJson("/x", session, todaySchema, async () => Response.json({ error: "ACCOUNT_CHANGED" }, { status: 409 })),
    (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === "ACCOUNT_CHANGED");
  await assert.rejects(getJson("/x", session, todaySchema, async () => new Response("down", { status: 502 })),
    (e: unknown) => e instanceof ApiError && e.code === "HTTP_502");
  await assert.rejects(getJson("/x", session, todaySchema, async () => Response.json({ days: "nope", session: null })));
});
