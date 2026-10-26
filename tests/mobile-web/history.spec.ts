import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { expectBearerOnly, relay, signIn, type Sent } from "./helpers";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("update public.training_plans set is_active=false where user_id=$1", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Mobile history plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'手机训练 H')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'卧推',3,'5',8)", [exercise, day]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]); await db.end();
});

test("the app history shows the same calendar and muscle volume as the web, from confirmed sets only", async ({ page }) => {
  const errors: string[] = [], sent: Sent[] = [];
  page.on("pageerror", e => errors.push(e.message)); await relay(page, sent);
  await signIn(page);
  await page.getByRole("button", { name: "开始训练" }).click();
  const status = page.getByTestId("outbox-status"); await expect(status).toHaveText("已同步");
  const row = (n: number) => page.getByTestId(`set-${exercise}-${n}`);
  for (const n of [1, 2]) {
    await row(n).getByLabel(`第 ${n} 组 重量（公斤）`).fill("60"); await row(n).getByLabel(`第 ${n} 组 次数`).fill("5");
    await row(n).getByRole("button", { name: "完成" }).click(); await expect(row(n).getByText("已完成")).toBeVisible();
  }
  await row(3).getByRole("button", { name: "跳过" }).click(); await expect(row(3).getByText("已跳过")).toBeVisible();
  await page.getByRole("button", { name: "结束训练" }).click(); await expect(status).toHaveText("已同步");

  await page.getByRole("link", { name: "历史" }).click();
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA").format(new Date())); // The app's own local date.
  await expect(page.getByText("过去一年训练 1 天，共 2 组。")).toBeVisible();
  const cell = page.getByRole("button", { name: `${today} · 2 组`, exact: true });
  await cell.click(); await expect(page.getByTestId("history-selected")).toHaveText(`${today} · 2 组`);
  await expect(page.getByTestId("volume-list")).toHaveText("胸部 · 2 组"); // 卧推 is chest; nothing else, nothing unclassified.
  await expect(page.getByTestId("region-chest").first()).toHaveCSS("background-color", "rgb(196, 196, 196)");
  await expect(page.getByTestId("region-quadriceps").first()).toHaveCSS("background-color", "rgb(237, 237, 237)");
  await page.screenshot({ path: "node_modules/.cache/mobile-web/history-mobile.png", fullPage: true });
  expectBearerOnly(sent); expect(errors).toEqual([]);
});
