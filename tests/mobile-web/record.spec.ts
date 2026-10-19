import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { expectBearerOnly, relay, signIn, type Sent } from "./helpers";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const user = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
const name = `手机深蹲-${plan.slice(0, 6)}`; // Unique: "last time" and history are matched by name.
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
  await db.query("update public.training_plans set is_active=false where user_id=$1", [user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Mobile record plan',true)", [plan, user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'手机训练 B')", [day, plan + "w"]);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,$3,3,'8-12',7)", [exercise, day, name]);
  await db.query("insert into public.workout_logs(id,user_id,date,training_plan_id,week_number,day_number,duration_minutes,completed) values($1,$2,'2026-10-12',$1,1,1,30,true)", [plan, user]);
  await db.query("insert into public.workout_log_exercises(id,workout_log_id,exercise_plan_id,name,actual_weight,actual_reps,actual_rpe,completed) values($1,$2,$3,$4,50,10,9,true)", [randomUUID(), plan, exercise, name]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, plan]);
  await db.query("delete from workout_logs where user_id=$1 and id=$2", [user, plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2", [user, plan]); await db.end();
});

test("the Expo app records sets through the shared write path: prefill provenance, skip, compensating undo, end", async ({ page }) => {
  const errors: string[] = [], sent: Sent[] = [];
  page.on("pageerror", e => errors.push(e.message)); await relay(page, sent);
  await signIn(page);
  await page.getByRole("button", { name: "开始训练" }).click();
  await expect(page.getByText("进行中的训练 · 手机训练 B")).toBeVisible();
  const row = (n: number) => page.getByTestId(`set-${exercise}-${n}`);
  await expect(row(1).getByText("上次：50 kg × 10")).toBeVisible();
  await expect(row(1).getByLabel("第 1 组 RPE")).toHaveValue(""); // RPE is never prefilled.
  await expect(page.getByTestId("rest-timer")).toHaveCount(0);
  await page.getByRole("button", { name: "60 秒" }).click();
  await row(1).getByRole("button", { name: "完成" }).click();
  await expect(row(1).getByText("已完成")).toBeVisible();
  const rest = page.getByTestId("rest-timer"); // Starts after a completed set, from the chosen length.
  await expect(rest).toContainText(/组间休息\s+(01:00|00:59)/);
  await rest.getByRole("button", { name: "+30 秒" }).click(); await expect(rest).toContainText(/01:(30|29)/);
  await rest.getByRole("button", { name: "结束休息" }).click(); await expect(rest).toHaveCount(0);
  await row(2).getByLabel("第 2 组 次数").fill("8");
  await row(2).getByRole("button", { name: "完成" }).click();
  await expect(row(2).getByText("50 kg × 8 · RPE —")).toBeVisible();
  await expect(rest).toBeVisible();
  await rest.getByRole("button", { name: "结束休息" }).click();
  await row(3).getByRole("button", { name: "跳过" }).click();
  await expect(row(3).getByText("已跳过")).toBeVisible();
  await expect(rest).toHaveCount(0); // A skip does not start a rest.
  await page.screenshot({ path: "node_modules/.cache/mobile-web/record-mobile.png", fullPage: true });
  await row(1).getByRole("button", { name: "撤销" }).click();
  await expect(row(1).getByText("已撤销")).toBeVisible();
  await page.getByRole("button", { name: "结束训练" }).click();
  await expect(page.getByText("已结束的训练 · 手机训练 B")).toBeVisible();
  const rows = (await db.query(`select l.set_index,l.status,l.revision,l.weight_kg,l.reps,l.rpe,l.weight_source,l.reps_source from set_logs l
    join workout_sessions s on s.id=l.session_id where s.training_plan_id=$1 order by l.set_index`, [plan])).rows;
  expect(rows).toEqual([
    // A compensated row keeps the provenance it was recorded with.
    { set_index: 1, status: "voided", revision: 2, weight_kg: "50", reps: 10, rpe: null, weight_source: "user_confirmed_prefill", reps_source: "user_confirmed_prefill" },
    { set_index: 2, status: "done", revision: 1, weight_kg: "50", reps: 8, rpe: null, weight_source: "user_confirmed_prefill", reps_source: "user_entered" },
    { set_index: 3, status: "skipped", revision: 1, weight_kg: null, reps: null, rpe: null, weight_source: null, reps_source: null },
  ]);
  expect((await db.query("select status from workout_sessions where training_plan_id=$1", [plan])).rows).toEqual([{ status: "ended" }]);
  expectBearerOnly(sent); expect(errors).toEqual([]);
});
