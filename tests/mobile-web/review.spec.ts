import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { expectBearerOnly, relay, signIn, type Sent } from "./helpers";
// The review answer comes from the scripted model fixture (never real-model evidence); routes, ledger and PostgreSQL writes are real.
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL }), user = "11111111-1111-4111-8111-111111111111";
const clean = async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id like 'agent-%'", [user]);
  await db.query("update agent_private.runs set current_proposal=null where user_id=$1", [user]);
  for (const table of ["receipts", "execution_keys", "events", "proposals", "runs"]) await db.query(`delete from agent_private.${table} where user_id=$1`, [user]);
  await db.query("delete from training_plans where user_id=$1 and id like 'agent-%'", [user]);
  await db.query("delete from coach_request_usage where user_id=$1", [user]);
};
test.beforeAll(async () => { await clean(); await db.query("update public.training_plans set is_active=false where user_id=$1", [user]); });
test.afterAll(async () => { await clean(); await db.end(); });
// Reviews only change plans made through the approval ledger, so the web chat makes one first.
async function planThroughWebChat(web: Page) {
  await web.goto("http://localhost:3103/login"); await web.locator("#email").fill("p1-fixture@example.invalid"); await web.locator("#password").fill("p1-fixture-password");
  await web.getByRole("button", { name: "登录", exact: true }).click(); await web.waitForURL(/\/(?:onboarding)?$/);
  await web.getByRole("navigation").getByRole("link", { name: "Agent", exact: true }).click(); await web.getByRole("button", { name: "同意并开启", exact: true }).click();
  await web.getByLabel("发给训练助手", { exact: true }).fill("生成训练计划 [training-plan]"); await web.getByRole("button", { name: "发送", exact: true }).click();
  await web.getByRole("button", { name: "查看方案", exact: true }).click(); await web.getByRole("button", { name: "确认并应用", exact: true }).click();
  await expect(web.getByTestId("plan-receipt")).toBeVisible();
}
const squatNow = async () => (await db.query(`select e.sets,e.target_rpe::float as rpe from training_plan_exercises e join training_plan_days d on d.id=e.day_id
  join training_plan_weeks w on w.id=d.week_id join training_plans p on p.id=w.training_plan_id where p.user_id=$1 and p.is_active and d.day_number=1 and e.name='深蹲'`, [user])).rows;

test("the phone reviews a finished workout: one change accepted and applied through the ledger, then undone", async ({ browser }) => {
  const web = await browser.newPage(); await planThroughWebChat(web); await web.close();
  const page = await browser.newPage(), errors: string[] = [], sent: Sent[] = [];
  page.on("pageerror", e => errors.push(e.message)); await relay(page, sent);
  await signIn(page);
  await page.getByRole("link", { name: "教练" }).click(); await page.getByRole("button", { name: "同意并开启" }).click(); await page.goBack();
  await page.getByRole("button", { name: "开始训练" }).click();
  // The status still reads synced until the start is queued on disk, so wait for the server's session itself.
  const active = async () => (await db.query("select prescription from workout_sessions where user_id=$1 and status='active'", [user])).rows[0];
  await expect.poll(active).toBeTruthy();
  const status = page.getByTestId("outbox-status"); await expect(status).toHaveText("已同步");
  const squat = (await active()).prescription.exercises.find((e: { name: string }) => e.name === "深蹲").id;
  for (const n of [1, 2, 3]) {
    const row = page.getByTestId(`set-${squat}-${n}`);
    await row.getByLabel(`第 ${n} 组 重量 (kg)`).fill("60"); await row.getByLabel(`第 ${n} 组 次数`).fill("10");
    await row.getByRole("button", { name: "完成" }).click(); await expect(row.getByText("已完成")).toBeVisible();
  }
  await page.getByRole("button", { name: "结束训练" }).click(); await expect(status).toHaveText("已同步");
  const card = page.getByTestId("review-card");
  await card.getByRole("button", { name: "复盘这次训练" }).click();
  await expect(card.getByRole("checkbox")).toHaveCount(2); await expect(card).toContainText("深蹲：每次加 1 组"); await expect(card).toContainText("依据 3 组记录");
  expect(await squatNow()).toEqual([{ sets: 3, rpe: 7 }]); // A suggestion changes nothing.
  await card.getByRole("checkbox").nth(1).click();
  await card.getByRole("button", { name: "应用所选（1 项）" }).dblclick();
  await expect(card.getByText("已应用到训练计划。")).toBeVisible();
  expect(await squatNow()).toEqual([{ sets: 4, rpe: 7 }]);
  await page.screenshot({ path: "node_modules/.cache/mobile-web/review-mobile.png", fullPage: true });
  await card.getByRole("button", { name: "撤销这些修改" }).click();
  await expect(card.getByText("已撤销，计划恢复到复盘前。")).toBeVisible();
  expect(await squatNow()).toEqual([{ sets: 3, rpe: 7 }]);
  expect((await db.query("select status,count(*)::int n from agent_private.runs where user_id=$1 group by status order by status", [user])).rows)
    .toEqual([{ status: "applied", n: 3 }, { status: "declined", n: 1 }]); // Plan, accepted subset and undo applied once each; the review's own preview declined.
  expectBearerOnly(sent); expect(errors).toEqual([]);
});
