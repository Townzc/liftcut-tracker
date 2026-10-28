import {test,expect,type Page} from "@playwright/test";
import {Pool} from "pg";
import {randomUUID} from "node:crypto";
import {fixtureRecipient} from "./recipient-fixture";
import {holdGreetingStream} from "./stream-gate";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL}),owner="11111111-1111-4111-8111-111111111111";
async function login(page:Page){
  await page.goto("/login");await page.locator("#email").fill("p1-fixture@example.invalid");await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/\/(?:onboarding)?$/);await page.goto("/agent");
  await expect(page.locator("#coach-input")).toBeEnabled();await page.getByRole("button",{name:"同意并开启",exact:true}).click();
}
async function start(page:Page,text:string){await page.locator("#coach-input").fill(text);await page.getByRole("button",{name:"发送",exact:true}).click();}
test.afterEach(async()=>{await db.query("delete from coach_request_usage where user_id=$1",[owner]);});
test.afterAll(async()=>{await db.end();});

test("explicit record queries read fresh sources before one model call, with private numeric timings",async({page})=>{
  await login(page);await start(page,"查看今天身体和饮食记录，核对已保存的数据");
  const turn=page.getByTestId("coach-turn").last();await expect(turn).toHaveAttribute("aria-busy","false");
  await expect(turn).toContainText("已同时核对");await expect(turn).not.toContainText("toolWallMs");
  const response=await page.request.post("/api/ai/coach",{headers:{Origin:"http://localhost:3103"},data:{id:randomUUID(),text:"查看今天身体和饮食记录，核对已保存的数据",history:[],locale:"zh",timezone:"America/Los_Angeles",consent:"coach-model-v2",recipient:await fixtureRecipient(page.request)}});
  expect(response.status()).toBe(200);const result=await response.json();
  expect(result.sources.map((s:{topic:string})=>s.topic)).toEqual(["body","food"]);
  expect(result.timing.model).toHaveLength(1);expect(result.timing.tools.some((s:{name:string})=>s.name==="read_records.prefetch")).toBe(true);
  expect(result.timing.authMs).toBeGreaterThanOrEqual(0);expect(result.timing.quotaMs).toBeGreaterThanOrEqual(0);
  expect(result.proposal).toBeUndefined();
});

test("a real HTTP stream renders incremental prose before completion, with no raw tool arguments",async({page})=>{
  await login(page);let completed=false;
  page.on("response",r=>{if(r.url().endsWith("/api/ai/coach")&&r.request().method()==="POST")void r.finished().then(()=>{completed=true;}).catch(()=>{});});
  const stream=await holdGreetingStream(page.request);try{
  await start(page,stream.text);const turn=page.getByTestId("coach-turn").last();
  await expect(turn).toContainText("可以自然");await expect(turn).toHaveAttribute("aria-busy","true");expect(completed).toBe(false);
  await expect(turn).not.toContainText("sourceIds");await expect(turn).not.toContainText("finish_response");
  await stream.release();
  await expect(turn).toHaveAttribute("aria-busy","false");await expect(turn).toContainText("今天的变化");
  await page.screenshot({path:"node_modules/.cache/coach-stream-release/stream-complete-mobile.png",fullPage:true});
  }finally{await stream.release();}
});

test("long replies complete in the browser and transmit each character once instead of repeating prefixes",async({page})=>{
  await login(page);await start(page,"你好 [stream-long]");
  await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false",{timeout:15000});
  await expect(page.getByTestId("coach-turn").last().locator("p.mt-1")).toHaveText("这里是连续生成的长回答。".repeat(150));
  const response=await page.request.post("/api/ai/coach",{headers:{Origin:"http://localhost:3103",Accept:"application/x-ndjson"},data:{id:randomUUID(),text:"你好 [stream-long]",history:[],locale:"zh",timezone:"UTC",consent:"coach-model-v2",recipient:await fixtureRecipient(page.request)}});
  expect(response.status()).toBe(200);const raw=await response.text(),events=raw.trim().split("\n").map(s=>JSON.parse(s));
  const result=events.find(e=>e.type==="result").result;
  expect(events.filter(e=>e.type==="text").map(e=>e.text).join("")).toBe(result.message);
  expect(Buffer.byteLength(raw)).toBeLessThan(25000);
});

