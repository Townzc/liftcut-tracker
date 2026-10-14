import { test,expect,type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL});
const user="11111111-1111-4111-8111-111111111111",plan=randomUUID(),day=randomUUID(),exercise=randomUUID(),bodyweight=randomUUID();
test.beforeAll(async()=>{
  await db.query("insert into auth.users values($1) on conflict do nothing",[user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'W1b synthetic plan',true)",[plan,user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'训练 A')",[day,plan+'w']);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'深蹲',4,'8-12',7),($3,$2,'自重提踵',1,'12',7)",[exercise,day,bodyweight]);
  await db.query("insert into public.workout_logs(id,user_id,date,training_plan_id,week_number,day_number,duration_minutes,completed) values($1,$2,'2026-10-12',$1,1,1,30,true)",[plan,user]);
  await db.query("insert into public.workout_log_exercises(id,workout_log_id,exercise_plan_id,name,actual_weight,actual_reps,actual_rpe,completed) values($1,$2,$3,'深蹲',50,10,9,true)",[randomUUID(),plan,exercise]);
});
test.afterAll(async()=>{
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2",[user,plan]);
  await db.query("delete from workout_logs where user_id=$1 and id=$2",[user,plan]);
  await db.query("delete from training_plans where user_id=$1 and id=$2",[user,plan]);await db.end();
});
async function login(page:Page,port=3103){
  await page.goto(`http://localhost:${port}/login`);
  await page.locator("#email").fill("p1-fixture@example.invalid"); await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click(); await page.waitForURL(/\/(?:onboarding)?$/);
}
test("mobile: real API/PG save, lost response, refresh, correction, undo, history and nulls",async({page})=>{
  const failures:string[]=[];page.on("pageerror",e=>failures.push(e.message));
  await login(page); await page.goto("/today"); await page.getByRole("button",{name:"开始训练",exact:true}).click();
  const row=(n:number)=>page.getByTestId(`set-${exercise}-${n}`);
  await expect(row(1).getByLabel("RPE",{exact:true})).toHaveValue(""); // Previous/target RPE must not leak.
  await expect(row(1).getByLabel("重量 (kg)")).toHaveValue("50");
  await row(1).getByRole("button",{name:"完成",exact:true}).dblclick(); await expect(row(1).getByText("已完成",{exact:true})).toBeVisible();
  await row(2).getByLabel("重量 (kg)").fill(""); await row(2).getByLabel("次数",{exact:true}).fill("8");
  await row(2).getByRole("button",{name:"完成",exact:true}).click(); await expect(row(2).getByText("已完成",{exact:true})).toBeVisible();
  await row(3).getByLabel("RPE",{exact:true}).fill("8"); await row(3).getByLabel("RPE",{exact:true}).fill("");
  await page.route("**/api/workout-sessions?action=set",async route=>{const response=await route.fetch();expect(response.status()).toBe(200);await route.abort("connectionreset");},{times:1});
  await row(3).getByRole("button",{name:"完成",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"本次保存结果尚未确认"})).toBeVisible();
  await page.getByRole("button",{name:"重试同一操作"}).click(); await expect(row(3).getByText("已完成",{exact:true})).toBeVisible();
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  await page.reload(); await expect(page.getByText("已完成 3 / 5 组",{exact:true})).toBeVisible();
  const read=async()=> (await (await page.request.get("/api/workout-sessions")).json()).session;
  const before=await read(); expect(before.sets).toHaveLength(3);
  expect(before.sets.every((s:{rpe:number|null})=>s.rpe===null)).toBe(true);
  expect(before.sets.find((s:{setIndex:number})=>s.setIndex===1).weightSource).toBe("user_confirmed_prefill");
  expect(before.sets.find((s:{setIndex:number})=>s.setIndex===2).weightKg).toBeNull();
  await page.screenshot({path:"node_modules/.cache/w1b/three-sets-mobile.png",fullPage:true});
  await row(1).getByRole("button",{name:"更正",exact:true}).click(); await row(1).getByLabel("次数",{exact:true}).fill("11");
  await row(1).getByRole("button",{name:"保存更正"}).click(); await expect(row(1)).toContainText("× 11");
  await row(2).getByRole("button",{name:"更正",exact:true}).click();
  await expect(row(2).getByLabel("重量 (kg)")).toHaveValue(""); // Saved NULL cannot re-inherit the historical 50 kg.
  await row(2).getByRole("button",{name:"保存更正"}).click();await expect(row(2)).toContainText("— kg × 8");
  await row(2).getByRole("button",{name:"撤销",exact:true}).click();await expect(row(2)).toContainText("已撤销");
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  const stale={...before.sets.find((s:{setIndex:number})=>s.setIndex===2)};delete stale.exerciseName;delete stale.updatedAt;
  const resend=await page.request.post("/api/workout-sessions?action=set",{headers:{Origin:"http://localhost:3103"},data:stale});expect(resend.status()).toBe(409);
  await row(4).getByRole("button",{name:"跳过",exact:true}).click();await expect(row(4)).toContainText("已跳过");
  const bodyRow=page.getByTestId(`set-${bodyweight}-1`);await expect(bodyRow.getByRole("button",{name:"完成",exact:true})).toBeDisabled();
  // Leave bodyweight unreported: ending must never fill its targets.
  await page.getByRole("button",{name:"结束训练",exact:true}).click();await expect(page.getByText("训练已结束",{exact:true})).toBeVisible();
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  const history=await (await page.request.get("/api/workout-sessions/history")).json();expect(history).toHaveLength(1);
  expect(history[0].exercises).toHaveLength(2);expect(history[0].exercises.every((s:{actualRpe:number|null})=>s.actualRpe===null)).toBe(true);
  const rows=(await db.query("select * from public.set_logs where session_id=$1",[before.id])).rows;
  expect(rows).toHaveLength(4);expect(rows.find(r=>r.set_index===2).status).toBe("voided");expect(rows.every(r=>r.rpe===null)).toBe(true);
  await page.screenshot({path:"node_modules/.cache/w1b/voided-ended-mobile.png",fullPage:true});
  await page.getByRole("link",{name:"查看训练历史"}).click();await expect(page.getByRole("button").filter({hasText:before.localDate}).first()).toBeVisible();
  await page.getByRole("button").filter({hasText:before.localDate}).first().click();await expect(page.getByRole("dialog")).toContainText("RPE —");
  expect(failures).toEqual([]);
});
test("server flag off hides navigation and blocks writes while preserving history",async({page})=>{
  await login(page,3104);await page.goto("http://localhost:3104/today");await expect(page.getByText("尚未开放",{exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"今日训练",exact:true})).toHaveCount(0);
  expect((await page.request.get("http://localhost:3104/api/workout-sessions")).status()).toBe(404);
  expect((await page.request.post("http://localhost:3104/api/workout-sessions?action=start",{data:{}})).status()).toBe(404);
  const history=await page.request.get("http://localhost:3104/api/workout-sessions/history");expect(history.status()).toBe(200);
  await page.screenshot({path:"node_modules/.cache/w1b/flag-off-mobile.png"});
});
test("API rejects signed-out users and cross-origin writes",async({request})=>{
  expect((await request.get("/api/workout-sessions")).status()).toBe(401);
  expect((await request.post("/api/workout-sessions?action=start",{headers:{Origin:"http://localhost:3103"},data:{}})).status()).toBe(401);
  expect((await request.post("/api/workout-sessions?action=start",{headers:{Origin:"https://other.invalid"},data:{}})).status()).toBe(403);
});
