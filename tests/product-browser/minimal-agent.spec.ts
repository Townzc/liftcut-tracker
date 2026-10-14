import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL}),owner="11111111-1111-4111-8111-111111111111";
async function login(page:Page,email="p1-fixture@example.invalid") {
  await page.goto("/login");await page.locator("#email").fill(email);await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/\/(?:onboarding)?$/);
}
async function send(page:Page,text:string){const count=await page.getByTestId("coach-turn").count();await page.getByLabel("发给训练助手",{exact:true}).fill(text);await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByTestId("coach-turn")).toHaveCount(Math.min(count+1,40),{timeout:20000});}
async function entries(page:Page){return (await page.request.get("/api/personal-records")).json();}
async function receipts(page:Page){const detail=page.locator("#coach-receipts");if(await detail.getAttribute("open")===null)await detail.locator("summary").first().click();}
test.afterEach(async()=>{await db.query("delete from personal_record_events where user_id=$1",[owner]);});
test.afterAll(async()=>{await db.end();});

test("three-tab monochrome home, optional manual entry, real save/refresh, Agent lookup and compensating undo",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await login(page);
  const nav=page.getByRole("navigation",{name:"主导航"});await expect(nav.getByRole("link")).toHaveText(["首页","Agent","设置"]);
  await expect(page.getByTestId("personal-entry-form")).not.toBeVisible();
  await page.screenshot({path:"node_modules/.cache/minimal/home-mobile.png",fullPage:true});
  await page.getByText("手动补充一条数据",{exact:true}).click();await page.getByLabel("体重（kg）",{exact:true}).fill("72.5");
  await page.getByRole("button",{name:"保存补录",exact:true}).dblclick();
  await expect.poll(async()=>(await entries(page)).length).toBe(1);
  const record=(await entries(page))[0];expect(record.entry).toMatchObject({kind:"body",weightKg:72.5,waistCm:null});
  expect((await db.query("select request->'entry'->'waistCm' as waist from personal_record_events where id=$1",[record.id])).rows[0].waist).toBe(null);
  await page.reload();await expect(page.getByTestId(`personal-receipt-${record.id}`)).toContainText("72.5");
  await nav.getByRole("link",{name:"Agent",exact:true}).click();await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"最近体重",exact:true}).click();await expect(page.getByRole("log")).toContainText("72.5 kg");
  expect((await page.request.get("/api/workout-sessions")).status()).toBe(200);
  await receipts(page);const card=page.getByTestId(`personal-receipt-${record.id}`);
  await card.getByText("来源与历史",{exact:true}).click();await expect(card).toContainText("首页手动填写");
  await card.getByRole("button",{name:"撤销补录",exact:true}).click();await expect(card).toContainText("已撤销");
  await send(page,"最近体重");await expect(page.getByTestId("coach-turn").last()).toContainText("还没有身体记录");
  expect((await db.query("select count(*)::int as n from personal_record_events where user_id=$1",[owner])).rows[0].n).toBe(2);
  await page.getByRole("navigation").getByRole("link",{name:"设置",exact:true}).click();
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出全部数据 JSON",exact:true}).click();
  const exported=JSON.parse(await readFile((await (await download).path())!,"utf8"));
  expect(exported.personalRecords).toHaveLength(1);expect(exported.personalRecords[0].entry.waistCm).toBe(null);expect(exported.personalRecords[0].undo).not.toBe(null);
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("Agent food drafts do not invent nutrients, response loss replays one request across pages, source survives reload",async({page})=>{
  await login(page);await page.goto("/agent");await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();
  await send(page,"记录午餐 鸡肉饭");await expect(page.getByTestId("personal-draft")).toContainText("— kcal");
  expect(await entries(page)).toEqual([]);
  await page.route("**/api/personal-records",async route=>{
    if(route.request().method()!=="POST"){await route.continue();return;}
    expect((await route.fetch()).status()).toBe(200);await route.abort("connectionreset");
  });
  await page.getByRole("button",{name:"确认补录",exact:true}).click();await expect(page.getByTestId("personal-sync")).toContainText("同步结果尚未确认");
  const old=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith("liftcut-personal-v1:")).map(k=>localStorage.getItem(k)));
  expect(old).toHaveLength(1);await page.unroute("**/api/personal-records");await page.getByRole("navigation").getByRole("link",{name:"首页",exact:true}).click();
  await page.getByRole("button",{name:"重试补录同步",exact:true}).click();await expect(page.getByTestId("personal-sync")).toHaveCount(0);
  expect((await db.query("select count(*)::int as n from personal_record_events where user_id=$1",[owner])).rows[0].n).toBe(1);
  await page.goto("/agent");await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();await send(page,"今天吃了什么");
  await expect(page.getByRole("log")).toContainText("鸡肉饭");await expect(page.getByRole("log")).toContainText("不能代表全天摄入");
  await receipts(page);await page.getByText("来源与历史",{exact:true}).click();await expect(page.getByTestId("personal-receipts")).toContainText("记录午餐 鸡肉饭");
  await page.screenshot({path:"node_modules/.cache/minimal/agent-data-mobile.png",fullPage:true});
});

