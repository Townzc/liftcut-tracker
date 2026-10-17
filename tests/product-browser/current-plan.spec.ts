import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const owner = "11111111-1111-4111-8111-111111111111";
let plan: string, previouslyActive: string[] = [];
async function login(page: Page, email = "p1-fixture@example.invalid") {
  await page.goto("/login"); await page.locator("#email").fill(email); await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/(?:onboarding)?$/);
  await expect(page.getByTestId("current-plan-card")).toBeVisible();
}
async function openPlan(page: Page) {
  const status = page.waitForResponse(response => new URL(response.url()).pathname === "/api/workout-sessions" && response.request().method() === "GET");
  await page.getByTestId("current-plan-card").click();
  await expect(page.getByTestId("current-plan-exercises")).toBeVisible();
  // Cached plan text can paint before the status effect runs. Wait for that read
  // before forcing reload, which otherwise makes WebKit report unload as CORS.
  await (await status).finished();
}
test.beforeEach(async () => {
  plan = "current-plan-fixture-" + randomUUID();
  await db.query("insert into auth.users values($1) on conflict do nothing", [owner]);
  previouslyActive = (await db.query("select id from training_plans where user_id=$1 and is_active", [owner])).rows.map(row => row.id);
  await db.query("update training_plans set is_active=false where user_id=$1", [owner]);
  await db.query("insert into training_plans(id,user_id,name,is_active,notes) values($1,$2,'Synthetic 12 week plan',true,'Keep the original approved prescription.')", [plan, owner]);
  for (let week = 1; week <= 12; week++) {
    const weekId = plan + "-w" + week;
    await db.query("insert into training_plan_weeks values($1,$2,$3)", [weekId, plan, week]);
    for (let day = 1; day <= 2; day++) {
      const dayId = weekId + "-d" + day;
      await db.query("insert into training_plan_days(id,week_id,day_number,title,notes) values($1,$2,$3,$4,'Estimated duration: 45 min')", [dayId, weekId, day, "训练 " + (day === 1 ? "A" : "B")]);
      await db.query("insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe,notes) values($1,$2,'深蹲',3,'8-10',7,'Rest: 120s')", [dayId + "-e1", dayId]);
    }
  }
});
test.afterEach(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [owner, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [owner, plan]);
  await db.query("update training_plans set is_active=true where user_id=$1 and id=any($2::text[])", [owner, previouslyActive]);
});
test.afterAll(async () => { await db.end(); });

test("Home to current plan to real recording: no automatic writes, chosen day survives, actual progress refreshes", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await login(page);
  await expect(page.getByTestId("current-plan-card")).toContainText("Synthetic 12 week plan");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "84");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await page.screenshot({ path: "node_modules/.cache/current-plan-release/home-mobile.png", fullPage: true });
  await openPlan(page);
  await expect(page.getByRole("navigation").getByRole("link", { name: "首页", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#current-plan-day option")).toHaveCount(24);
  await expect(page.getByTestId("recorded-plan-days")).toContainText("0 / 24");
  await expect(page.getByTestId("current-plan-exercises")).toContainText("3 组 × 8-10");
  await page.screenshot({ path: "node_modules/.cache/current-plan-release/plan-mobile.png", fullPage: true });
  expect((await db.query("select count(*)::int n from workout_sessions where training_plan_id=$1", [plan])).rows[0].n).toBe(0);
  await page.getByLabel("选择训练日", { exact: true }).selectOption(plan + "-w1-d2");
  await page.getByRole("link", { name: "开始记录", exact: true }).click();
  await expect(page).toHaveURL(/\/current-plan\/workout$/);
  await expect(page.getByRole("combobox")).toHaveValue(plan + "-w1-d2");
  expect((await db.query("select count(*)::int n from workout_sessions where training_plan_id=$1", [plan])).rows[0].n).toBe(0);
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  const row = page.getByTestId("set-" + plan + "-w1-d2-e1-1");
  await expect(row.getByLabel("RPE", { exact: true })).toHaveValue("");
  await row.getByLabel("次数", { exact: true }).fill("8");
  await row.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  await page.getByRole("button", { name: "结束训练", exact: true }).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  await expect(page.getByText("训练已结束", { exact: true })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "首页", exact: true }).click();
  await expect(page.getByTestId("current-plan-card")).toContainText("已记录 1 次训练");
  await openPlan(page); await expect(page.getByLabel("选择训练日", { exact: true })).toHaveValue(plan + "-w1-d1");
  const reloadedStatus = page.waitForResponse(response => new URL(response.url()).pathname === "/api/workout-sessions" && response.request().method() === "GET");
  await page.reload(); await expect(page.getByTestId("recorded-plan-days")).toContainText("1 / 24");
  await (await reloadedStatus).finished();
  const actual = (await db.query("select l.* from set_logs l join workout_sessions s on s.id=l.session_id where s.training_plan_id=$1", [plan])).rows;
  expect(actual).toHaveLength(1); expect(actual[0].reps).toBe(8); expect(actual[0].weight_kg).toBeNull(); expect(actual[0].rpe).toBeNull();
  await page.getByRole("link", { name: "让 Agent 调整计划" }).click();
  await expect(page.locator("#coach-input")).toHaveValue("我想调整当前训练计划");
  await expect(page.getByTestId("plan-preview")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an active session keeps its original prescription and never creates a second session", async ({ page }) => {
  await login(page);
  const response = await page.request.post("/api/workout-sessions?action=start", { headers: { Origin: "http://localhost:3103" }, data: { id: randomUUID(), dayId: plan + "-w1-d2", timezone: "Asia/Shanghai" } });
  expect(response.status()).toBe(200);
  await db.query("update training_plan_exercises set sets=2 where id=$1", [plan + "-w1-d2-e1"]);
  await page.reload(); await openPlan(page);
  await expect(page.getByTestId("current-plan-active-session")).toContainText("训练 B");
  await page.getByRole("link", { name: "继续记录", exact: true }).click();
  await expect(page.getByText("已完成 0 / 3 组", { exact: true })).toBeVisible();
  expect((await db.query("select count(*)::int n from workout_sessions where training_plan_id=$1", [plan])).rows[0].n).toBe(1);
});

test("current plan is isolated across owners, has an empty state, and fits narrow screens", async ({ page, browser }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await login(page); await openPlan(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "node_modules/.cache/current-plan-release/plan-narrow.png", fullPage: true });
  const context = await browser.newContext(), other = await context.newPage();
  try {
    await login(other, "offline-second@example.invalid");
    await expect(other.getByTestId("current-plan-card")).not.toContainText("Synthetic 12 week plan");
    await other.goto("/current-plan");
    await expect(other.getByText("确认后的训练计划会出现在这里.", { exact: true })).toBeVisible();
    await expect(other.getByTestId("current-plan-exercises")).toHaveCount(0);
    expect((await (await other.request.get("/api/workout-sessions")).json()).days.some((day: { id: string }) => day.id.startsWith(plan))).toBe(false);
  } finally { await context.close(); }
});

test("recording status failure leaves a readable plan and does not invent an active workout", async ({ page }) => {
  await login(page);
  await page.route("**/api/workout-sessions", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
  await openPlan(page);
  await expect(page.getByText("暂时无法读取进行中的训练，进入记录页后会重新核对.")).toBeVisible();
  await expect(page.getByTestId("current-plan-active-session")).toHaveCount(0);
  await expect(page.getByTestId("current-plan-exercises")).toContainText("3 组 × 8-10");
});

