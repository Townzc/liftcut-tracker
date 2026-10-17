import {test,expect,type Page} from "@playwright/test";
import {Pool} from "pg";
import {randomUUID} from "node:crypto";
import type {PersonalEntry} from "../../src/lib/personal-records";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL}),owner="11111111-1111-4111-8111-111111111111";
const origin={Origin:"http://localhost:3103"};
async function login(page:Page,email="p1-fixture@example.invalid"){
  await page.goto("/login");await page.locator("#email").fill(email);await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/\/(?:onboarding)?$/);await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();
  await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();await page.getByRole("button",{name:"同意并开启",exact:true}).click();
}
async function review(page:Page){if(!await page.getByRole("dialog").isVisible())await page.getByRole("button",{name:"查看方案",exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();}
async function send(page:Page,text:string){if(await page.getByRole("dialog").isVisible())await page.keyboard.press("Escape");const n=await page.getByTestId("coach-turn").count();await page.getByLabel("发给训练助手",{exact:true}).fill(text);await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByTestId("coach-turn")).toHaveCount(n+1);await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false",{timeout:30000});}
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

async function planningFacts(){
  const ids:string[]=[];
  const add=async(entry:PersonalEntry)=>{const id=randomUUID();ids.push(id);await db.query("insert into personal_record_events(id,user_id,request_hash,request,receipt) values($1,$2,$3,$4,$5)",
    [id,owner,"b".repeat(64),{id,action:"create",entry,source:"manual",text:"",anchorDate:entry.date},{id,recordId:id,action:"create"}]);};
  await add({kind:"preference",date:"2026-08-17",key:"goal",value:"增肌"});
  await add({kind:"preference",date:"2026-08-17",key:"diet",value:"不吃奶制品"});
  await add({kind:"body",date:"2026-08-17",weightKg:72.5,waistCm:80});
  for(const [date,weight] of [["2026-08-15",45],["2026-08-16",47.5],["2026-08-17",50]] as const)await add({kind:"exercise",date,exerciseName:"卧推",weightKg:weight,reps:10,sets:null,rpe:null});
  return {add,clear:()=>db.query("delete from personal_record_events where user_id=$1 and id=any($2)",[owner,ids])};
}

test("training uses stored facts in a new conversation, rejects stale memory and preserves unrelated edits",async({page})=>{
  const facts=await planningFacts();
  try{
    await login(page);await send(page,"根据我的情况生成训练计划 [training-plan] [plan-memory]");
    let run=(await recent(page))[0];expect(run.proposal.plan.goal_type).toBe("muscle_gain");expect(run.proposal.plan.reasoning_summary).toContain("72.5");
    expect(run.proposal.plan.reasoning_summary).toContain("2026-08-17");expect(await count("training_plans")).toBe(0);
    expect(run.events.some((e:{type:string})=>e.type==="planning_basis")).toBe(true);
    await facts.add({kind:"body",date:"2026-10-16",weightKg:73,waistCm:null});await page.reload();await expect(page.getByTestId("coach-turn")).toHaveCount(1);await send(page,"查看回执");
    await page.getByRole("button",{name:run.proposal.plan.plan_name,exact:true}).click();
    await expect(page.getByTestId("coach-plan")).toContainText("已确认记录有变化");await review(page);await expect(page.getByRole("button",{name:"确认并应用",exact:true})).toHaveCount(0);
    await send(page,"重新生成训练计划 [training-plan] [plan-memory]");run=(await recent(page))[0];expect(run.proposal.plan.reasoning_summary).toContain("73 kg");
    await review(page);await page.getByRole("button",{name:"确认并应用",exact:true}).click();await expect(page.getByTestId("plan-receipt")).toBeVisible();
    const original=run.proposal.plan;await send(page,"调整卧推为2组 [training-plan] [plan-memory]");run=(await recent(page))[0];
    expect(run.proposal.plan.weeks[0].days[0].exercises[0].sets).toBe(2);expect(run.proposal.plan.weeks[0].days[1]).toEqual(original.weeks[0].days[1]);
    expect(await count("training_plans")).toBe(1);
  }finally{await facts.clear();}
});

test("nutrition reuses confirmed body/goal/food preference and adjusts only requested leaves",async({page})=>{
  const facts=await planningFacts();
  try{
    await login(page);await send(page,"按我保存的数据做饮食计划 [nutrition-plan] [plan-memory]");let run=(await recent(page))[0];
    expect(run.proposal.plan.goal_type).toBe("muscle_gain");expect(run.proposal.plan.summary).toContain("72.5");expect(run.proposal.plan.summary).toContain("不吃奶制品");expect(await count("nutrition_plans")).toBe(0);
    const original=run.proposal.plan;await review(page);await page.getByRole("button",{name:"确认并应用",exact:true}).click();await expect(page.getByTestId("plan-receipt")).toBeVisible();
    await send(page,"调整晚餐少100千卡，其余保持 [nutrition-plan] [plan-memory]");run=(await recent(page))[0];
    expect(run.proposal.plan.daily_targets.calories).toBe(1900);expect(run.proposal.plan.days[0].meals.slice(0,2)).toEqual(original.days[0].meals.slice(0,2));
    expect(await count("nutrition_plans")).toBe(1);
  }finally{await facts.clear();}
});

test("legacy plans without a ledger snapshot retain full structural edits and approval",async({page})=>{
  const legacy=`legacy-${randomUUID()}`;
  await db.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'Legacy synthetic plan',true)",[legacy,owner]);
  await db.query("insert into training_plan_weeks(id,training_plan_id,week_number) values($1,$2,1)",[legacy+'-w1',legacy]);
  await db.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'Legacy day')",[legacy+'-d1',legacy+'-w1']);
  try{
    await login(page);await send(page,"把旧计划扩成每周两天、每次45分钟 [training-plan] [legacy-plan-structure]");
    const run=(await recent(page))[0];expect(run.status).toBe("awaiting_approval");expect(run.proposal.plan.weeks[0].days).toHaveLength(2);
    expect(await count("training_plans")).toBe(0);expect((await db.query("select is_active from training_plans where id=$1",[legacy])).rows[0].is_active).toBe(true);
    await review(page);await page.getByRole("button",{name:"确认并应用",exact:true}).click();await expect(page.getByTestId("plan-receipt")).toBeVisible();
    expect(await count("training_plans")).toBe(1);expect((await db.query("select is_active from training_plans where id=$1",[legacy])).rows[0].is_active).toBe(false);
  }finally{await db.query("delete from training_plans where id=$1 and user_id=$2",[legacy,owner]);}
});

