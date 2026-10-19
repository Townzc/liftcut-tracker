import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
const name = `进阶测试推举-${plan.slice(0, 6)}`; // Unique: history is matched by exercise name.
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Progression synthetic plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'训练 C')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,$3,3,'5',8)", [exercise, day, name]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]); await db.end();
});
const row = (page: Page, n: number) => page.getByTestId(`set-${exercise}-${n}`);
async function complete(page: Page, n: number, weight: string, reps: string) {
  await row(page, n).getByLabel("重量 (kg)").fill(weight); await row(page, n).getByLabel("次数", { exact: true }).fill(reps);
  await row(page, n).getByRole("button", { name: "完成", exact: true }).click(); await expect(row(page, n).getByText("已完成", { exact: true })).toBeVisible();
}

test("the engine target and why come from confirmed history; a set that beats it is called out", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://localhost:3103/login");
  await page.locator("#email").fill("p1-fixture@example.invalid"); await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click(); await page.waitForURL(/\/(?:onboarding)?$/);
  await page.goto("/today"); await page.getByRole("button", { name: "开始训练", exact: true }).click();
  const target = page.getByTestId(`target-${exercise}`);
  await expect(target).toContainText("进阶目标 · 暂不给数字"); // No confirmed history: no number.
  await expect(target).toContainText("不推算数字");
  for (const n of [1, 2, 3]) await complete(page, n, "60", "5");
  await expect(page.getByTestId(/^record-/)).toHaveCount(0); // First-ever sets are not records.
  await page.getByRole("button", { name: "结束训练", exact: true }).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  await page.getByRole("button", { name: "开始另一次训练" }).click();
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(target).toContainText("进阶目标 · 62.5 kg × 5 次 × 3 组");
  await expect(target).toContainText("上次 3 组都以 60 kg 完成 5 次，下次加 2.5 kg 到 62.5 kg。");
  await complete(page, 1, "62.5", "5");
  await expect(row(page, 1)).toContainText("本组破纪录：最大重量 62.5 kg（之前 60 kg）");
  await complete(page, 2, "62.5", "5");
  await expect(row(page, 2).getByTestId(/^record-/)).toHaveCount(0); // Equal to this session's earlier set.
  // The target is computed, never written: no set exists until the user confirms one.
  const session = (await (await page.request.get("/api/workout-sessions")).json()).session;
  expect(session.sets.map((s: { setIndex: number }) => s.setIndex).sort()).toEqual([1, 2]);
  await row(page, 1).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "node_modules/.cache/w1b/progression-mobile.png" });
  await page.getByRole("button", { name: "结束训练", exact: true }).click();
  expect(errors).toEqual([]);
});