test("phone, desktop and dark views stay monochrome; keyboard prompt and account isolation",async({page,context})=>{
  await page.goto("/login");await expect(page.getByLabel("邮箱",{exact:true})).toBeVisible();await page.screenshot({path:"node_modules/.cache/minimal/login-mobile.png",fullPage:true});
  await login(page);await page.getByRole("link",{name:"最近体重",exact:true}).click();await expect(page.getByLabel("发给训练助手",{exact:true})).toHaveValue("最近体重");
  await expect(page.getByTestId("coach-turn")).toHaveCount(0);await page.getByLabel("发给训练助手",{exact:true}).press("Enter");await expect(page.getByRole("log")).toContainText("还没有身体记录");
  await send(page,"记下体重 73 公斤");await page.getByRole("button",{name:"确认补录",exact:true}).click();await expect.poll(async()=>(await entries(page)).length).toBe(1);
  await page.goto("/");await page.setViewportSize({width:1440,height:1000});await expect(page.getByTestId("minimal-home")).toBeVisible();await page.screenshot({path:"node_modules/.cache/minimal/home-desktop.png",fullPage:true});
  await page.goto("/agent");await expect(page.getByTestId("coach-conversation")).toBeVisible();await page.screenshot({path:"node_modules/.cache/minimal/agent-desktop.png",fullPage:true});
  await page.emulateMedia({colorScheme:"dark"});await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.locator("body").evaluate(el=>getComputedStyle(el).backgroundColor)).toBe("rgb(33, 33, 33)");
  await page.screenshot({path:"node_modules/.cache/minimal/agent-dark-desktop.png",fullPage:true,animations:"disabled"});
  await page.setViewportSize({width:390,height:844});await page.goto("/settings");await expect(page.getByRole("button",{name:"退出登录",exact:true})).toBeVisible();await page.screenshot({path:"node_modules/.cache/minimal/settings-dark-mobile.png",fullPage:true});
  await page.getByRole("button",{name:"退出登录",exact:true}).click();await login(page,"offline-second@example.invalid");await page.goto("/agent");
  await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();await send(page,"最近体重");await expect(page.getByRole("log")).not.toContainText("73 kg");expect(await entries(page)).toEqual([]);
  const forbidden=await page.request.post("/api/personal-records",{headers:{Origin:"https://untrusted.example","Content-Type":"application/json"},data:{}});expect(forbidden.status()).toBe(403);
  expect((await page.request.get("/api/personal-records",{headers:{"X-Workout-Owner":owner}})).status()).toBe(409);
  expect((await page.request.post("http://localhost:3104/api/personal-records",{data:{}})).status()).toBe(404);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await context.clearCookies();expect((await page.request.get("/api/personal-records")).status()).toBe(401);
});

