import { test,expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL});
const user="11111111-1111-4111-8111-111111111111",plan=randomUUID(),day=randomUUID(),exercise=randomUUID();
test.beforeAll(async()=>{
  await db.query("insert into auth.users values($1) on conflict do nothing",[user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'W2b synthetic plan',true)",[plan,user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'一句话训练')",[day,plan+'w']);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'深蹲',6,'8-12',7)",[exercise,day]);
});
test.afterAll(async()=>{
  await db.query("delete from public.workout_sessions where user_id=$1 and training_plan_id=$2",[user,plan]);
  await db.query("delete from public.training_plans where id=$1 and user_id=$2",[plan,user]);await db.end();
});
test("mobile sentence preview, atomic save, response loss, correction compensation and durable receipts",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/login");await page.locator("#email").fill("p1-fixture@example.invalid");await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click();await page.waitForURL(/\/(?:onboarding)?$/);
  await page.goto("/today");await page.getByLabel("选择今天的训练日").selectOption(day);
  await page.getByRole("button",{name:"开始训练",exact:true}).click();
  const input=page.getByLabel("训练原话"),row=(n:number)=>page.getByTestId(`set-${exercise}-${n}`);
  const parse=async(text:string)=>{await input.fill(text);await page.getByRole("button",{name:"解析并预览"}).click();};
  const confirm=()=>page.getByRole("button",{name:"确认保存这句话"});
  const read=async()=>await (await page.request.get("/api/workout-sessions")).json();
  await parse("深蹲 50 公斤 10、10、8 RPE 9");await expect(page.getByRole("status")).toContainText("RPE 属于哪组");
  expect((await read()).session.sets).toHaveLength(0);
  await parse("深蹲 50 公斤 10、10、8，最后一组 RPE 9");await expect(page.getByTestId("sentence-preview")).toContainText("RPE —");
  expect((await read()).session.sets).toHaveLength(0);
  await confirm().dblclick();await expect(page.getByText("已完成 3 / 6 组",{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole("region",{name:"一句话回执"})).toContainText("深蹲 50 公斤 10、10、8");
  const first=await read(),batch=first.receipts[0];expect(first.session.sets.map((s:{rpe:number|null})=>s.rpe)).toEqual([null,null,9]);
  expect((await db.query("select count(*) from public.workout_commands where session_id=$1",[first.session.id])).rows[0].count).toBe("1");
  await page.screenshot({path:"node_modules/.cache/w1b/sentence-three-sets.png",fullPage:true});
  await parse("更正 深蹲 第 3 组 7 次");await expect(page.getByTestId("sentence-preview")).toContainText("8 → 7");
  const originalRequest=page.waitForRequest(r=>r.url().includes("/api/workout-commands?action=apply"));
  await confirm().click();const correctionRequest=(await originalRequest).postDataJSON();await expect(row(3)).toContainText("× 7");
  const correction=(await read()).receipts[0];await page.getByTestId(`receipt-${correction.id}`).getByRole("button",{name:"撤销这句话"}).click();
  await expect(row(3)).toContainText("× 8");await expect(page.getByTestId(`receipt-${correction.id}`)).toContainText("v3");
  const replay=await page.request.post("/api/workout-commands?action=apply",{headers:{Origin:"http://localhost:3103"},data:correctionRequest});
  expect(replay.status()).toBe(200);expect((await read()).session.sets[2].reps).toBe(8);
  await page.getByTestId(`receipt-${batch.id}`).getByRole("button",{name:"撤销这句话"}).click();
  await expect(page.getByRole("alert").filter({hasText:"记录已发生变化"})).toBeVisible();
  expect((await read()).session.sets.every((s:{status:string})=>s.status==="done")).toBe(true);
  await page.getByRole("button",{name:"查询 / 恢复"}).click();await expect(input).toBeEnabled();
  await parse("记下 深蹲 100 lb 8、7 次");
  await page.route("**/api/workout-commands?action=apply",async r=>{expect((await r.fetch()).status()).toBe(200);await r.abort("connectionreset");},{times:1});
  await confirm().click();await expect(page.getByRole("alert").filter({hasText:"本次保存结果尚未确认"})).toBeVisible();
  await page.getByRole("button",{name:"重试同一操作"}).click();await expect(row(4)).toContainText("45.359237 kg × 8");
  const second=(await read()).receipts[0];expect((await read()).session.sets).toHaveLength(5);
  await page.route("**/api/workout-commands?action=undo",async r=>{expect((await r.fetch()).status()).toBe(200);await r.abort("connectionreset");},{times:1});
  await page.getByTestId(`receipt-${second.id}`).getByRole("button",{name:"撤销这句话"}).click();
  await expect(page.getByRole("alert").filter({hasText:"本次保存结果尚未确认"})).toBeVisible();
  await page.getByRole("button",{name:"重试同一操作"}).click();await expect(row(4)).toContainText("已撤销");
  await expect(page.getByTestId(`receipt-${second.id}`)).toContainText("撤销回执");
  // Tap editing remains interoperable with records carrying user_said provenance.
  for (const n of [1,2]) {
    await row(n).getByRole("button",{name:"更正",exact:true}).click();await row(n).getByLabel("RPE",{exact:true}).fill(String(6+n));
    await row(n).getByRole("button",{name:"保存更正"}).click();await expect(row(n)).toContainText(`RPE ${6+n}`);
  }
  expect((await read()).session.sets.slice(0,3).map((s:{rpe:number|null})=>s.rpe)).toEqual([7,8,9]);
  await page.screenshot({path:"node_modules/.cache/w1b/sentence-compensation.png",fullPage:true});
  await row(3).getByRole("button",{name:"撤销",exact:true}).click();await expect(row(3)).toContainText("已撤销");
  await parse("练完了");await expect(page.getByTestId("sentence-preview")).toContainText("未记录的组仍保持未记录");
  await page.getByRole("button",{name:"确认结束训练",exact:true}).click();await expect(page.getByText("训练已结束",{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByTestId(`receipt-${second.id}`)).toContainText("撤销回执");
  expect((await db.query("select count(*) from public.set_logs where session_id=$1",[first.session.id])).rows[0].count).toBe("5");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test("new routes reject anonymous and cross-origin requests",async({request})=>{
  for(const path of ["/api/ai/parse-log","/api/workout-commands?action=apply","/api/workout-commands?action=undo"]){
    expect((await request.post(path,{headers:{Origin:"http://localhost:3103"},data:{}})).status()).toBe(401);
    expect((await request.post(path,{headers:{Origin:"https://other.invalid"},data:{}})).status()).toBe(403);
    expect((await request.post(`http://localhost:3104${path}`,{data:{}})).status()).toBe(404);
  }
});
