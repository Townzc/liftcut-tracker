import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Calendar synthetic plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'训练 H')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'卧推',3,'5',8)", [exercise, day]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]); await db.end();
});

test("the history calendar and muscle volume show only today's confirmed sets; a skipped set and empty days add nothing", async ({ page }) => {
  await page.goto("http://localhost:3103/login");
  await page.locator("#email").fill("p1-fixture@example.invalid"); await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click(); await page.waitForURL(/\/(?:onboarding)?$/);
  await page.goto("/today"); await page.getByRole("button", { name: "开始训练", exact: true }).click();
  const row = (n: number) => page.getByTestId(`set-${exercise}-${n}`);
  for (const n of [1, 2]) {
    await row(n).getByLabel("重量 (kg)").fill("60"); await row(n).getByLabel("次数", { exact: true }).fill("5");
    await row(n).getByRole("button", { name: "完成", exact: true }).click(); await expect(row(n).getByText("已完成", { exact: true })).toBeVisible();
  }
  await row(3).getByRole("button", { name: "跳过", exact: true }).click(); await expect(row(3).getByText("已跳过", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "结束训练", exact: true }).click(); await expect(page.getByTestId("outbox-status")).toHaveText("已同步");

  await page.goto("/workout");
  const card = page.getByTestId("training-calendar");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()); // The browser's timezone in this config.
  const cell = card.getByRole("button", { name: `${today} · 2 组`, exact: true });
  await expect(cell).toBeVisible();
  await expect(card.getByRole("button")).toHaveCount(1); // Every other day of the year has no record and is not a button.
  await expect(card.getByRole("status")).toHaveText("过去一年训练 1 天，共 2 组。");
  await cell.click(); await expect(card.getByTestId("calendar-selected")).toHaveText(`${today} · 2 组`);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "node_modules/.cache/w1b/training-calendar-mobile.png" });

  // 卧推 is a chest exercise in the catalog: two confirmed sets, the lightest trained shade, nothing elsewhere.
  const volume = page.getByTestId("muscle-volume"), list = volume.getByTestId("volume-list");
  await expect(list.getByRole("listitem")).toHaveCount(1); await expect(list).toContainText("胸部"); await expect(list).toContainText("2 组");
  await expect(volume.locator('[data-region="chest"]').first()).toHaveClass(/fill-slate-300/);
  await expect(volume.locator('[data-region="quadriceps"]').first()).toHaveClass(/fill-slate-100/);
  await volume.getByRole("button", { name: "近 28 天" }).click(); await expect(list).toContainText("2 组");
  // Phone width; a taller window keeps the page's fixed save bar below the card for the capture.
  await page.setViewportSize({ width: 390, height: 1800 }); await volume.screenshot({ path: "node_modules/.cache/w1b/muscle-volume-mobile.png" });
});
