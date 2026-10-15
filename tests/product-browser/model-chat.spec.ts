import {test,expect,type Page} from "@playwright/test";
import {Pool} from "pg";
import {randomUUID} from "node:crypto";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL}),owner="11111111-1111-4111-8111-111111111111";
async function login(page:Page,email="p1-fixture@example.invalid"){
  await page.goto("/login");await page.locator("#email").fill(email);await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/\/(?:onboarding)?$/);await page.goto("/agent");
  await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();
}
async function enable(page:Page){await page.getByRole("button",{name:"同意并开启",exact:true}).click();}
async function send(page:Page,text:string){const n=await page.getByTestId("coach-turn").count();await page.getByLabel("发给训练助手",{exact:true}).fill(text);await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByTestId("coach-turn")).toHaveCount(n+1);await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false",{timeout:25000});}
const entries=async(page:Page)=>(await page.request.get("/api/personal-records")).json();
test.afterEach(async()=>{await db.query("delete from personal_record_events where user_id=$1",[owner]);await db.query("delete from coach_request_usage where user_id=$1",[owner]);});
test.afterAll(async()=>{await db.end();});

test("model consent, oral body draft, no write until confirmation, signed replay, fresh query and follow-up",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await login(page);
  await expect(page.getByTestId("coach-consent")).toContainText("身体、饮食和训练数据");
  await send(page,"你好呀");expect((await db.query("select count(*)::int n from coach_request_usage where user_id=$1",[owner])).rows[0].n).toBe(0);
  await enable(page);await send(page,"昨天早上秤了一下，是七十二点五公斤，帮我补上吧");
  await expect(page.getByTestId("personal-draft")).toContainText("72.5 kg");await expect(page.getByTestId("personal-draft")).toContainText("— cm");expect(await entries(page)).toEqual([]);
  let posted="";page.on("request",r=>{if(r.method()==="POST"&&r.url().includes("/api/personal-records"))posted=r.postData()!;});
  await page.getByRole("button",{name:"确认补录",exact:true}).dblclick();await expect.poll(async()=>(await entries(page)).length).toBe(1);
  expect(JSON.parse(posted).modelProof).toBeTruthy();const receipt=(await entries(page))[0];expect(receipt.model).toBeTruthy();
  expect((await page.request.post("/api/personal-records",{headers:{Origin:"http://localhost:3103"},data:JSON.parse(posted)})).status()).toBe(200);expect((await entries(page)).length).toBe(1);
  await send(page,"帮我看看最近几天体重变化怎么样");await expect(page.getByTestId("coach-turn").last()).toContainText("72.5 kg");
  await page.getByTestId("coach-sources").last().locator("summary").click();await expect(page.getByTestId("coach-sources").last()).toContainText("腰围 cm: —");
  await send(page,"那昨天呢");await expect(page.getByTestId("coach-turn").last()).toContainText("72.5 kg");
  await expect(page.getByTestId("coach-sources").last().locator("summary")).toHaveText("查看依据 · 1");
  await page.screenshot({path:"node_modules/.cache/coach-model/body-and-followup.png",fullPage:true});
  await page.getByRole("button",{name:"对话选项"}).click();await page.getByRole("button",{name:"关闭并清空对话"}).click();await expect(page.getByTestId("coach-turn")).toHaveCount(0);
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("natural food draft keeps nulls; tampering, cross-user reuse, response loss and offline confirmation",async({page,context})=>{
  await login(page);await enable(page);await send(page,"中午吃了一碗牛肉面，热量没查到，帮我记一下");
  await expect(page.getByTestId("personal-draft")).toContainText("— kcal");
  await context.setOffline(true);await page.getByRole("button",{name:"确认补录",exact:true}).click();await expect(page.getByTestId("personal-sync")).toContainText("待同步");
  const original=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith("liftcut-personal-v1:")).map(k=>localStorage.getItem(k)!)[0]);
  await page.route("**/api/personal-records",async route=>{if(route.request().method()!=="POST"){await route.continue();return;}expect((await route.fetch()).status()).toBe(200);await route.abort("connectionreset");});
  await context.setOffline(false);await expect(page.getByTestId("personal-sync")).toContainText("同步结果尚未确认");
  const command=JSON.parse(original);expect((await page.request.post("/api/personal-records",{headers:{Origin:"http://localhost:3103"},data:{...command,id:randomUUID(),entry:{...command.entry,calories:600}}})).status()).toBe(409);
  await page.unroute("**/api/personal-records");await page.getByRole("button",{name:"重试补录同步"}).click();await expect(page.getByTestId("personal-sync")).toHaveCount(0);
  expect((await entries(page))[0].entry).toMatchObject({calories:null,protein:null});expect((await entries(page)).length).toBe(1);
  // Reproduce a slow sign-out: navigation must not cancel its HTTP request and
  // then mistake the still-authenticated redirect for a missing login form.
  await page.route("**/auth/v1/logout*",async route=>{await new Promise(r=>setTimeout(r,350));await route.continue();});
  await page.goto("/settings/account");await page.getByRole("button",{name:"退出登录",exact:true}).click();
  await expect.poll(async()=>(await page.request.get("/api/workout-sessions")).status()).toBe(401);
  await login(page,"offline-second@example.invalid");
  await expect(page.getByRole("button",{name:"同意并开启"})).toBeVisible();expect(await entries(page)).toEqual([]);
  expect((await page.request.post("/api/personal-records",{headers:{Origin:"http://localhost:3103"},data:{...command,id:randomUUID()}})).status()).toBe(409);
  expect((await page.request.post("/api/ai/coach",{headers:{Origin:"http://localhost:3103","X-Workout-Owner":owner},data:{}})).status()).toBe(409);
});

