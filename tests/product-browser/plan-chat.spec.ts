import {test,expect,type Page} from "@playwright/test";
import {Pool} from "pg";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL}),owner="11111111-1111-4111-8111-111111111111";
const origin={Origin:"http://localhost:3103"};
async function login(page:Page,email="p1-fixture@example.invalid"){
  await page.goto("/login");await page.locator("#email").fill(email);await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/\/(?:onboarding)?$/);await page.goto("/agent");
  await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();await page.getByRole("button",{name:"同意并开启",exact:true}).click();
}
async function send(page:Page,text:string){const n=await page.getByTestId("coach-turn").count();await page.getByLabel("发给训练助手",{exact:true}).fill(text);await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByTestId("coach-turn")).toHaveCount(n+1);await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false",{timeout:30000});}
const recent=async(page:Page)=>(await (await page.request.get("/api/agent/runs")).json()).value;
const count=async(table:string)=>Number((await db.query(`select count(*) n from ${table} where user_id=$1 and id like 'agent-%'`,[owner])).rows[0].n);
test.beforeEach(async()=>{await db.query("delete from coach_request_usage where user_id=$1",[owner]);});
test.afterEach(async()=>{
  await db.query("update agent_private.runs set current_proposal=null where user_id=$1",[owner]);
  for(const table of ["receipts","execution_keys","events","proposals","runs"])await db.query(`delete from agent_private.${table} where user_id=$1`,[owner]);
  for(const table of ["training_plans","nutrition_plans"])await db.query(`delete from ${table} where user_id=$1 and id like 'agent-%'`,[owner]);
  await db.query("update user_settings set weekly_training_days=3 where user_id=$1",[owner]);
  await db.query("delete from coach_request_usage where user_id=$1",[owner]);
});
test.afterAll(async()=>{await db.end();});

test("a progressing 12-week plan survives 22 seconds, restores its preview, and requires confirmation",async({page})=>{
  await login(page);const began=Date.now();
  await send(page,"做个12周每周两天、每次45分钟的训练计划 [training-plan] [long-program]");
  expect(Date.now()-began).toBeGreaterThan(22000);
  await expect(page.getByTestId("plan-preview").locator("section")).toHaveCount(12);
  expect(await count("training_plans")).toBe(0);
  await page.reload();await expect(page.getByTestId("plan-preview").locator("section")).toHaveCount(12);
  const run=(await recent(page))[0];expect(run.proposal.plan.weeks).toHaveLength(12);
  await page.getByRole("button",{name:"确认并应用",exact:true}).click();await expect(page.getByTestId("plan-receipt")).toBeVisible();
  expect(await count("training_plans")).toBe(1);
  const stored=await db.query("select count(*)::int n from training_plan_weeks w join training_plans p on p.id=w.training_plan_id where p.user_id=$1 and p.id like 'agent-%'",[owner]);
  expect(stored.rows[0].n).toBe(12);
});

test("switching pages during a confirmed plan write preserves the receipt and releases the composer",async({page})=>{
  await login(page);await send(page,"生成每周两天、每次45分钟的训练计划 [training-plan]");
  let release!:()=>void,observed!:()=>void;const gate=new Promise<void>(r=>{release=r;}),blocked=new Promise<void>(r=>{observed=r;});
  await page.route("**/api/agent/runs/*/execute",async route=>{const response=await route.fetch();expect(response.status()).toBe(200);observed();await gate;await route.fulfill({response});});
  try{
    await page.getByRole("button",{name:"确认并应用",exact:true}).click();await blocked;
    await page.getByRole("navigation").getByRole("link",{name:"设置",exact:true}).click();await expect(page.getByTestId("settings-index")).toBeVisible();
    await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();release();
    await expect(page.locator("#coach-input")).toBeEnabled();await expect(page.getByTestId("plan-receipt")).toBeVisible();expect(await count("training_plans")).toBe(1);
  }finally{release();await page.unrouteAll({behavior:"wait"});}
});