test("a progressing 12-week plan survives 22 seconds, restores its preview, and requires confirmation",async({page})=>{
  await login(page);const began=Date.now();
  await send(page,"做个12周每周两天、每次45分钟的训练计划 [training-plan] [long-program]");
  expect(Date.now()-began).toBeGreaterThan(22000);
  await expect(page.getByTestId("plan-preview")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"确认并应用",exact:true})).toHaveCount(0);
  await review(page);await expect(page.getByTestId("plan-preview").locator("section")).toHaveCount(12);
  expect(await count("training_plans")).toBe(0);
  await page.reload();await review(page);await expect(page.getByTestId("plan-preview").locator("section")).toHaveCount(12);
  const run=(await recent(page))[0];expect(run.proposal.plan.weeks).toHaveLength(12);
  await review(page);await page.getByRole("button",{name:"确认并应用",exact:true}).click();await expect(page.getByTestId("plan-receipt")).toBeVisible();
  expect(await count("training_plans")).toBe(1);
  const stored=await db.query("select count(*)::int n from training_plan_weeks w join training_plans p on p.id=w.training_plan_id where p.user_id=$1 and p.id like 'agent-%'",[owner]);
  expect(stored.rows[0].n).toBe(12);
  await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByTestId("plan-preview")).toHaveCount(0);
  await page.getByRole("navigation").getByRole("link",{name:"首页",exact:true}).click();
  await expect(page.getByTestId("current-plan-card")).toContainText(run.proposal.plan.plan_name);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuemax","84");
  await page.getByTestId("current-plan-card").click();await expect(page.locator("#current-plan-day option")).toHaveCount(24);
  await expect(page.getByTestId("recorded-plan-days")).toContainText("0 / 24");
  await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();await expect(page.getByTestId("plan-preview")).toHaveCount(0);
});

test("switching pages during a confirmed plan write preserves the receipt and releases the composer",async({page})=>{
  await login(page);await send(page,"生成每周两天、每次45分钟的训练计划 [training-plan]");
  let release!:()=>void,observed!:()=>void;const gate=new Promise<void>(r=>{release=r;}),blocked=new Promise<void>(r=>{observed=r;});
  await page.route("**/api/agent/runs/*/execute",async route=>{const response=await route.fetch();expect(response.status()).toBe(200);observed();await gate;await route.fulfill({response});});
  try{
    await review(page);await page.getByRole("button",{name:"确认并应用",exact:true}).click();await blocked;
    await page.getByRole("navigation").getByRole("link",{name:"设置",exact:true}).click();await expect(page.getByTestId("settings-index")).toBeVisible();
    await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();release();
    await expect(page.locator("#coach-input")).toBeEnabled();await expect(page.getByTestId("plan-receipt")).toBeVisible();expect(await count("training_plans")).toBe(1);
  }finally{release();await page.unrouteAll({behavior:"wait"});}
});