test("a same-day body append after food history survives invalid tool fields and needs no model turn after validation",async({page})=>{
  await login(page);await enable(page);
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles"}).format(new Date());
  for(const entry of [{kind:"body",date,weightKg:72.5,waistCm:null},{kind:"food",date,foodName:"牛肉面",mealType:"lunch",calories:null,protein:null}]){
    const saved=await page.request.post("/api/personal-records",{headers:{Origin:"http://localhost:3103"},data:{action:"create",id:randomUUID(),entry,source:"manual",text:"",anchorDate:date}});expect(saved.status()).toBe(200);
  }
  await send(page,"我午餐都吃了什么");
  await send(page,"现在称到七十三点一公斤，腰围仍没量，帮我追加一条今天的数据 [oral-append]");
  await expect(page.getByTestId("personal-draft")).toContainText("73.1 kg");await expect(page.getByTestId("personal-draft")).toContainText("— cm");
  await expect(page.getByTestId("coach-turn").last()).toContainText("目前尚未写入记录");expect((await entries(page)).length).toBe(2);
  await page.getByRole("button",{name:"确认补录",exact:true}).click();await expect.poll(async()=>(await entries(page)).length).toBe(3);
  const after=await entries(page);expect(after.filter((r:{entry:{kind:string}})=>r.entry.kind==="food")).toHaveLength(1);
  expect(after.some((r:{entry:{weightKg:number;waistCm:null}})=>r.entry.weightKg===73.1&&r.entry.waistCm===null)).toBe(true);
});

test("untrusted model numbers, provider failure, cancellation and missing consent never write",async({page})=>{
  expect((await page.request.post("/api/ai/coach",{headers:{Origin:"http://localhost:3103"},data:{}})).status()).toBe(401);
  await login(page);expect((await page.request.post("/api/ai/coach",{headers:{Origin:"http://localhost:3103"},data:{id:randomUUID(),text:"hi",history:[],locale:"zh",timezone:"UTC"}})).status()).toBe(400);
  await enable(page);await send(page,"帮我记体重 [invent]");await expect(page.getByTestId("personal-draft")).toHaveCount(0);expect(await entries(page)).toEqual([]);
  const priorTarget=await page.request.post("/api/ai/coach",{headers:{Origin:"http://localhost:3103"},data:{id:randomUUID(),text:"帮我记体重 [invent]",history:[{role:"user",content:"我的目标是82公斤"}],locale:"zh",timezone:"UTC",consent:"coach-model-v1"}});
  expect(priorTarget.status()).toBe(200);expect((await priorTarget.json()).proposal).toBeUndefined();expect(await entries(page)).toEqual([]);
  await send(page,"你好 [provider-down]");await expect(page.getByTestId("coach-turn").last()).toContainText("暂时不可用");
  await page.getByLabel("发给训练助手",{exact:true}).fill("你好 [slow]");await page.getByRole("button",{name:"发送",exact:true}).click();
  await page.getByRole("button",{name:"停止",exact:true}).click();await expect(page.getByTestId("coach-turn").last()).toContainText("已停止");
  expect(await entries(page)).toEqual([]);
  expect((await page.request.post("/api/ai/coach",{headers:{Origin:"https://untrusted.example"},data:{}})).status()).toBe(403);
});

