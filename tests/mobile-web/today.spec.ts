import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { expectBearerOnly, relay, signIn, type Sent } from "./helpers";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("update public.training_plans set is_active=false where user_id=$1", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Mobile synthetic plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'手机训练 A')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'卧推',2,'5',8)", [exercise, day]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]); await db.end();
});
test("the Expo app signs in, reads today through a bearer token, switches language and signs out", async ({ page }) => {
  const errors: string[] = [], sent: Sent[] = [];
  page.on("pageerror", e => errors.push(e.message)); await relay(page, sent);
  await signIn(page, "node_modules/.cache/mobile-web/sign-in-mobile.png");
  await expect(page.getByText("选择今天的训练日")).toBeVisible();
  await expect(page.getByRole("button", { name: "第 1 周第 1 天 · 手机训练 A" })).toBeVisible();
  // Start through the same API with the same kind of token; the app shows the session after a reload.
  const token = (await (await page.request.post("http://127.0.0.1:55440/auth/v1/token?grant_type=password",
    { data: { email: "p1-fixture@example.invalid", password: "p1-fixture-password" } })).json()).access_token;
  expect((await page.request.post("http://localhost:3103/api/workout-sessions?action=start", { headers: { Authorization: `Bearer ${token}` },
    data: { id: randomUUID(), dayId: day, timezone: "Asia/Shanghai" } })).status()).toBe(200);
  await page.reload();
  await expect(page.getByText("进行中的训练 · 手机训练 A")).toBeVisible();
  await expect(page.getByText("已完成 0 / 2 组")).toBeVisible();
  await expect(page.getByText("杠铃卧推", { exact: true })).toBeVisible(); // Catalog label from @liftcut/core.
  await expect(page.getByText("计划：2 组 × 5 次 · 目标 RPE 8", { exact: true })).toBeVisible();
  await page.screenshot({ path: "node_modules/.cache/mobile-web/today-mobile.png" });
  expectBearerOnly(sent);
  await page.getByText("设置", { exact: true }).click();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByText("Language", { exact: true })).toBeVisible();
  await expect(page.getByText("p1-fixture@example.invalid")).toBeVisible();
  await page.screenshot({ path: "node_modules/.cache/mobile-web/settings-en-mobile.png" });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Sign in to LiftCut", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