test("training preview and revision stay in chat; confirmation response loss recovers exactly once",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await login(page);
  await send(page,"生成每周两天、每次45分钟的训练计划 [training-plan]");
  await review(page);await expect(page.getByTestId("plan-preview")).toContainText("3 组 × 8-10");expect(await count("training_plans")).toBe(0);const old=(await recent(page))[0];
  await send(page,"把刚才草稿里的深蹲调整到两组，其他不变 [training-plan]");await review(page);await expect(page.getByTestId("plan-preview")).toContainText("2 组 × 8-10");
  expect((await (await page.request.get(`/api/agent/runs/${old.id}`)).json()).value.status).toBe("declined");expect(await count("training_plans")).toBe(0);
  await send(page,"好的，就这个吧");expect(await count("training_plans")).toBe(0);
  await page.route("**/api/agent/runs/*/execute",async route=>{expect((await route.fetch()).status()).toBe(200);await route.abort("connectionreset");});
  await review(page);await page.getByRole("button",{name:"确认并应用",exact:true}).dblclick();await expect(page.getByRole("alert").filter({hasText:"结果尚未确认"})).toBeVisible();
  await page.unroute("**/api/agent/runs/*/execute");await page.getByRole("button",{name:"刷新状态",exact:true}).click();
  await expect(page.getByTestId("plan-receipt")).toContainText("保存一次");expect(await count("training_plans")).toBe(1);
  const run=(await recent(page))[0];const binding={proposalId:run.proposal.proposalId,contentHash:run.proposal.contentHash,contextRevision:run.proposal.contextRevision};
  const replay=await page.request.post(`/api/agent/runs/${run.id}/execute`,{headers:origin,data:{binding,approvalId:run.approvalId,idempotencyKey:binding.proposalId}});expect(replay.status()).toBe(200);expect(await count("training_plans")).toBe(1);
  await send(page,"开始训练");await expect(page.getByTestId("conversation-workout").locator("option")).toHaveCount(2);await expect(page.getByRole("button",{name:"开始训练",exact:true})).toBeEnabled();
  expect(page.url()).toContain("/agent");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:"node_modules/.cache/coach-plans/training-confirmed.png",fullPage:true});
});

test("nutrition discard, confirm, adjust, refreshed recovery and owner isolation",async({page,browser})=>{
  await login(page);await send(page,"帮我制定饮食计划 [nutrition-plan]");await review(page);await expect(page.getByTestId("plan-preview")).toContainText("2000 kcal");
  await page.getByRole("button",{name:"放弃此方案",exact:true}).click();await expect(page.getByTestId("coach-plan")).toContainText("此预览已关闭");expect(await count("nutrition_plans")).toBe(0);
  await send(page,"重新制定饮食计划 [nutrition-plan]");await review(page);await page.getByRole("button",{name:"确认并应用",exact:true}).click();await expect(page.getByTestId("plan-receipt")).toBeVisible();expect(await count("nutrition_plans")).toBe(1);
  await send(page,"调整饮食计划到2200千卡 [nutrition-plan]");await review(page);await expect(page.getByTestId("plan-preview")).toContainText("2200 kcal");expect(await count("nutrition_plans")).toBe(1);
  const run=(await recent(page))[0],turnCount=await page.getByTestId("coach-turn").count();await page.reload();await review(page);await expect(page.getByTestId("plan-preview")).toContainText("2200 kcal");await expect(page.getByTestId("coach-turn")).toHaveCount(turnCount);
  const context=await browser.newContext();const other=await context.newPage();await login(other,"offline-second@example.invalid");
  expect((await other.request.get(`/api/agent/runs/${run.id}`)).status()).toBe(404);expect(await recent(other)).toEqual([]);
  await context.close();
  await review(page);await page.getByRole("button",{name:"确认并应用",exact:true}).click();await expect(page.getByTestId("plan-receipt")).toBeVisible();expect(await count("nutrition_plans")).toBe(2);
  expect((await db.query("select daily_calorie_target from nutrition_plans where user_id=$1 and is_active",[owner])).rows[0].daily_calorie_target).toBe(2200);
  await page.screenshot({path:"node_modules/.cache/coach-plans/nutrition-confirmed.png",fullPage:true});
});

test("changed settings block a pending plan and independent reads return both sources",async({page})=>{
  await login(page);await send(page,"制定训练计划 [training-plan]");const run=(await recent(page))[0];
  const binding={proposalId:run.proposal.proposalId,contentHash:run.proposal.contentHash,contextRevision:run.proposal.contextRevision};
  expect((await page.request.post(`/api/agent/runs/${run.id}/user-events`,{headers:{Origin:"https://attacker.invalid"},data:{action:"approve",expectedRevision:run.revision,binding}})).status()).toBe(403);
  expect((await page.request.post(`/api/agent/runs/${run.id}/user-events`,{headers:origin,data:{action:"approve",expectedRevision:run.revision,binding:{...binding,contentHash:"0".repeat(64)}}})).status()).toBe(409);
  await db.query("update user_settings set weekly_training_days=6 where user_id=$1",[owner]);await review(page);await page.getByRole("button",{name:"确认并应用",exact:true}).click();
  await expect(page.getByTestId("coach-plan")).toContainText("请重新生成预览");expect(await count("training_plans")).toBe(0);await expect(page.getByRole("button",{name:"确认并应用",exact:true})).toHaveCount(0);
  await send(page,"同时核对体重和饮食 [mixed-read]");await expect(page.getByTestId("coach-sources").last().locator("summary")).toHaveText("查看依据 · 2");
});