test("training preview and revision stay in chat; confirmation response loss recovers exactly once",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await login(page);
  await send(page,"生成每周两天、每次45分钟的训练计划 [training-plan]");
  await expect(page.getByTestId("coach-plan")).toContainText("3 组 × 8-10");expect(await count("training_plans")).toBe(0);const old=(await recent(page))[0];
  await send(page,"把刚才草稿里的深蹲调整到两组，其他不变 [training-plan]");await expect(page.getByTestId("coach-plan")).toContainText("2 组 × 8-10");
  expect((await (await page.request.get(`/api/agent/runs/${old.id}`)).json()).value.status).toBe("declined");expect(await count("training_plans")).toBe(0);
  await send(page,"好的，就这个吧");expect(await count("training_plans")).toBe(0);
  await page.route("**/api/agent/runs/*/execute",async route=>{expect((await route.fetch()).status()).toBe(200);await route.abort("connectionreset");});
  await page.getByRole("button",{name:"确认并应用",exact:true}).dblclick();await expect(page.getByRole("alert").filter({hasText:"结果尚未确认"})).toBeVisible();
  await page.unroute("**/api/agent/runs/*/execute");await page.getByRole("button",{name:"刷新状态",exact:true}).click();
  await expect(page.getByTestId("plan-receipt")).toContainText("保存一次");expect(await count("training_plans")).toBe(1);
  const run=(await recent(page))[0];const binding={proposalId:run.proposal.proposalId,contentHash:run.proposal.contentHash,contextRevision:run.proposal.contextRevision};
  const replay=await page.request.post(`/api/agent/runs/${run.id}/execute`,{headers:origin,data:{binding,approvalId:run.approvalId,idempotencyKey:binding.proposalId}});expect(replay.status()).toBe(200);expect(await count("training_plans")).toBe(1);
  await send(page,"开始训练");await expect(page.getByTestId("conversation-workout").locator("option")).toHaveCount(2);await expect(page.getByRole("button",{name:"开始训练",exact:true})).toBeEnabled();
  expect(page.url()).toContain("/agent");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:"node_modules/.cache/coach-plans/training-confirmed.png",fullPage:true});
});

test("nutrition discard, confirm, adjust, refreshed recovery and owner isolation",async({page,browser})=>{
  await login(page);await send(page,"帮我制定饮食计划 [nutrition-plan]");await expect(page.getByTestId("coach-plan")).toContainText("2000 kcal");
  await page.getByRole("button",{name:"放弃此方案",exact:true}).click();await expect(page.getByTestId("coach-plan")).toContainText("此预览已关闭");expect(await count("nutrition_plans")).toBe(0);
  await send(page,"重新制定饮食计划 [nutrition-plan]");await page.getByRole("button",{name:"确认并应用",exact:true}).click();await expect(page.getByTestId("plan-receipt")).toBeVisible();expect(await count("nutrition_plans")).toBe(1);
  await send(page,"调整饮食计划到2200千卡 [nutrition-plan]");await expect(page.getByTestId("coach-plan")).toContainText("2200 kcal");expect(await count("nutrition_plans")).toBe(1);
  const run=(await recent(page))[0],turnCount=await page.getByTestId("coach-turn").count();await page.reload();await expect(page.getByTestId("coach-plan")).toContainText("2200 kcal");await expect(page.getByTestId("coach-turn")).toHaveCount(turnCount);
  const context=await browser.newContext();const other=await context.newPage();await login(other,"offline-second@example.invalid");
  expect((await other.request.get(`/api/agent/runs/${run.id}`)).status()).toBe(404);expect(await recent(other)).toEqual([]);
  await context.close();
  await page.getByRole("button",{name:"确认并应用",exact:true}).click();await expect(page.getByTestId("plan-receipt")).toBeVisible();expect(await count("nutrition_plans")).toBe(2);
  expect((await db.query("select daily_calorie_target from nutrition_plans where user_id=$1 and is_active",[owner])).rows[0].daily_calorie_target).toBe(2200);
  await page.screenshot({path:"node_modules/.cache/coach-plans/nutrition-confirmed.png",fullPage:true});
});

test("changed settings block a pending plan and independent reads return both sources",async({page})=>{
  await login(page);await send(page,"制定训练计划 [training-plan]");const run=(await recent(page))[0];
  const binding={proposalId:run.proposal.proposalId,contentHash:run.proposal.contentHash,contextRevision:run.proposal.contextRevision};
  expect((await page.request.post(`/api/agent/runs/${run.id}/user-events`,{headers:{Origin:"https://attacker.invalid"},data:{action:"approve",expectedRevision:run.revision,binding}})).status()).toBe(403);
  expect((await page.request.post(`/api/agent/runs/${run.id}/user-events`,{headers:origin,data:{action:"approve",expectedRevision:run.revision,binding:{...binding,contentHash:"0".repeat(64)}}})).status()).toBe(409);
  await db.query("update user_settings set weekly_training_days=6 where user_id=$1",[owner]);await page.getByRole("button",{name:"确认并应用",exact:true}).click();
  await expect(page.getByTestId("coach-plan")).toContainText("已变化");expect(await count("training_plans")).toBe(0);await expect(page.getByRole("button",{name:"确认并应用",exact:true})).toHaveCount(0);
  await send(page,"同时核对体重和饮食 [mixed-read]");await expect(page.getByTestId("coach-sources").last().locator("summary")).toHaveText("查看依据 · 2");
});