test("natural workout report uses the existing versioned queue and preserves source and nulls",async({page})=>{
  const plan=randomUUID(),day=randomUUID(),e=randomUUID();
  await db.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'Model test',true)",[plan,owner]);
  await db.query("insert into training_plan_weeks values($1,$2,1)",[plan+'w',plan]);await db.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'模型训练')",[day,plan+'w']);
  await db.query("insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'深蹲',3,'8-12',7)",[e,day]);
  try{
    await login(page);await send(page,"开始训练");
    await page.getByTestId("start-session-panel").locator("select").selectOption(day);
    await page.getByRole("button",{name:"开始训练",exact:true}).click();await expect(page.getByLabel("当前动作（可选）")).toBeVisible();await expect(page.getByTestId("outbox-status")).toHaveText("已同步");await enable(page);
    await send(page,"刚才那组深蹲我实打实做了八次，用的是五十公斤，帮我记上");await expect(page.getByTestId("coach-draft")).toContainText("50 kg × 8 · RPE —");
    expect((await db.query("select * from set_logs where user_id=$1",[owner])).rowCount).toBe(0);
    await page.getByTestId("coach-draft").getByRole("button",{name:"确认保存这句话"}).click();await expect(page.getByTestId("coach-draft")).toHaveCount(0);
    await expect.poll(async()=>(await db.query("select reps from set_logs where user_id=$1",[owner])).rows.map(r=>r.reps)).toEqual([8]);
    const row=(await db.query("select receipt from workout_commands where user_id=$1 order by created_at desc limit 1",[owner])).rows[0].receipt;
    expect(row.text).toContain("实打实");expect(row.model).toBeTruthy();expect(row.changes[0].after.rpe).toBe(null);
    const reply=page.waitForRequest(r=>r.url().includes("/api/ai/coach")&&r.method()==="POST");
    await send(page,"看看本次实际训练 [current-read]");
    // Chromium does not retain no-store streaming bodies for CDP inspection.
    // Check the same read through JSON compatibility, plus its streamed UI below.
    const response=await(await page.request.post("/api/ai/coach",{headers:{Origin:"http://localhost:3103"},data:{...(await reply).postDataJSON(),id:randomUUID()}})).json();
    expect(response.sources).toHaveLength(1);expect(response.sources[0].summary.completedSessions).toBe(0);
    expect(response.sources[0].rows[0].actualSets).toEqual([{exercise:"深蹲",setIndex:1,reps:8,weightKg:50,rpe:null}]);
    await page.getByTestId("coach-sources").last().locator("summary").click();
    await expect(page.getByTestId("coach-sources").last()).toContainText("仅本次训练");await expect(page.getByTestId("coach-sources").last()).toContainText("RPE: —");
    await page.getByRole("log").evaluate(e=>{e.scrollTop=e.scrollHeight;});
    await page.screenshot({path:"node_modules/.cache/coach-model/workout-model.png",fullPage:true});
  }finally{await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2",[owner,plan]);await db.query("delete from training_plans where id=$1",[plan]);}
});

test("a failed source read is not empty history; persistent quota returns an explicit limit",async({page})=>{
  await login(page);await enable(page);
  await db.query("revoke select on food_logs from liftcut_workout");
  try{await send(page,"我午餐都吃了什么");await expect(page.getByTestId("coach-turn").last()).toContainText("读取失败不代表没有记录");await expect(page.getByTestId("coach-sources")).toHaveCount(0);}
  finally{await db.query("grant select on food_logs to liftcut_workout");}
  await db.query("insert into coach_request_usage(id,user_id) select gen_random_uuid(),$1 from generate_series(1,6)",[owner]);
  await send(page,"你好呀，今天有什么建议");await expect(page.getByTestId("coach-turn").last()).toContainText("次数已达上限");expect(await entries(page)).toEqual([]);
});
