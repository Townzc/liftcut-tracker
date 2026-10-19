import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Session aids synthetic plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'训练 B')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'卧推',3,'5',8)", [exercise, day]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]); await db.end();
});
type Mode = "grant" | "deny" | "absent";
async function stubWakeLock(page: Page, mode: Mode) {
  await page.addInitScript((mode: Mode) => {
    const w = window as unknown as { wake: { requests: number; releases: number; active: number; last?: { release(): Promise<void> } } };
    w.wake = { requests: 0, releases: 0, active: 0 };
    const request = async () => {
      if (mode === "deny") throw new DOMException("Denied by test", "NotAllowedError");
      w.wake.requests++; w.wake.active++;
      const listeners: (() => void)[] = [];
      const sentinel = { released: false, type: "screen", addEventListener: (_: string, f: () => void) => listeners.push(f),
        release: async () => { if (sentinel.released) return; sentinel.released = true; w.wake.active--; w.wake.releases++; listeners.forEach(f => f()); } };
      w.wake.last = sentinel; return sentinel;
    };
    Object.defineProperty(Navigator.prototype, "wakeLock", { configurable: true, get: () => mode === "absent" ? undefined : { request } });
  }, mode);
}
async function start(page: Page) {
  await page.goto("http://localhost:3103/login");
  await page.locator("#email").fill("p1-fixture@example.invalid"); await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click(); await page.waitForURL(/\/(?:onboarding)?$/);
  await page.goto("/today"); await page.getByRole("button", { name: "开始训练", exact: true }).click();
}
const wake = (page: Page) => page.evaluate(() => (window as unknown as { wake: { requests: number; releases: number; active: number } }).wake);
const row = (page: Page, n: number) => page.getByTestId(`set-${exercise}-${n}`);

test("completing a set starts rest; corrections and skips do not; the screen stays on only while active", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.clock.install(); await stubWakeLock(page, "grant"); await start(page);
  await expect.poll(async () => (await wake(page)).active).toBe(1);
  await page.getByLabel("组间休息时长").selectOption("60");
  await row(page, 1).getByLabel("重量 (kg)").fill("60"); await row(page, 1).getByLabel("次数", { exact: true }).fill("5");
  await row(page, 1).getByRole("button", { name: "完成", exact: true }).click();
  const timer = page.getByTestId("rest-timer");
  await expect(timer).toContainText(/组间休息\s*(01:00|00:59)/);
  await timer.getByRole("button", { name: "+30 秒" }).click(); await expect(timer).toContainText(/01:(29|30)/);
  await page.screenshot({ path: "node_modules/.cache/w1b/rest-timer-mobile.png" });
  await page.clock.fastForward(91_000);
  await expect(timer.getByRole("status")).toHaveText("休息结束，可以开始下一组");
  await timer.getByRole("button", { name: "知道了" }).click(); await expect(timer).toBeHidden();
  await row(page, 1).getByRole("button", { name: "更正", exact: true }).click(); await row(page, 1).getByLabel("次数", { exact: true }).fill("6");
  await row(page, 1).getByRole("button", { name: "保存更正" }).click(); await expect(row(page, 1)).toContainText("× 6");
  await row(page, 2).getByRole("button", { name: "跳过", exact: true }).click(); await expect(row(page, 2)).toContainText("已跳过");
  await expect(timer).toBeHidden();
  // The browser releases the lock on hide; returning to the page takes it again, once.
  await page.evaluate(async () => {
    const set = (v: string) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v }); document.dispatchEvent(new Event("visibilitychange")); };
    set("hidden"); await (window as unknown as { wake: { last: { release(): Promise<void> } } }).wake.last.release(); set("visible"); set("visible");
  });
  await expect.poll(async () => [(await wake(page)).requests, (await wake(page)).active]).toEqual([2, 1]);
  await expect(page.getByLabel("组间休息时长")).toHaveValue("60");
  await page.reload(); await expect(page.getByLabel("组间休息时长")).toHaveValue("60"); // Per-device preference.
  await expect.poll(async () => (await wake(page)).active).toBe(1);
  // Act only after the reload's refresh settles; an earlier tap is rejected as a stale revision by design.
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  await page.getByRole("button", { name: "结束训练", exact: true }).click();
  await expect.poll(async () => (await wake(page)).active).toBe(0);
  expect(errors).toEqual([]);
});

for (const mode of ["deny", "absent"] as const) test(`wake lock ${mode}: workout continues silently`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await stubWakeLock(page, mode); await start(page);
  await row(page, 1).getByLabel("重量 (kg)").fill("60"); await row(page, 1).getByLabel("次数", { exact: true }).fill("5");
  await row(page, 1).getByRole("button", { name: "完成", exact: true }).click();
  await expect(row(page, 1).getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByTestId("rest-timer")).toBeVisible();
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  expect((await wake(page)).requests).toBe(0); expect(errors).toEqual([]);
});
