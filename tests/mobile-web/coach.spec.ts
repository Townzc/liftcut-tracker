import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { MODEL_DATA } from "@liftcut/core/model-data";
import { expectBearerOnly, relay, signIn, type Sent } from "./helpers";
// Replies come from the scripted model fixture (never real-model evidence); the API, queue and PostgreSQL writes are real.
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("update public.training_plans set is_active=false where user_id=$1", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Mobile coach plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'手机训练 C')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'深蹲',3,'8-12',7)", [exercise, day]);
  await db.query("delete from coach_request_usage where user_id=$1", [user]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]);
  await db.query("delete from coach_request_usage where user_id=$1", [user]); await db.end();
});

test("the phone chat asks consent, streams a reply and saves a workout draft only after confirmation, through the queue", async ({ page }) => {
  const errors: string[] = [], sent: Sent[] = [];
  page.on("pageerror", e => errors.push(e.message)); await relay(page, sent);
  await signIn(page);
  await page.getByRole("button", { name: "开始训练" }).click();
  await expect(page.getByText("进行中的训练 · 手机训练 C")).toBeVisible(); await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  await page.getByRole("link", { name: "教练" }).click();
  // The consent list is the same allowlist the server filters with.
  await expect(page.getByTestId("coach-data-category")).toHaveCount(MODEL_DATA.length);
  await page.getByRole("button", { name: "同意并开启" }).click();
  const input = page.getByLabel("发给训练助手"), turns = page.getByTestId("coach-turn");
  const logs = async () => (await db.query(`select l.reps,l.weight_kg,l.rpe,l.weight_source from set_logs l join workout_sessions s on s.id=l.session_id
    where s.training_plan_id=$1 and l.status='done'`, [plan])).rows;

  await input.fill("刚才那组深蹲我实打实做了八次，用的是五十公斤，帮我记上"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(turns.last()).toContainText("请核对下方草稿，确认后才会保存。目前尚未写入记录。");
  await expect(turns.last()).toContainText("第 1 组: 50 公斤 × 8 次 · 主观强度 —");
  expect(await logs()).toEqual([]); // A draft is not a record.
  await page.screenshot({ path: "node_modules/.cache/mobile-web/coach-draft-mobile.png", fullPage: true });
  await turns.last().getByRole("button", { name: "确认记录" }).click();
  await expect(turns.last()).toContainText(/已加入待同步|已保存，服务端记录已确认/);
  await expect.poll(logs).toEqual([{ reps: 8, weight_kg: "50", rpe: null, weight_source: "user_said" }]);

  // An unconfirmed draft is closed by the next message and never written.
  await input.fill("刚才那组深蹲我实打实做了八次，用的是五十公斤，帮我记上"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(turns.last().getByRole("button", { name: "确认记录" })).toBeVisible();
  await input.fill("你好"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(turns.last()).toContainText("你好，可以自然地问我记录");
  await expect(turns.nth(1)).toContainText("这份草稿已关闭"); await expect(page.getByRole("button", { name: "确认记录" })).toHaveCount(0);
  expect(await logs()).toHaveLength(1);
  await page.screenshot({ path: "node_modules/.cache/mobile-web/coach-mobile.png", fullPage: true });
  expectBearerOnly(sent); expect(errors).toEqual([]);
});

test("a body entry drafted in the phone chat is saved once, after confirmation, through the web's records API", async ({ page }) => {
  const errors: string[] = [], sent: Sent[] = [];
  page.on("pageerror", e => errors.push(e.message)); await relay(page, sent);
  const entries = async () => (await db.query("select id,request from personal_record_events where user_id=$1 and request->>'source'='conversation'", [user])).rows;
  const before = (await entries()).map(r => r.id);
  try {
    await signIn(page); await page.getByRole("link", { name: "教练" }).click(); await page.getByRole("button", { name: "同意并开启" }).click();
    await page.getByLabel("发给训练助手").fill("昨天早上秤了一下，是七十二点五公斤，帮我补上吧"); await page.getByRole("button", { name: "发送", exact: true }).click();
    const turn = page.getByTestId("coach-turn").last();
    await expect(turn).toContainText("体重 · 72.5 公斤"); await expect(turn).toContainText("腰围 · — 厘米");
    expect(await entries()).toHaveLength(before.length); // A draft is not a record.
    await turn.getByRole("button", { name: "确认补录" }).dblclick();
    await expect(turn).toContainText("已加入待同步");
    await expect.poll(async () => (await entries()).length).toBe(before.length + 1);
    const saved = (await entries()).find(r => !before.includes(r.id))!.request;
    expect([saved.entry.kind, saved.entry.weightKg, saved.entry.waistCm, saved.text]).toEqual(["body", 72.5, null, "昨天早上秤了一下，是七十二点五公斤，帮我补上吧"]);
    expectBearerOnly(sent); expect(errors).toEqual([]);
  } finally { await db.query("delete from personal_record_events where user_id=$1 and not (id = any($2))", [user, before]); }
});
