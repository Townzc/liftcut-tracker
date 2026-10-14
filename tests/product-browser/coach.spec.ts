import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { TodayData } from "../../src/lib/today";
import type { OutboxState } from "../../src/lib/workout-outbox";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL});
const owner="11111111-1111-4111-8111-111111111111",plan=randomUUID(),day=randomUUID(),bench=randomUUID(),squat=randomUUID();
test.beforeAll(async()=>{
  await db.query("insert into auth.users values($1) on conflict do nothing",[owner]);
  await db.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'C1 synthetic plan',true)",[plan,owner]);
  await db.query("insert into training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
  await db.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'对话训练')",[day,plan+'w']);
  await db.query("insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'杠铃卧推',4,'8-12',7),($3,$2,'深蹲',2,'8-12',7)",[bench,day,squat]);
});
test.afterEach(async()=>{await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2",[owner,plan]);});
test.afterAll(async()=>{await db.query("delete from training_plans where id=$1",[plan]);await db.end();});
async function login(page:Page,email="p1-fixture@example.invalid",port=3103){
  await page.goto(`http://localhost:${port}/login`);await page.locator("#email").fill(email);await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click();await page.waitForURL(/\/(?:onboarding)?$/);
}
const synced=async(page:Page)=>expect(page.getByTestId("outbox-status")).toHaveText("已同步");
const read=async(page:Page):Promise<TodayData>=> (await page.request.get("/api/workout-sessions")).json();
async function start(page:Page){await login(page);await page.goto("/coach");await synced(page);
  await page.getByTestId("start-session-panel").locator("summary").click();
  await page.getByLabel("选择今天的训练日").selectOption(day);await page.getByRole("button",{name:"开始训练",exact:true}).click();
  await expect(page.getByLabel("当前动作（可选）")).toBeVisible();await synced(page);
}
async function send(page:Page,text:string){await page.getByLabel("发给训练助手",{exact:true}).fill(text);await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();}
async function confirm(page:Page){await page.getByTestId("coach-draft").getByRole("button",{name:"确认保存这句话",exact:true}).click();await expect(page.getByTestId("coach-draft")).toHaveCount(0);}
async function state(page:Page):Promise<OutboxState>{return page.evaluate(id=>new Promise(resolve=>{const req=indexedDB.open("liftcut-workout-outbox-v1",1);
  req.onsuccess=()=>{const d=req.result,tx=d.transaction("accounts"),r=tx.objectStore("accounts").get(id);r.onsuccess=()=>resolve(r.result);tx.oncomplete=()=>d.close();};}),owner);}

test("chat reads, clarification, cancellation, batch confirmation and correction compensation use real API/PG",async({page})=>{
  const errors:string[]=[],modelRequests:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  page.on("request",r=>{if(/\/api\/(ai|agent)/.test(new URL(r.url()).pathname))modelRequests.push(r.url());});
  await start(page);const original=(await read(page)).session!;
  await page.getByText("训练工具与使用示例",{exact:true}).click();
  await page.getByRole("button",{name:"今天练什么",exact:true}).click();await expect(page.getByRole("log")).toContainText("计划目标，不代表实际完成");
  await page.getByRole("button",{name:"已完成多少",exact:true}).click();await expect(page.getByRole("log")).toContainText("已完成 0 / 6 组");
  await send(page,"8 次");await page.getByTestId("coach-clarify").getByRole("button",{name:"杠铃卧推",exact:true}).click();
  await expect(page.getByTestId("coach-draft")).toContainText("— kg × 8 · RPE —");
  await page.getByRole("button",{name:"取消草稿",exact:true}).click();expect((await read(page)).session!.sets).toHaveLength(0);
  await send(page,"杠铃卧推 50 公斤 10、8，最后一组 RPE 9");
  expect((await db.query("select * from workout_commands where session_id=$1",[original.id])).rowCount).toBe(0);
  await page.screenshot({path:"node_modules/.cache/coach/chat-draft-mobile.png",fullPage:true});
  await page.getByTestId("coach-draft").getByRole("button",{name:"确认保存这句话",exact:true}).dblclick();
  // Hashing/enqueue is asynchronous; the previous operation's synced label is not completion.
  await expect(page.getByTestId("coach-draft")).toHaveCount(0);await synced(page);
  expect((await read(page)).session!.sets.map(s=>s.rpe)).toEqual([null,9]);
  expect((await db.query("select * from workout_commands where session_id=$1",[original.id])).rowCount).toBe(1);
  await send(page,"更正 杠铃卧推 第 2 组 7 次");await expect(page.getByTestId("coach-draft")).toContainText("8 → 7");await confirm(page);await synced(page);
  const r=(await read(page)).receipts![0];await page.getByTestId(`receipt-${r.id}`).getByRole("button",{name:"撤销这句话"}).click();
  await expect(page.getByTestId(`receipt-${r.id}`)).toContainText("撤销回执");await synced(page);
  expect((await read(page)).session!.sets.map(s=>s.reps)).toEqual([10,8]);
  await expect(page.getByTestId(`receipt-${r.id}`)).toContainText("撤销回执");
  const source=page.getByTestId(`receipt-${r.id}`).getByTestId(`trace-${r.changes[0].after.id}`);
  await source.locator("summary").click();await expect(source).toContainText("对话确认");await expect(source).toContainText("v3");
  await send(page,"跳过 深蹲 第 1 组");await expect(page.getByTestId("coach-draft")).toBeVisible();await send(page,"今天练什么");
  await expect(page.getByTestId("coach-draft")).toHaveCount(0);expect((await read(page)).session!.sets).toHaveLength(2);
  await send(page,"计划杠铃卧推 100 公斤 10 次");await expect(page.getByTestId("coach-draft")).toHaveCount(0);
  expect(errors).toEqual([]);expect(modelRequests).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("offline chat batch -> correction -> undo -> end persists exact order, NULLs and receipts after refresh",async({page,context})=>{
  await start(page);const initial=(await read(page)).session!;await context.setOffline(true);
  await send(page,"杠铃卧推 8、7 次");await confirm(page);await send(page,"更正 杠铃卧推 第 2 组 6 次");await confirm(page);
  let snapshot=await state(page);const correction=JSON.parse(snapshot.items[1].bodyJson).id;
  await page.getByTestId(`receipt-${correction}`).getByRole("button",{name:"撤销这句话"}).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("待同步 3 条");
  await send(page,"练完了");await page.getByRole("button",{name:"确认结束训练",exact:true}).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("待同步 4 条");snapshot=await state(page);
  expect(snapshot.items.map(x=>x.action)).toEqual(["apply","apply","undo","end"]);
  expect((await db.query("select * from set_logs where session_id=$1",[initial.id])).rowCount).toBe(0);
  await page.screenshot({path:"node_modules/.cache/coach/chat-offline.png",fullPage:true});
  const sent:string[]=[];page.on("request",r=>{if(r.method()==="POST"&&r.url().includes("/api/workout-"))sent.push(r.postData()!);});
  await context.setOffline(false);await synced(page);expect(sent).toEqual(snapshot.items.map(x=>x.bodyJson));
  await page.reload();await synced(page);await expect(page.getByTestId("coach-turn")).toHaveCount(0);
  await expect(page.getByTestId(`receipt-${correction}`)).toContainText("撤销回执");
  expect((await db.query("select reps,weight_kg,rpe,revision from set_logs where session_id=$1 order by set_index",[initial.id])).rows)
    .toEqual([{reps:8,weight_kg:null,rpe:null,revision:1},{reps:7,weight_kg:null,rpe:null,revision:3}]);
  expect((await db.query("select status from workout_sessions where id=$1",[initial.id])).rows[0].status).toBe("ended");
});

test("a draft becomes stale after another page records; lost confirmation response survives page switching",async({page,context})=>{
  await start(page);await send(page,"杠铃卧推 8 次");const second=await context.newPage();await second.goto("/today");await synced(second);
  const row=second.getByTestId(`set-${bench}-1`);await row.getByLabel("次数",{exact:true}).fill("10");await row.getByRole("button",{name:"完成",exact:true}).click();await synced(second);
  await expect(page.getByTestId("coach-draft")).toContainText("这份草稿不能确认");
  await expect(page.getByTestId("coach-draft").getByRole("button",{name:"确认保存这句话",exact:true})).toBeDisabled();
  await send(page,"杠铃卧推 7 次");
  await page.route("**/api/workout-commands?action=apply",async route=>{expect((await route.fetch()).status()).toBe(200);await route.abort("connectionreset");},{times:1});
  // Close the second page so only this tab owns this particular retry attempt.
  await second.close();await confirm(page);await expect(page.getByRole("alert").filter({hasText:"本次保存结果尚未确认"})).toBeVisible();
  const item=(await state(page)).items[0];await page.getByRole("link",{name:"切换到今日训练卡"}).click();
  await page.getByRole("button",{name:"重试同一操作"}).click();await synced(page);
  expect((await read(page)).session!.sets.map(s=>s.reps)).toEqual([10,7]);
  expect((await db.query("select * from workout_commands where id=$1",[JSON.parse(item.bodyJson).id])).rowCount).toBe(1);
  await page.getByRole("link",{name:"和训练助手聊聊"}).click();await synced(page);
  await expect(page.getByTestId("coach-turn")).toHaveCount(0);await expect(page.getByTestId(`receipt-${JSON.parse(item.bodyJson).id}`)).toContainText("已保存");
});

test("chat replacement preview and compensation leave the long-term plan and next session unchanged",async({page,context})=>{
  await start(page);await send(page,"替换 杠铃卧推");await context.setOffline(true);
  const box=page.getByTestId(`replace-${bench}`);await box.getByLabel("哑铃",{exact:true}).check();await box.getByLabel("替换为",{exact:true}).selectOption("dumbbell-floor-press");
  await box.getByRole("button",{name:"查看替换预览"}).click();await page.getByRole("button",{name:"确认仅本次替换",exact:true}).click();
  await expect(page.getByTestId("replacement-receipts")).toContainText("待同步");
  await page.getByRole("button",{name:"撤销本次替换",exact:true}).click();await page.getByRole("button",{name:"确认撤销替换"}).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("待同步 2 条");await context.setOffline(false);await synced(page);
  const s=(await read(page)).session!;expect(s.prescription.exercises.find(e=>e.name==="杠铃卧推")!.id).not.toBe(bench);expect(s.sets).toEqual([]);
  expect((await db.query("select name,sets,rep_range,target_rpe::float8 as rpe from training_plan_exercises where id=$1",[bench])).rows[0]).toEqual({name:"杠铃卧推",sets:4,rep_range:"8-12",rpe:7});
  await send(page,"练完了");await page.getByRole("button",{name:"确认结束训练",exact:true}).click();
  await expect(page.getByTestId("coach-draft")).toHaveCount(0);await synced(page);
  await page.getByRole("button",{name:"开始另一次训练",exact:true}).click();
  await page.getByTestId("start-session-panel").locator("summary").click();
  await page.getByLabel("选择今天的训练日").selectOption(day);await page.getByRole("button",{name:"开始训练",exact:true}).click();
  await expect(page.getByLabel("当前动作（可选）")).toBeVisible();await synced(page);
  expect((await read(page)).session!.prescription.exercises.some(e=>e.id===bench&&e.name==="杠铃卧推")).toBe(true);
});

test("IME and multiline input never auto-submit; flag, account isolation and English chat",async({page,context})=>{
  await start(page);const input=page.getByLabel("发给训练助手",{exact:true});await input.fill("仅存在本页的私有草稿");
  await input.dispatchEvent("keydown",{key:"Enter",isComposing:true,keyCode:229});await expect(page.getByTestId("coach-turn")).toHaveCount(0);
  await input.press("Shift+Enter");await expect(page.getByTestId("coach-turn")).toHaveCount(0);
  await input.fill("帮助");await input.press("Enter");await expect(page.getByTestId("coach-turn")).toHaveCount(1);
  await page.goto("/settings");await page.getByRole("button",{name:"退出登录",exact:true}).click();
  await expect.poll(async()=>(await page.request.get("/api/workout-sessions")).status()).toBe(401);
  await login(page,"offline-second@example.invalid");await page.goto("/coach");await synced(page);await expect(page.getByTestId("coach-turn")).toHaveCount(0);
  await expect(page.getByLabel("发给训练助手",{exact:true})).toHaveValue("");await page.getByTestId("start-session-panel").locator("summary").click();await expect(page.getByRole("button",{name:"开始训练",exact:true})).toBeDisabled();
  await page.goto("/settings");await page.getByRole("combobox").filter({hasText:"中文"}).click();await page.getByRole("option",{name:"English",exact:true}).click();
  // The local Auth HTTP fixture returns zh-CN on hard reload; use the real SPA preference switch.
  await page.getByRole("link",{name:"Agent",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Agent",exact:true})).toBeVisible();await page.getByText("Training tools & examples",{exact:true}).click();await page.getByRole("button",{name:"show plan",exact:true}).click();
  await expect(page.getByRole("log")).toContainText("No active plan yet");await page.screenshot({path:"node_modules/.cache/coach/chat-english.png",fullPage:true});
  const disabled=await context.newPage();await disabled.goto("http://localhost:3104/coach");await expect(disabled.getByTestId("coach-conversation")).toHaveCount(0);await disabled.close();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