test("offline body entry persists then syncs once; unavailable local storage sends nothing",async({page,context})=>{
  await login(page);await page.goto("/agent");await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();
  await context.setOffline(true);await send(page,"记下体重 70 公斤");await page.getByRole("button",{name:"确认补录",exact:true}).click();
  await expect(page.getByTestId("personal-sync")).toContainText("1 条补录待同步");
  expect((await db.query("select count(*)::int as n from personal_record_events where user_id=$1",[owner])).rows[0].n).toBe(0);
  const stored=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith("liftcut-personal-v1:")).map(k=>localStorage.getItem(k)));
  expect(stored).toHaveLength(1);await context.setOffline(false);await expect(page.getByTestId("personal-sync")).toHaveCount(0);
  await page.reload();await expect.poll(async()=>(await entries(page)).length).toBe(1);expect((await entries(page))[0].entry.waistCm).toBe(null);
  const sent:string[]=[];page.on("request",r=>{if(r.method()==="POST"&&r.url().includes("/api/personal-records"))sent.push(r.url());});
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith("liftcut-personal-v1:"))throw new DOMException("fixture full","QuotaExceededError");return original.call(this,k,v);};});
  await send(page,"记下体重 69 公斤");await page.getByRole("button",{name:"确认补录",exact:true}).click();
  await expect(page.getByTestId("personal-sync")).toContainText("无法在本机保存，未发送数据");expect(sent).toEqual([]);expect((await entries(page)).length).toBe(1);
});

test("data query reads saved measurements even while the initial personal history load is blocked",async({page})=>{
  await login(page);
  const date=await page.evaluate(()=>new Date().toLocaleDateString("en-CA"));
  const response=await page.request.post("/api/personal-records",{headers:{Origin:"http://localhost:3103","X-Workout-Owner":owner},
    data:{action:"create",id:randomUUID(),entry:{kind:"body",date,weightKg:74,waistCm:null},source:"manual",text:"",anchorDate:date}});
  expect(response.status()).toBe(200);
  let release!:()=>void,observed!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),blocked=new Promise<void>(resolve=>{observed=resolve;});
  await page.route("**/api/personal-records",async route=>{
    const result=await route.fetch();observed();await gate;await route.fulfill({response:result});
  },{times:1});
  try {
    await page.goto("/agent");await blocked;await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();
    await send(page,"最近体重");await expect(page.getByTestId("coach-turn").last()).toContainText("74 kg",{timeout:8000});
  } finally {release();await page.unrouteAll({behavior:"wait"});}
});

test("failed legacy reads, failed new-history reads and offline queries never become empty-history claims",async({page,context})=>{
  await login(page);await page.goto("/agent");await page.waitForLoadState("networkidle");
  await page.route("**/rest/v1/body_metric_logs*",async route=>route.fulfill({response:await route.fetch(),status:503,body:JSON.stringify({message:"synthetic unavailable"})}));
  // PostgREST retries idempotent 503 reads with 1/2/4 second backoff.
  await send(page,"最近体重");await expect(page.getByTestId("coach-turn").last()).toContainText("读取失败不代表没有记录",{timeout:15000});
  await expect(page.getByTestId("coach-turn").last()).not.toContainText("还没有身体记录");await page.unroute("**/rest/v1/body_metric_logs*");
  await page.route("**/api/personal-records",route=>route.fulfill({status:503,contentType:"application/json",body:"{}"}));
  await send(page,"今天吃了什么");await expect(page.getByTestId("coach-turn").last()).toContainText("读取失败不代表没有记录");
  await expect(page.getByTestId("coach-turn").last()).not.toContainText("暂无饮食记录");await page.unroute("**/api/personal-records");
  await context.setOffline(true);await send(page,"本周训练");await expect(page.getByTestId("coach-turn").last()).toContainText("读取失败不代表没有记录");
  await expect(page.getByTestId("coach-turn").last()).not.toContainText("已保存 0 次");
  await context.setOffline(false);
  expect((await page.request.get("/api/workout-sessions/history",{headers:{"X-Workout-Owner":"22222222-2222-4222-8222-222222222222"}})).status()).toBe(409);
});
