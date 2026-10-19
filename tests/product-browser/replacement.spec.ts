import { test,expect,type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { localContextHash } from "../../src/lib/workout-context";
import type { Session } from "@liftcut/core/today";
import type { OutboxState } from "../../src/lib/workout-outbox";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL});
const user="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",plan=randomUUID(),day=randomUUID(),exercise=randomUUID();
test.beforeAll(async()=>{
  await db.query("insert into auth.users values($1) on conflict do nothing",[user]);
  await db.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'W3b synthetic plan',true)",[plan,user]);
  await db.query("insert into training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
  await db.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'本次替换测试')",[day,plan+'w']);
  await db.query("insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'杠铃卧推',3,'8-12',7)",[exercise,day]);
});
test.afterEach(async()=>{await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2",[user,plan]);});
test.afterAll(async()=>{await db.query("delete from training_plans where id=$1",[plan]);await db.end();});
const synced=async(page:Page)=>expect(page.getByTestId("outbox-status")).toHaveText("已同步");
async function start(page:Page){await page.goto("/login");await page.locator("#email").fill("p1-fixture@example.invalid");
  await page.locator("#password").fill("p1-fixture-password");await page.locator('button[type="submit"]').click();await page.waitForURL(/\/(?:onboarding)?$/);
  await page.goto("/today");await synced(page);await page.getByLabel("选择今天的训练日").selectOption(day);await page.getByRole("button",{name:"开始训练",exact:true}).click();
  await expect(page.getByTestId(`set-${exercise}-1`)).toBeVisible();await synced(page);}
async function state(page:Page):Promise<OutboxState>{return page.evaluate(owner=>new Promise(resolve=>{const open=indexedDB.open("liftcut-workout-outbox-v1",1);
  open.onsuccess=()=>{const d=open.result,tx=d.transaction("accounts"),req=tx.objectStore("accounts").get(owner);req.onsuccess=()=>resolve(req.result);tx.oncomplete=()=>d.close();};}),user);}
const live=async(page:Page):Promise<Session>=>(await(await page.request.get("/api/workout-sessions")).json()).session;
async function preview(page:Page,id:string=exercise){const box=page.getByTestId(`replace-${id}`);await box.getByRole("button",{name:"仅本次替换动作",exact:true}).click();
  await box.getByLabel("哑铃",{exact:true}).check();await box.getByLabel("替换为",{exact:true}).selectOption("dumbbell-floor-press");
  await box.getByRole("button",{name:"查看替换预览"}).click();await expect(page.getByTestId("replacement-preview")).toBeVisible();}
async function confirm(page:Page){await page.getByRole("button",{name:"确认仅本次替换",exact:true}).click();
  // An older receipt can already be visible. Wait for this preview to close only
  // after its operation has been durably enqueued and its projection applied.
  await expect(page.getByTestId("replacement-preview")).toBeHidden();await expect(page.getByTestId("replacement-receipts")).toBeVisible();}
const replaceBody=async(s:Session)=>({id:randomUUID(),sessionId:s.id,version:1,revision:s.revision+1,exerciseId:exercise,newExerciseId:randomUUID(),
  contextHash:await localContextHash(s),catalogVersion:"session-v1",candidateId:"dumbbell-floor-press",equipment:["dumbbells"],authorization:"confirm_preview"});
const tap=(s:Session,id:string=exercise)=>({id:randomUUID(),sessionId:s.id,planExerciseId:id,setIndex:1,revision:1,status:"done",weightKg:null,reps:8,rpe:null,
  weightSource:null,repsSource:"user_entered",inputUnit:"kg",sourceRef:"today-tap"});
const post=(page:Page,path:string,data:unknown,owner=user)=>page.request.post(path,{headers:{Origin:"http://localhost:3103","X-Workout-Owner":owner},data});
async function record(page:Page,id:string){const row=page.getByTestId(`set-${id}-1`);await expect(row.getByLabel("重量 (kg)")).toHaveValue("");await expect(row.getByLabel("RPE",{exact:true})).toHaveValue("");
  await row.getByLabel("次数",{exact:true}).fill("8");await row.getByRole("button",{name:"完成",exact:true}).click();await expect(row).toContainText("已完成");}

test("preview/cancel never writes; equipment is explicit, confirmation changes session only",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await start(page);const before=await live(page);await preview(page);
  await expect(page.getByTestId("replacement-preview")).toContainText("实际重量、次数和 RPE 留空");
  expect((await db.query("select * from workout_exercise_changes where session_id=$1",[before.id])).rowCount).toBe(0);
  await page.getByRole("button",{name:"取消预览"}).click();expect((await live(page)).revision).toBe(1);
  await page.getByRole("button",{name:"查看替换预览"}).click();await page.screenshot({path:"node_modules/.cache/w3b/replacement-preview.png",fullPage:true});
  await confirm(page);await synced(page);const after=await live(page),id=after.prescription.exercises[0].id;
  expect(id).not.toBe(exercise);expect(after.replacements).toHaveLength(1);expect(after.sets).toEqual([]);
  for(const name of ["重量 (kg)","次数","RPE"])await expect(page.getByTestId(`set-${id}-1`).getByLabel(name,{exact:true})).toHaveValue("");
  expect((await db.query("select name,sets,rep_range,target_rpe::float8 as target_rpe from training_plan_exercises where id=$1",[exercise])).rows[0]).toEqual({name:"杠铃卧推",sets:3,rep_range:"8-12",target_rpe:7});
  await page.reload();await synced(page);await expect(page.getByTestId("replacement-receipts")).toContainText("云端回执已保存");expect(errors).toEqual([]);
});
test("offline replacement -> compensation -> replacement -> actual -> end syncs original bytes and identities",async({page,context})=>{
  await start(page);const initial=await live(page);await context.setOffline(true);await preview(page);await confirm(page);
  await page.getByRole("button",{name:"撤销本次替换",exact:true}).click();await page.getByRole("button",{name:"确认撤销替换"}).click();
  await expect.poll(async()=>(await state(page)).items.length).toBe(2);
  let snapshot=await state(page);const restored=JSON.parse(snapshot.items[1].bodyJson).newExerciseId;expect(restored).not.toBe(exercise);
  await preview(page,restored);await confirm(page);snapshot=await state(page);const replacement=JSON.parse(snapshot.items[2].bodyJson);
  await record(page,replacement.newExerciseId);await page.getByRole("button",{name:"结束训练",exact:true}).click();
  await expect.poll(async()=>(await state(page)).items.length).toBe(5);
  snapshot=await state(page);expect(snapshot.items.map(x=>x.action)).toEqual(["replace","undoReplacement","replace","set","end"]);
  expect((await db.query("select * from workout_exercise_changes where session_id=$1",[initial.id])).rowCount).toBe(0);
  await page.screenshot({path:"node_modules/.cache/w3b/offline-replacement-chain.png",fullPage:true});
  const sent:string[]=[];page.on("request",r=>{if(r.method()==="POST"&&r.url().includes("/api/workout-"))sent.push(r.postData()!);});
  await context.setOffline(false);await synced(page);expect(sent).toEqual(snapshot.items.map(x=>x.bodyJson));
  const actual=(await db.query("select exercise_name,weight_kg,reps,rpe,plan_exercise_id from set_logs where session_id=$1",[initial.id])).rows;
  expect(actual).toEqual([{exercise_name:"哑铃地板卧推",weight_kg:null,reps:8,rpe:null,plan_exercise_id:replacement.newExerciseId}]);
  expect((await db.query("select * from workout_exercise_changes where session_id=$1",[initial.id])).rowCount).toBe(3);
});
test("committed response lost: same request survives refresh, multi-tab retry and later compensation",async({page,context})=>{
  await start(page);await preview(page);await page.route("**/api/workout-replacements?action=replace",async r=>{expect((await r.fetch()).status()).toBe(200);await r.abort("connectionreset");},{times:1});
  await confirm(page);await expect(page.getByRole("alert").filter({hasText:"本次保存结果尚未确认"})).toBeVisible();const original=(await state(page)).items[0];
  await page.reload();const second=await context.newPage();await second.goto("/today");await page.getByRole("button",{name:"重试同一操作"}).click();await synced(page);await synced(second);
  const s=await live(page);expect(s.replacements).toHaveLength(1);expect(s.replacements![0].id).toBe(JSON.parse(original.bodyJson).id);
  await second.getByRole("button",{name:"撤销本次替换",exact:true}).click();await second.getByRole("button",{name:"确认撤销替换"}).click();
  // The previous operation's "synced" badge can still be visible while the
  // confirmation hashes and durably enqueues. Do not reload a tab mid-request.
  await expect(second.getByTestId("replacement-undo-preview")).toBeHidden();await synced(second);
  await page.reload();await synced(page);await expect(page.getByTestId("replacement-receipts")).toContainText("已补偿");
  expect((await post(page,"/api/workout-replacements?action=replace",JSON.parse(original.bodyJson))).status()).toBe(200);
  expect((await live(page)).replacements![0].undo).not.toBeNull();await second.close();
});
test("old device queued set conflicts after another device replaces; no automatic remapping",async({page,context})=>{
  await start(page);const initial=await live(page);await context.setOffline(true);await record(page,exercise);
  const req=await replaceBody(initial);expect((await post(page,"/api/workout-replacements?action=replace",req)).status()).toBe(200);
  await context.setOffline(false);await expect(page.getByRole("alert").filter({hasText:"记录已发生变化"})).toBeVisible();
  expect((await db.query("select * from set_logs where session_id=$1",[initial.id])).rowCount).toBe(0);
  await page.getByRole("button",{name:"查询 / 恢复"}).click();await expect(page.getByTestId("outbox-conflict")).toContainText("哑铃地板卧推");
  await page.getByRole("button",{name:"放弃这 1 条操作，使用云端记录"}).click();await synced(page);await expect(page.getByTestId(`set-${req.newExerciseId}-1`)).toBeVisible();
});
test("other device records original exercise: replacement and dependent new set pause together",async({page,context})=>{
  await start(page);const initial=await live(page);await context.setOffline(true);await preview(page);await confirm(page);
  const req=JSON.parse((await state(page)).items[0].bodyJson);await record(page,req.newExerciseId);
  expect((await post(page,"/api/workout-sessions?action=set",tap(initial))).status()).toBe(200);
  await context.setOffline(false);await expect(page.getByRole("alert").filter({hasText:"记录已发生变化"})).toBeVisible();expect((await state(page)).items).toHaveLength(2);
  expect((await db.query("select * from workout_exercise_changes where session_id=$1",[initial.id])).rowCount).toBe(0);
  await page.getByRole("button",{name:"查询 / 恢复"}).click();await page.screenshot({path:"node_modules/.cache/w3b/replacement-conflict.png",fullPage:true});
  await page.getByRole("button",{name:"放弃这 2 条操作，使用云端记录"}).click();await synced(page);
  await expect(page.getByTestId(`replace-${exercise}`).getByRole("button",{name:"仅本次替换动作"})).toBeDisabled();
  expect((await live(page)).sets).toHaveLength(1);
});
test("stale undo preview after other device records never removes that actual; ended session cannot replace",async({page})=>{
  await start(page);await preview(page);await confirm(page);await synced(page);const s=await live(page),id=s.prescription.exercises[0].id;
  await page.getByRole("button",{name:"撤销本次替换",exact:true}).click();expect((await post(page,"/api/workout-sessions?action=set",tap(s,id))).status()).toBe(200);
  await page.getByRole("button",{name:"确认撤销替换"}).click();await expect(page.getByRole("alert").filter({hasText:"记录已发生变化"})).toBeVisible();
  expect((await live(page)).sets).toHaveLength(1);expect((await live(page)).replacements![0].undo).toBeNull();
  await page.getByRole("button",{name:"查询 / 恢复"}).click();await page.getByRole("button",{name:"放弃这 1 条操作，使用云端记录"}).click();await synced(page);
  await expect(page.getByRole("button",{name:"撤销本次替换",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"结束训练",exact:true}).click();await synced(page);
  const bad=await replaceBody(s);expect((await post(page,"/api/workout-replacements?action=replace",bad)).status()).toBe(409);
});
test("owner/origin/flag authorization and invalid catalog are enforced at HTTP boundary",async({page})=>{
  await start(page);const req=await replaceBody(await live(page));
  expect((await post(page,"/api/workout-replacements?action=replace",req,other)).status()).toBe(409);
  expect((await page.request.post("/api/workout-replacements?action=replace",{headers:{Origin:"https://attacker.invalid"},data:req})).status()).toBe(403);
  expect((await post(page,"/api/workout-replacements?action=replace",{...req,catalogVersion:"old"})).status()).toBe(400);
  expect((await page.request.post("http://localhost:3104/api/workout-replacements?action=replace",{data:req})).status()).toBe(404);
  expect((await live(page)).revision).toBe(1);
});
test("language switch changes labels without altering stored action name or request identity",async({page})=>{
  await start(page);await preview(page);await confirm(page);await synced(page);const before=await live(page);
  await page.goto("/settings/preferences");await page.getByRole("combobox").filter({hasText:"中文"}).click();await page.getByRole("option",{name:"English",exact:true}).click();
  // The local profile HTTP double always returns zh-CN on a hard reload.
  // Exercise the actual in-app language switch; hosted verification also reloads real persisted preferences.
  await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Current exercise (optional)",exact:true})).toContainText("Dumbbell floor press");
  expect((await live(page)).prescription).toEqual(before.prescription);expect((await live(page)).replacements).toEqual(before.replacements);
});
