import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { fixtureRecipient } from "./recipient-fixture";

const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const owner = "11111111-1111-4111-8111-111111111111";
test.afterAll(async () => { await db.end(); });

test("all cloud entry routes reject old or changed consent before quota or model work", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("p1-fixture@example.invalid");
  await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/(?:onboarding)?$/);
  const current = await fixtureRecipient(page.request);
  const count = async () => (await (await page.request.get("http://127.0.0.1:59999/__model-requests")).json()).count;
  const quota = async () => (await db.query("select count(*)::int n from coach_request_usage where user_id=$1", [owner])).rows[0].n;
  const before = { count: await count(), quota: await quota() };
  const coach = { id: randomUUID(), text: "hello", history: [], locale: "en", timezone: "UTC", consent: "coach-model-v2" };
  const review = { sessionId: randomUUID(), requestKey: randomUUID(), locale: "en", timezone: "UTC", consent: "coach-model-v2" };
  try { for (const recipient of [undefined, "a".repeat(64)]) {
    for (const path of ["/api/ai/coach", "/api/workout-review", "/api/ai/generate-training-plan", "/api/ai/generate-nutrition-plan"]) {
      const headers: Record<string, string> = { Origin: "http://localhost:3103" };
      if (recipient) headers["X-LiftCut-AI-Recipient"] = recipient;
      const response = await page.request.post(path, { headers, data: { ...(path.endsWith("/coach") ? coach : path.endsWith("/workout-review") ? review : {}), recipient } });
      expect(response.status(), path).toBe(409);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect((await response.json()).error).toBe("AI_CONSENT_REQUIRED");
    }
  }
  expect({ count: await count(), quota: await quota() }).toEqual(before);
  // The rejected ID was never reserved; explicitly sending after renewal can use it.
  const response = await page.request.post("/api/ai/coach", { headers: { Origin: "http://localhost:3103" }, data: { ...coach, recipient: current } });
  expect(response.status()).toBe(200);
  expect((await response.json()).proposal).toBeUndefined();
  expect(await count()).toBe(before.count + 1);
  expect(await quota()).toBe(before.quota + 1);
  } finally { await db.query("delete from coach_request_usage where id=$1 and user_id=$2", [coach.id, owner]); }
});
