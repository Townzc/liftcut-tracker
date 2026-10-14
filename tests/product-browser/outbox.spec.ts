import { test,expect,type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { OutboxState } from "../../src/lib/workout-outbox";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL});
const user="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
const plan=randomUUID(),day=randomUUID(),exercise=randomUUID();
test.beforeAll(async()=>{
  await db.query("insert into auth.users values($1) on conflict do nothing",[user]);
  await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'W3 offline synthetic',true)",[plan,user]);
  await db.query("insert into public.training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
  await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'离线训练')",[day,plan+'w']);
  await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'深蹲',6,'8-12',7)",[exercise,day]);
});
test.afterEach(async()=>{await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2",[user,plan]);});
test.afterAll(async()=>{await db.query("delete from training_plans where id=$1",[plan]);await db.end();});
async function login(page:Page,email="p1-fixture@example.invalid") {
  await page.goto("/login");await page.locator("#email").fill(email);await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click();await page.waitForURL(/\/(?:onboarding)?$/);
}
async function logout(page:Page) {
  await page.goto("/settings");
  await page.getByRole("button",{name:"退出登录",exact:true}).click();
  await expect.poll(async()=>(await page.request.get("/api/workout-sessions")).status()).toBe(401);
}
const synced=async(page:Page)=>await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
async function start(page:Page) {
  await login(page);await page.goto("/today");await synced(page);await page.getByLabel("选择今天的训练日").selectOption(day);
  await page.getByRole("button",{name:"开始训练",exact:true}).click();await expect(page.getByTestId(`set-${exercise}-1`)).toBeVisible();await synced(page);
}
async function snapshot(page:Page):Promise<OutboxState> {
  return page.evaluate(owner=>new Promise((resolve,reject)=>{
    const open=indexedDB.open("liftcut-workout-outbox-v1",1);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction("accounts"),r=tx.objectStore("accounts").get(owner);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};
  }),user);
}
async function tap(page:Page,n:number,reps="8") {
  const row=page.getByTestId(`set-${exercise}-${n}`);await row.getByLabel("次数",{exact:true}).fill(reps);
  await row.getByRole("button",{name:"完成",exact:true}).click();await expect(row.getByText("已完成",{exact:true})).toBeVisible();
}
test("fresh real-account bootstrap never sends demo plans or observed health records",async({page})=>{
  const writes:string[]=[];
  page.on("request",r=>{
    const url=new URL(r.url());
    if(url.pathname.startsWith("/rest/v1/") && !["GET","HEAD","OPTIONS"].includes(r.method()))writes.push(url.pathname);
  });
  await login(page,"offline-second@example.invalid");await page.goto("/today");await synced(page);
  await expect(page.getByRole("button",{name:"开始训练",exact:true})).toBeDisabled();
  expect(writes.filter(path=>!path.endsWith("/profiles") && !path.endsWith("/user_settings"))).toEqual([]);
  const data=await (await page.request.get("/api/workout-sessions")).json();
  expect(data.days).toEqual([]);expect(data.session).toBeNull();expect(data.receipts).toEqual([]);
});

test("offline three sets, correction, compensating void and end sync in exact persisted order",async({page,context})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await start(page);
  const session=(await snapshot(page)).confirmed!.session!.id;await context.setOffline(true);
  for(const n of [1,2,3])await tap(page,n);
  const row1=page.getByTestId(`set-${exercise}-1`),row2=page.getByTestId(`set-${exercise}-2`);
  await row1.getByRole("button",{name:"更正",exact:true}).click();await row1.getByLabel("次数",{exact:true}).fill("7");
  await row1.getByRole("button",{name:"保存更正"}).click();await expect(row1).toContainText("× 7");
  await row2.getByRole("button",{name:"撤销",exact:true}).click();await expect(row2).toContainText("已撤销");
  await page.getByRole("button",{name:"结束训练",exact:true}).click();await expect(page.getByTestId("outbox-status")).toHaveText("待同步 6 条");
  expect((await db.query("select * from set_logs where session_id=$1",[session])).rowCount).toBe(0);
  const queued=(await snapshot(page)).items, sent:string[]=[];
  page.on("request",r=>{if(r.url().includes("/api/workout-sessions?action="))sent.push(r.postData()!);});
  await page.screenshot({path:"node_modules/.cache/w3a/offline-six.png",fullPage:true});
  await context.setOffline(false);await synced(page);
  expect(sent).toEqual(queued.map(i=>i.bodyJson));
  const sets=(await db.query("select status,revision,weight_kg,rpe,reps from set_logs where session_id=$1 order by set_index",[session])).rows;
  expect(sets.map(s=>[s.status,s.revision,s.reps,s.weight_kg,s.rpe])).toEqual([["done",2,7,null,null],["voided",2,8,null,null],["done",1,8,null,null]]);
  expect((await db.query("select status from workout_sessions where id=$1",[session])).rows[0].status).toBe("ended");
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("sentence preview and compensation work offline without API preview or fabricated actuals",async({page,context})=>{
  await start(page);await context.setOffline(true);
  await page.getByLabel("训练原话").fill("深蹲 100 lb 10、8，最后一组 RPE 9");await page.getByRole("button",{name:"解析并预览"}).click();
  await expect(page.getByTestId("sentence-preview")).toContainText("RPE —");await page.getByRole("button",{name:"确认保存这句话"}).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("待同步 1 条");
  const receipt=(await snapshot(page)).items[0],id=JSON.parse(receipt.bodyJson).id;
  await expect(page.getByTestId(`receipt-${id}`)).toContainText("待同步 · 本机暂存");
  await page.getByTestId(`receipt-${id}`).getByRole("button",{name:"撤销这句话"}).click();await expect(page.getByTestId("outbox-status")).toHaveText("待同步 2 条");
  await context.setOffline(false);await synced(page);await expect(page.getByTestId(`receipt-${id}`)).toContainText("撤销回执");
  const state=await snapshot(page);expect(state.confirmed!.session!.sets.map(s=>[s.status,s.inputUnit,s.weightKg,s.rpe])).toEqual([["voided","lb",45.359237,null],["voided","lb",45.359237,9]]);
});
test("lost response survives page close and two tabs claim just one immutable retry",async({page,context})=>{
  await start(page);await page.route("**/api/workout-sessions?action=set",async r=>{expect((await r.fetch()).status()).toBe(200);await r.abort("connectionreset");},{times:1});
  await tap(page,1);await expect(page.getByRole("alert").filter({hasText:"本次保存结果尚未确认"})).toBeVisible();
  const saved=await snapshot(page),body=saved.items[0].bodyJson;await page.close();
  const a=await context.newPage(),b=await context.newPage();const sent:string[]=[];
  let release!:()=>void;const bothClicked=new Promise<void>(resolve=>{release=resolve;});
  await context.route("**/api/workout-sessions?action=set",async r=>{sent.push(r.request().postData()!);await bothClicked;await r.continue();});
  await Promise.all([a.goto("/today"),b.goto("/today")]);
  await expect(a.getByRole("button",{name:"重试同一操作"})).toBeVisible();await expect(b.getByRole("button",{name:"重试同一操作"})).toBeVisible();
  await Promise.all([a.getByRole("button",{name:"重试同一操作"}).click(),b.getByRole("button",{name:"重试同一操作"}).click()]);
  release();
  await synced(a);await synced(b);expect(sent).toEqual([body]);
  const counts=(await db.query("select count(*)::int as n from workout_session_events where session_id=$1 and type='recorded'",[saved.confirmed!.session!.id])).rows[0];expect(counts.n).toBe(1);
});
test("newer cloud revision pauses the whole tail until explicit reviewed discard",async({page,context})=>{
  await start(page);await tap(page,1);await synced(page);const state=await snapshot(page),s=state.confirmed!.session!.sets[0];
  await context.setOffline(true);const row=page.getByTestId(`set-${exercise}-1`);
  await row.getByRole("button",{name:"更正",exact:true}).click();await row.getByLabel("次数",{exact:true}).fill("7");
  await row.getByRole("button",{name:"保存更正"}).click();await expect(row).toContainText("× 7");await tap(page,2);
  const {exerciseName:_,updatedAt:__,...body}=s;void _;void __;
  expect((await page.request.post("/api/workout-sessions?action=set",{headers:{Origin:"http://localhost:3103"},data:{...body,revision:2,reps:12}})).status()).toBe(200);
  await context.setOffline(false);await expect(page.getByRole("alert").filter({hasText:"记录已发生变化"})).toBeVisible();
  expect((await snapshot(page)).items).toHaveLength(2);
  expect((await db.query("select * from set_logs where session_id=$1",[s.sessionId])).rowCount).toBe(1);
  await page.getByRole("button",{name:"查询 / 恢复"}).click();await expect(page.getByTestId("outbox-conflict")).toContainText("× 12");
  await page.screenshot({path:"node_modules/.cache/w3a/conflict.png",fullPage:true});
  await page.getByRole("button",{name:"放弃这 2 条操作，使用云端记录"}).click();await synced(page);await expect(row).toContainText("× 12");
  expect((await snapshot(page)).discarded?.[0].items).toHaveLength(2);
});
test("storage refusal blocks saving before any network write",async({page})=>{
  await start(page);let writes=0;page.on("request",r=>{if(r.method()==="POST" && r.url().includes("/api/workout-"))writes++;});
  await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(names,mode,options){
    if(mode==="readwrite")throw new DOMException("Synthetic quota failure","QuotaExceededError");return original.call(this,names,mode,options);
  };});
  const row=page.getByTestId(`set-${exercise}-1`);await row.getByLabel("次数",{exact:true}).fill("8");await row.getByRole("button",{name:"完成",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"无法在此浏览器保存"})).toBeVisible();expect(writes).toBe(0);expect((await snapshot(page)).items).toHaveLength(0);
  await expect(row.getByLabel("次数",{exact:true})).toHaveValue("8");
});
test("account-bound requests fail closed and old outbox stays isolated after account switch",async({page,context})=>{
  await start(page);await context.setOffline(true);await tap(page,1);const state=await snapshot(page);
  await page.close();await context.setOffline(false);const second=await context.newPage();await logout(second);await login(second,"offline-second@example.invalid");
  await second.goto("/today");await synced(second);await expect(second.getByTestId(`set-${exercise}-1`)).toHaveCount(0);
  const body=JSON.parse(state.items[0].bodyJson);
  for(const path of ["/api/workout-sessions?action=set","/api/workout-commands?action=apply","/api/ai/parse-log"]){
    const res=await second.request.post(path,{headers:{Origin:"http://localhost:3103","X-Workout-Owner":user},data:body});
    expect(res.status()).toBe(409);expect((await res.json()).error).toBe("ACCOUNT_CHANGED");
  }
  expect((await second.request.get("/api/workout-sessions",{headers:{"X-Workout-Owner":user}})).status()).toBe(409);
  expect((await snapshot(second)).items).toHaveLength(1);expect((await db.query("select * from set_logs where session_id=$1",[body.sessionId])).rowCount).toBe(0);
  expect((await db.query("select * from workout_sessions where user_id=$1",[other])).rowCount).toBe(0);
  await logout(second);await login(second);await second.goto("/today");await synced(second);await expect(second.getByTestId(`set-${exercise}-1`)).toContainText("× 8");
  expect((await snapshot(second)).items).toHaveLength(0);
});
test("401 retains the exact operation and pauses until explicit retry",async({page})=>{
  await start(page);await page.route("**/api/workout-sessions?action=set",r=>r.fulfill({status:401,json:{error:"AUTH_REQUIRED"}}),{times:1});
  await tap(page,1);await expect(page.getByRole("alert").filter({hasText:"登录已失效或账号已切换"})).toBeVisible();
  const state=await snapshot(page);expect(state.items[0].status).toBe("auth");
  expect((await db.query("select * from set_logs where session_id=$1",[state.confirmed!.session!.id])).rowCount).toBe(0);
  const retry=page.waitForRequest(r=>r.url().includes("/api/workout-sessions?action=set"));
  await page.getByRole("button",{name:"重试同一操作"}).click();expect((await retry).postData()).toBe(state.items[0].bodyJson);await synced(page);
});
test("unavailable IndexedDB shows an explicit failure instead of silently using memory",async({page})=>{
  await login(page);await page.addInitScript(()=>{Object.defineProperty(window,"indexedDB",{get(){throw new DOMException("Synthetic denial","SecurityError");}});});
  await page.goto("/today");await expect(page.getByRole("alert").filter({hasText:"无法在此浏览器保存"})).toBeVisible();
  await expect(page.getByRole("button",{name:"开始训练",exact:true})).toHaveCount(0);
});
test("a preview made before another local write cannot silently move to later set slots",async({page})=>{
  await start(page);await page.getByLabel("训练原话").fill("深蹲 50 kg 10、8");await page.getByRole("button",{name:"解析并预览"}).click();
  await expect(page.getByTestId("sentence-preview")).toContainText("第 1 组");await tap(page,1);await synced(page);
  await page.getByRole("button",{name:"确认保存这句话"}).click();await expect(page.getByRole("alert").filter({hasText:"当前操作未加入队列"})).toBeVisible();
  const state=await snapshot(page);expect(state.items).toHaveLength(0);expect(state.confirmed!.session!.sets).toHaveLength(1);
  expect((await db.query("select * from workout_commands where session_id=$1",[state.confirmed!.session!.id])).rowCount).toBe(0);
});
test("expired lease from a dead tab is recovered without Web Locks or BroadcastChannel",async({page,context})=>{
  await start(page);await context.setOffline(true);await tap(page,1);
  await page.evaluate(owner=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("liftcut-workout-outbox-v1",1);open.onsuccess=()=>{
      const db=open.result,tx=db.transaction("accounts","readwrite"),store=tx.objectStore("accounts"),r=store.get(owner);
      r.onsuccess=()=>{const state=r.result;state.lease={itemId:state.items[0].id,token:"synthetic-dead-tab",until:Date.now()-1};store.put(state);};
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);
    };
  }),user);
  await page.close();await context.setOffline(false);
  await context.addInitScript(()=>{Object.defineProperty(window,"BroadcastChannel",{value:undefined});Object.defineProperty(navigator,"locks",{value:undefined});});
  const next=await context.newPage();await next.goto("/today");await expect(next.getByTestId(`set-${exercise}-1`)).toContainText("× 8");await synced(next);
  const state=await snapshot(next);expect(state.items).toHaveLength(0);expect(state.lease).toBeUndefined();expect(state.confirmed!.session!.sets).toHaveLength(1);
});
