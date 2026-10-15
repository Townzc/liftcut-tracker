import {test,expect,type Page} from "@playwright/test";
import {Pool} from "pg";
import {randomUUID} from "node:crypto";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL});
const owner="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
async function login(page:Page,email="p1-fixture@example.invalid"){
  await page.goto("/login");await page.locator("#email").fill(email);await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/\/(?:onboarding)?$/);await page.goto("/agent");
  await expect(page.locator("#coach-input")).toBeEnabled();const consent=page.getByRole("button",{name:"同意并开启",exact:true});if(await consent.isVisible())await consent.click();
}
async function send(page:Page,text:string){await page.locator("#coach-input").fill(text);await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false");}
async function synced(page:Page){await expect(page.getByTestId("coach-sync-status")).toHaveText("对话已同步");}
test.beforeEach(async()=>{
  await db.query("delete from coach_conversations where user_id=any($1::uuid[])",[[owner,other]]);
  await db.query("delete from coach_request_usage where user_id=any($1::uuid[])",[[owner,other]]);
});
test.afterEach(async()=>{await db.query("delete from coach_request_usage where user_id=any($1::uuid[])",[[owner,other]]);});
test.afterAll(async()=>{await db.end();});

test("reload and another browser recover cloud history; new conversation isolates model context",async({page,browser})=>{
  await login(page);await send(page,"你好，我是历史验证用户");await synced(page);
  await page.locator("#coach-input").fill("尚未发送的草稿");await page.reload();await expect(page.locator("#coach-input")).toHaveValue("尚未发送的草稿");
  await expect(page.getByTestId("coach-turn")).toHaveCount(1);await expect(page.getByTestId("coach-turn")).toContainText("今天的变化");
  await page.getByRole("button",{name:"记忆范围",exact:true}).click();await expect(page.getByTestId("coach-memory-scope")).toContainText("最近六轮完整内容");
  const context=await browser.newContext({baseURL:"http://localhost:3103",viewport:{width:390,height:844}}),second=await context.newPage();
  try{
    await login(second);await expect(second.getByTestId("coach-turn")).toHaveCount(0);
    await second.getByRole("button",{name:"历史对话",exact:true}).click();await second.getByTestId("coach-history-list").getByRole("button",{name:"你好，我是历史验证用户",exact:true}).click();
    await expect(second.getByTestId("coach-turn")).toHaveCount(1);
    const continuation=second.waitForRequest(r=>r.url().endsWith("/api/ai/coach")&&r.method()==="POST");await send(second,"那接着聊吧");
    expect((await continuation).postDataJSON().history[0].content).toBe("你好，我是历史验证用户");await synced(second);
    await second.getByRole("button",{name:"新对话",exact:true}).click();await expect(second.getByTestId("coach-turn")).toHaveCount(0);
    const fresh=second.waitForRequest(r=>r.url().endsWith("/api/ai/coach")&&r.method()==="POST");await send(second,"你好，新对话");expect((await fresh).postDataJSON().history).toEqual([]);await synced(second);
    await second.screenshot({path:"node_modules/.cache/coach-history-release/new-chat-mobile.png",fullPage:true});
  }finally{await context.close();}
});

test("failed save stays visible and retries after reload; history loading never blocks the composer",async({page})=>{
  await login(page);await page.route("**/api/coach/history*",route=>route.request().method()==="POST"?route.fulfill({status:503,body:"{}"}):route.continue());
  await send(page,"你好，保存失败验证");await expect(page.getByTestId("coach-sync-status")).toHaveText("对话尚未同步");
  await page.reload();await expect(page.locator("#coach-input")).toBeEnabled();await expect(page.getByTestId("coach-turn")).toContainText("保存失败验证");
  await page.unroute("**/api/coach/history*");await page.getByRole("button",{name:"重试同步",exact:true}).click();await synced(page);
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  await page.route("**/api/coach/history*",async route=>{if(route.request().method()==="GET")await gate;await route.continue();});
  try{await page.reload();await expect(page.locator("#coach-input")).toBeEnabled();await expect(page.getByTestId("coach-turn")).toHaveCount(1);}
  finally{release();await page.unrouteAll({behavior:"wait"});}
});

test("reloading an unconfirmed draft restores prose without a confirmation token or a health write",async({page})=>{
  await login(page);await send(page,"昨天早上秤了一下，是七十二点五公斤，帮我补上吧");await expect(page.getByTestId("personal-draft")).toBeVisible();await synced(page);
  await page.getByRole("navigation").getByRole("link",{name:"设置",exact:true}).click();await expect(page.getByTestId("settings-index")).toBeVisible();
  await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();await expect(page.getByTestId("personal-draft")).toBeVisible();
  await page.reload();await expect(page.getByTestId("coach-turn")).toContainText("这是历史草稿");await expect(page.getByTestId("personal-draft")).toHaveCount(0);
  expect((await db.query("select count(*)::int n from personal_record_events where user_id=$1",[owner])).rows[0].n).toBe(0);
  const rows=(await db.query("select payload from coach_turns where user_id=$1",[owner])).rows;expect(JSON.stringify(rows)).not.toContain("modelProof");
});

test("history deletion requires confirmation, defeats late uploads and preserves health data",async({page})=>{
  await login(page);await send(page,"你好，待删除的聊天");await synced(page);
  const id=(await page.request.get("/api/coach/history")).ok()?((await (await page.request.get("/api/coach/history")).json()).items[0].id):"";
  const saved=await (await page.request.get(`/api/coach/history?id=${id}`)).json();
  const marker=randomUUID();await db.query("insert into body_metric_logs(id,user_id,date,weight,waist) values($1,$2,'2026-10-15',72,80)",[marker,owner]);
  try{
    await page.getByRole("button",{name:"历史对话",exact:true}).click();await page.getByRole("button",{name:"删除对话 你好，待删除的聊天",exact:true}).click();
    await expect(page.getByRole("button",{name:"确认删除",exact:true})).toBeVisible();expect((await page.request.get(`/api/coach/history?id=${id}`)).status()).toBe(200);
    await page.getByRole("button",{name:"取消",exact:true}).click();await expect(page.getByTestId("coach-history-list")).toContainText("待删除的聊天");
    await page.getByRole("button",{name:"删除对话 你好，待删除的聊天",exact:true}).click();await page.getByRole("button",{name:"确认删除",exact:true}).click();
    await expect(page.getByTestId("coach-history-list")).not.toContainText("待删除的聊天");
    expect((await page.request.post("/api/coach/history",{headers:{Origin:"http://localhost:3103"},data:{conversationId:id,items:saved.items}})).status()).toBe(404);
    expect((await db.query("select count(*)::int n from body_metric_logs where id=$1",[marker])).rows[0].n).toBe(1);
  }finally{await db.query("delete from body_metric_logs where id=$1",[marker]);}
});

test("another account cannot read or mutate history and API still rejects unauthenticated requests",async({page,browser})=>{
  await login(page);await send(page,"你好，账号隔离验证");await synced(page);const threads=await(await page.request.get("/api/coach/history")).json(),id=threads.items[0].id;
  const context=await browser.newContext({baseURL:"http://localhost:3103"}),second=await context.newPage();
  try{
    expect((await second.request.get(`/api/coach/history?id=${id}`)).status()).toBe(401);
    await login(second,"offline-second@example.invalid");expect((await second.request.get(`/api/coach/history?id=${id}`)).status()).toBe(404);
    expect((await second.request.get("/api/coach/history",{headers:{"X-Workout-Owner":owner}})).status()).toBe(409);
    await second.getByRole("button",{name:"历史对话",exact:true}).click();await expect(second.getByTestId("coach-history-list")).not.toContainText("账号隔离验证");
    expect((await second.request.delete("/api/coach/history",{headers:{Origin:"https://untrusted.invalid"},data:{id}})).status()).toBe(403);
    expect((await page.request.get(`/api/coach/history?id=${id}`)).status()).toBe(200);
  }finally{await context.close();}
});

test("Android WeChat user agent under slow 4G keeps streaming, composition and tab continuity",async({browser})=>{
  const context=await browser.newContext({baseURL:"http://localhost:3103",viewport:{width:393,height:851},isMobile:true,hasTouch:true,
    userAgent:"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.50"});
  const page=await context.newPage();try{
    await login(page);const cdp=await context.newCDPSession(page);await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:100000});
    await page.locator("#coach-input").fill("你好 [stream-slow]");await page.getByRole("button",{name:"发送",exact:true}).click();
    await expect(page.getByTestId("coach-turn")).toContainText("可以自然");await expect(page.getByTestId("coach-turn")).toHaveAttribute("aria-busy","true");
    await page.getByRole("navigation").getByRole("link",{name:"设置",exact:true}).click();await expect(page.getByTestId("settings-index")).toBeVisible();
    await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();await expect(page.getByTestId("coach-turn")).toHaveAttribute("aria-busy","false");await synced(page);
    await page.locator("#coach-input").fill("输入法组合中");await page.locator("#coach-input").dispatchEvent("keydown",{key:"Enter",code:"Enter",isComposing:true,keyCode:229});
    await expect(page.getByTestId("coach-turn")).toHaveCount(1);await expect(page.locator("#coach-input")).toHaveValue("输入法组合中");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:"node_modules/.cache/coach-history-release/wechat-slow4g-mobile.png",fullPage:true});
    await page.reload();await expect(page.getByTestId("coach-turn")).toHaveCount(1);await expect(page.locator("#coach-input")).toHaveValue("输入法组合中");
  }finally{await context.close();}
});
