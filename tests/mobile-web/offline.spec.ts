import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { expectBearerOnly, relay, signIn, type Sent } from "./helpers";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("update public.training_plans set is_active=false where user_id=$1", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Mobile offline plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'手机训练 C')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,$3,3,'5',8)", [exercise, day, `离线卧推-${plan.slice(0, 6)}`]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]); await db.end();
});

test("API down: queued sets survive a cold restart and automatically sync while Agent stays focused", async ({ page }) => {
  test.setTimeout(100000);
  const errors: string[] = [], sent: Sent[] = [], net = { down: false };
  page.on("pageerror", e => errors.push(e.message)); await relay(page, sent);
  // Registered last, so it runs first: only the API goes away; the app's own files still load.
  await page.route(/^http:\/\/localhost:3103\/api\//, route => net.down ? route.abort("internetdisconnected") : route.fallback());
  await signIn(page);
  await page.getByRole("button", { name: "开始训练" }).click();
  await expect(page.getByText("进行中的训练 · 手机训练 C")).toBeVisible();
  const status = page.getByTestId("outbox-status"), row = (n: number) => page.getByTestId(`set-${exercise}-${n}`);
  await expect(status).toHaveText("已同步");
  net.down = true;
  for (const n of [1, 2, 3]) {
    await row(n).getByLabel(`第 ${n} 组 重量（公斤）`).fill("60"); await row(n).getByLabel(`第 ${n} 组 次数`).fill(String(4 + n));
    await row(n).getByRole("button", { name: "完成" }).click(); await expect(row(n).getByText("已完成")).toBeVisible();
  }
  await expect(status).toContainText("待同步 3 条");
  const stored = async () => (await db.query("select l.set_index,l.reps,l.status from set_logs l join workout_sessions s on s.id=l.session_id where s.training_plan_id=$1 order by l.set_index", [plan])).rows;
  expect(await stored()).toEqual([]);
  await page.reload(); // Cold start with the API still unreachable.
  await expect(page.getByText("现在离线，显示的是本机保存的记录。")).toBeVisible();
  await expect(page.getByText("进行中的训练 · 手机训练 C")).toBeVisible();
  await expect(page.getByText("已完成 3 / 3 组")).toBeVisible();
  await expect(status).toContainText("待同步 3 条");
  await page.screenshot({ path: "node_modules/.cache/mobile-web/offline-queued-mobile.png" });
  await page.getByRole("link", { name: "教练" }).click();
  await page.waitForURL(/\/coach$/);
  await page.reload(); // Restore directly into Agent, with no Home focus event.
  await expect(page.getByRole("button", { name: "同意并开启" })).toBeVisible();
  const retryState = await page.evaluate(owner => {
    const queue = JSON.parse(localStorage.getItem(`liftcut-outbox:${owner}`)!);
    const head = queue.items[0];
    return { pending: queue.items.length, status: head.status, attempts: head.attempts, retryInMs: head.nextAttempt - Date.now() };
  }, user);
  await test.info().attach("queue-retry-state", { body: JSON.stringify(retryState), contentType: "application/json" });
  net.down = false;
  // An API-only outage emits no device online event; retain the queue's maximum 60s backoff plus one timer tick.
  await expect.poll(stored, { timeout: 70000 }).toEqual([{ set_index: 1, reps: 5, status: "done" }, { set_index: 2, reps: 6, status: "done" }, { set_index: 3, reps: 7, status: "done" }]);
  await page.screenshot({ path: "node_modules/.cache/mobile-web/offline-auto-resume-agent.png" });
  const sets = sent.filter(r => r.url.includes("action=set")).length;
  expect(sets).toBeGreaterThanOrEqual(3); // Retries resend the same bytes; the database still has exactly three.
  expectBearerOnly(sent); expect(errors).toEqual([]);
  await page.unrouteAll({ behavior: "wait" });
});
