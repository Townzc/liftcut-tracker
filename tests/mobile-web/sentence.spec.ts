import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { expectBearerOnly, relay, signIn, type Sent } from "./helpers";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("update public.training_plans set is_active=false where user_id=$1", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Mobile sentence plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'手机训练 D')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'卧推',3,'5',8)", [exercise, day]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]); await db.end();
});

test("one sentence: rules preview on the phone, explicit confirm, server re-check, receipt and compensating undo", async ({ page }) => {
  const errors: string[] = [], sent: Sent[] = [];
  page.on("pageerror", e => errors.push(e.message)); await relay(page, sent);
  await signIn(page);
  await page.getByRole("button", { name: "开始训练" }).click();
  const status = page.getByTestId("outbox-status");
  await expect(page.getByText("进行中的训练 · 手机训练 D")).toBeVisible(); await expect(status).toHaveText("已同步");
  const input = page.getByLabel("训练原话");
  await input.fill("卧推 做了很多次");
  await page.getByRole("button", { name: "解析并预览" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "请" })).toBeVisible(); // A clarify reason, never a guessed record.
  await input.fill("卧推 60 公斤 5、5，最后一组 RPE 8");
  await page.getByRole("button", { name: "解析并预览" }).click();
  const preview = page.getByTestId("sentence-preview");
  await expect(preview).toContainText("第 1 组: 60 kg × 5 · RPE —"); await expect(preview).toContainText("第 2 组: 60 kg × 5 · RPE 8");
  expect((await db.query("select count(*)::int as n from set_logs l join workout_sessions s on s.id=l.session_id where s.training_plan_id=$1", [plan])).rows[0].n).toBe(0);
  await page.screenshot({ path: "node_modules/.cache/mobile-web/sentence-mobile.png", fullPage: true });
  await preview.getByRole("button", { name: "确认保存这句话" }).click();
  await expect(status).toHaveText("已同步");
  const rows = async () => (await db.query(`select l.set_index,l.status,l.weight_kg,l.reps,l.rpe,l.weight_source,l.source_ref from set_logs l
    join workout_sessions s on s.id=l.session_id where s.training_plan_id=$1 order by l.set_index`, [plan])).rows;
  const saved = await rows();
  expect(saved.map(r => [r.set_index, r.status, r.weight_kg, r.reps, r.rpe, r.weight_source])).toEqual([[1, "done", "60", 5, null, "user_said"], [2, "done", "60", 5, "8", "user_said"]]);
  const receipt = page.getByTestId(`receipt-${saved[0].source_ref}`);
  await expect(receipt).toContainText("已保存");
  await receipt.getByRole("button", { name: "撤销这句话" }).click();
  await expect(status).toHaveText("已同步"); await expect(receipt).toContainText("已撤销（保留原记录）");
  expect((await rows()).map(r => r.status)).toEqual(["voided", "voided"]);
  expectBearerOnly(sent); expect(errors).toEqual([]);
});
