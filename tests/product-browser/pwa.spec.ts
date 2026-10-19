import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'PWA synthetic plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'训练 P')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'PWA 深蹲',2,'5',8)", [exercise, day]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]); await db.end();
});
const cached = (page: Page) => page.evaluate(async () => {
  const urls: string[] = [];
  for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) urls.push(new URL(request.url).pathname);
  return urls;
});

test("manifest, icons and worker headers are served without signing in", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const body = await manifest.json();
  expect([body.name, body.short_name, body.display, body.start_url]).toEqual(["LiftCut Tracker", "LiftCut", "standalone", "/"]);
  for (const icon of body.icons) {
    const response = await request.get(icon.src);
    expect([icon.src, response.status(), response.headers()["content-type"]]).toEqual([icon.src, 200, "image/png"]);
  }
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toBe("no-cache, no-store, must-revalidate");
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect((await request.get("/offline.html")).status()).toBe(200);
});

test("with the worker active: login, offline outbox sync and the offline page work; only the shell is cached", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://localhost:3103/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // Now controlled: the sign-in below runs through the worker.
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.locator("#email").fill("p1-fixture@example.invalid"); await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click(); await page.waitForURL(/\/(?:onboarding)?$/);
  await page.goto("/today"); await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  await context.setOffline(true);
  const row = page.getByTestId(`set-${exercise}-1`);
  await row.getByLabel("重量 (kg)").fill("70"); await row.getByLabel("次数", { exact: true }).fill("5");
  await row.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("待同步 1 条");
  await context.setOffline(false);
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  expect((await db.query("select l.weight_kg,l.reps,l.status from set_logs l join workout_sessions s on s.id=l.session_id where s.training_plan_id=$1", [plan])).rows)
    .toEqual([{ weight_kg: "70", reps: 5, status: "done" }]);
  const shell = await cached(page);
  expect(shell).toContain("/offline.html");
  expect(shell.some(p => p.startsWith("/_next/static/"))).toBe(true);
  for (const path of shell) expect(path === "/offline.html" || path.startsWith("/icons/") || path.startsWith("/_next/static/"), path).toBe(true);
  await context.setOffline(true);
  await page.goto("/current-plan").catch(() => {});
  await expect(page.getByRole("heading", { name: "当前离线 · You're offline" })).toBeVisible();
  await page.screenshot({ path: "node_modules/.cache/w1b/pwa-offline-mobile.png" });
  await context.setOffline(false);
  await page.getByRole("link", { name: "重试 · Retry" }).click();
  await expect(page.getByRole("heading", { name: "当前离线 · You're offline" })).toBeHidden();
  expect(errors).toEqual([]);
});