test("stopped and broken replies are discarded and never sent as later conversation memory",async({page})=>{
  await login(page);const stream=await holdGreetingStream(page.request);try{
  await start(page,stream.text);await expect(page.getByTestId("coach-turn").last()).toContainText("可以自然");
  await page.getByRole("button",{name:"停止",exact:true}).click();await expect(page.getByTestId("coach-turn").last()).toContainText("已停止");
  await expect(page.getByTestId("coach-turn").last()).not.toContainText("可以自然");
  await stream.release();
  await start(page,"你好 [stream-break]");await expect(page.getByTestId("coach-turn").last()).toContainText("未完成的回答已丢弃");
  const request=page.waitForRequest(r=>r.url().endsWith("/api/ai/coach")&&r.method()==="POST");
  await start(page,"你好，重新开始");expect((await request).postDataJSON().history).toEqual([]);
  await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false");
  expect((await db.query("select count(*)::int n from personal_record_events where user_id=$1",[owner])).rows[0].n).toBe(0);
  }finally{await stream.release();}
});

test("unverified sources suppress provisional text and errors never produce a confirmation",async({page})=>{
  await login(page);const observed:string[]=[];await page.exposeFunction("observeReply",(s:string)=>observed.push(s));
  await page.evaluate(()=>{new MutationObserver(()=>{void (window as unknown as {observeReply:(s:string)=>void}).observeReply(document.querySelector('[role="log"]')?.textContent??"");}).observe(document.querySelector('[role="log"]')!,{subtree:true,childList:true,characterData:true});});
  await start(page,"你好 [stream-unverified]");await expect(page.getByTestId("coach-turn").last()).toContainText("未完成的回答已丢弃");
  expect(observed.join("\n")).not.toContain("UNVERIFIED_TEXT_MUST_NOT_RENDER");
  await expect(page.getByTestId("personal-draft")).toHaveCount(0);await expect(page.getByTestId("coach-plan")).toHaveCount(0);
});

test("navigation keeps a live reply running and returning to Agent retains both turns",async({page})=>{
  await login(page);const stream=await holdGreetingStream(page.request);try{
  await start(page,stream.text);await expect(page.getByTestId("coach-turn").last()).toContainText("可以自然");
  await page.getByRole("navigation").getByRole("link",{name:"设置",exact:true}).click();await expect(page.getByTestId("settings-index")).toBeVisible();
  await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","true");
  await stream.release();await expect(page.locator("#coach-input")).toBeEnabled();
  await expect(page.getByTestId("coach-turn").last()).toContainText("今天的变化");
  await start(page,"你好，新的页面");await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false");await expect(page.getByTestId("coach-turn")).toHaveCount(2);
  }finally{await stream.release();}
});

test("Agent is usable before profile/history bootstrap completes, with no status request waterfall",async({page})=>{
  await login(page);let release!:()=>void,observed!:()=>void;const gate=new Promise<void>(r=>{release=r;}),blocked=new Promise<void>(r=>{observed=r;});
  let statusRequests=0;page.on("request",r=>{if(r.url().endsWith("/api/ai/coach")&&r.method()==="GET")statusRequests++;});
  await page.route("**/rest/v1/profiles*",async route=>{observed();await gate;await route.continue();});
  try{
    await page.goto("/agent");await blocked;await expect(page.locator("#coach-input")).toBeEnabled();
    await start(page,"你好");await expect(page.getByTestId("coach-turn").last()).toContainText("可以自然");
    await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false");expect(statusRequests).toBe(0);
  }finally{release();await page.unrouteAll({behavior:"wait"});}
});

test("partial plan arguments expose no apply button; only a validated preview can be confirmed",async({page})=>{
  await login(page);let ended=false;
  const response=page.waitForResponse(r=>r.url().endsWith("/api/ai/coach")&&r.request().method()==="POST");
  await start(page,"帮我生成训练计划 [training-plan] [stream-slow]");
  void (await response).finished().then(()=>{ended=true;}).catch(()=>{});
  await expect(page.getByText("正在准备方案预览…",{exact:true})).toBeVisible();expect(ended).toBe(false);
  await expect(page.getByRole("button",{name:"确认并应用",exact:true})).toHaveCount(0);
  // Stop a large proposal mid-generation: no active plan or ledger preview exists.
  await page.getByRole("button",{name:"停止",exact:true}).click();await expect(page.getByTestId("coach-turn").last()).toContainText("已停止");
  expect((await db.query("select count(*)::int n from agent_private.runs where user_id=$1",[owner])).rows[0].n).toBe(0);
  expect((await db.query("select count(*)::int n from training_plans where user_id=$1 and id like 'agent-%'",[owner])).rows[0].n).toBe(0);
});
