import {test,expect,type Page} from "@playwright/test";
import {Pool} from "pg";
import {randomUUID} from "node:crypto";
import {COACH_CONSENT_VERSION} from "../../src/lib/coach-model";
// The review answer comes from the scripted model fixture (never real-model evidence); the ledger, routes and PostgreSQL writes are real.
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL}),owner="11111111-1111-4111-8111-111111111111";
async function login(page:Page){
  await page.goto("/login");await page.locator("#email").fill("p1-fixture@example.invalid");await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/\/(?:onboarding)?$/);await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();
  await expect(page.getByLabel("发给训练助手",{exact:true})).toBeEnabled();await page.getByRole("button",{name:"同意并开启",exact:true}).click();
}
async function planThroughLedger(page:Page){
  await page.getByLabel("发给训练助手",{exact:true}).fill("生成训练计划 [training-plan]");await page.getByRole("button",{name:"发送",exact:true}).click();
  await page.getByRole("button",{name:"查看方案",exact:true}).click();await page.getByRole("button",{name:"确认并应用",exact:true}).click();
  await expect(page.getByTestId("plan-receipt")).toBeVisible();
}
async function finishSquats(page:Page){
  await page.goto("/today");await page.getByRole("button",{name:"开始训练",exact:true}).click();
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  const session=(await db.query("select prescription from workout_sessions where user_id=$1 and status='active'",[owner])).rows[0];
  const squat=session.prescription.exercises.find((e:{name:string})=>e.name==="深蹲").id;
  for(const n of [1,2,3]){
    const row=page.getByTestId(`set-${squat}-${n}`);
    await row.getByLabel("重量 (kg)").fill("60");await row.getByLabel("次数").fill("10");await row.getByRole("button",{name:"完成",exact:true}).click();
    await expect(row).toContainText("已完成");await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  }
  await page.getByRole("button",{name:"结束训练",exact:true}).click();await expect(page.getByTestId("workout-review")).toBeVisible();
}
const squatNow=async()=>(await db.query(`select e.sets,e.target_rpe::float as rpe from training_plan_exercises e join training_plan_days d on d.id=e.day_id
  join training_plan_weeks w on w.id=d.week_id join training_plans p on p.id=w.training_plan_id where p.user_id=$1 and p.is_active and d.day_number=1 and e.name='深蹲'`,[owner])).rows;
/** Another device applies a full review of the same workout through the same routes, so the plan changes inside the ledger. */
async function applyElsewhere(page:Page){
  const post=async(url:string,data:unknown)=>(await page.request.post(url,{headers:{Origin:"http://localhost:3103"},data})).json();
  const sessionId=(await db.query("select id from workout_sessions where user_id=$1 and status='ended'",[owner])).rows[0].id;
  let run=(await post("/api/workout-review",{sessionId,requestKey:randomUUID(),consent:COACH_CONSENT_VERSION,locale:"zh",timezone:"UTC"})).run;
  const binding={proposalId:run.proposal.proposalId,contentHash:run.proposal.contentHash,contextRevision:run.proposal.contextRevision};
  run=(await post(`/api/agent/runs/${run.id}/user-events`,{action:"approve",expectedRevision:run.revision,binding})).value;
  expect((await post(`/api/agent/runs/${run.id}/execute`,{binding,approvalId:run.approvalId,idempotencyKey:binding.proposalId})).ok).toBe(true);
}
const runs=async()=>(await db.query("select status,count(*)::int n from agent_private.runs where user_id=$1 group by status order by status",[owner])).rows;
test.beforeEach(async()=>{await db.query("delete from coach_request_usage where user_id=$1",[owner]);});
test.afterEach(async()=>{
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id like 'agent-%'",[owner]);
  await db.query("update agent_private.runs set current_proposal=null where user_id=$1",[owner]);
  for(const table of ["receipts","execution_keys","events","proposals","runs"])await db.query(`delete from agent_private.${table} where user_id=$1`,[owner]);
  await db.query("delete from training_plans where user_id=$1 and id like 'agent-%'",[owner]);
  await db.query("delete from coach_request_usage where user_id=$1",[owner]);
});
test.afterAll(async()=>{await db.end();});

test("a review is accepted one change at a time, applied once, survives a reload and rolls back through the ledger",async({page})=>{
  await login(page);await planThroughLedger(page);await finishSquats(page);
  const card=page.getByTestId("workout-review");
  await card.getByRole("button",{name:"复盘这次训练",exact:true}).click();
  await expect(card.getByRole("checkbox")).toHaveCount(2);
  await expect(card).toContainText("深蹲：每次加 1 组");await expect(card).toContainText("深蹲：目标 RPE 提高 0.5");await expect(card).toContainText("依据 3 组记录");
  expect(await squatNow()).toEqual([{sets:3,rpe:7}]); // A suggestion changes nothing.
  await card.getByRole("checkbox").nth(1).uncheck();
  await page.screenshot({path:"node_modules/.cache/w1b/review-mobile.png",fullPage:true});
  await card.getByRole("button",{name:"应用所选（1 项）",exact:true}).dblclick();
  await expect(card.getByRole("status")).toHaveText("已应用到训练计划。");
  expect(await squatNow()).toEqual([{sets:4,rpe:7}]);
  // The plan's own preview and applied runs are kept beside the review's declined and applied ones: nothing was applied twice.
  expect(await runs()).toEqual([{status:"applied",n:2},{status:"declined",n:1}]);

  await page.reload();await expect(card.getByRole("status")).toHaveText("已应用到训练计划。");await expect(card).toContainText("深蹲：每次加 1 组");
  await card.getByRole("button",{name:"撤销这些修改",exact:true}).click();
  await expect(card.getByRole("status")).toHaveText("已撤销，计划恢复到复盘前。");
  expect(await squatNow()).toEqual([{sets:3,rpe:7}]);
  expect(await runs()).toEqual([{status:"applied",n:3},{status:"declined",n:1}]);
  await page.screenshot({path:"node_modules/.cache/w1b/review-undone-mobile.png",fullPage:true});
});

test("a review whose plan changed afterwards is not applied and can be redone on the new plan",async({page})=>{
  await login(page);await planThroughLedger(page);await finishSquats(page);
  const card=page.getByTestId("workout-review");
  await card.getByRole("button",{name:"复盘这次训练",exact:true}).click();await expect(card.getByRole("checkbox")).toHaveCount(2);
  await applyElsewhere(page);expect(await squatNow()).toEqual([{sets:4,rpe:7.5}]);
  await card.getByRole("checkbox").nth(1).uncheck();await card.getByRole("button",{name:"应用所选（1 项）",exact:true}).click();
  await expect(card.getByRole("alert")).toHaveText("复盘之后计划有变化，这条复盘已失效，可以重新复盘。");
  expect(await squatNow()).toEqual([{sets:4,rpe:7.5}]);
  await card.getByRole("button",{name:"重新复盘",exact:true}).click();await expect(card.getByRole("checkbox")).toHaveCount(2);
  await card.getByRole("button",{name:"应用所选（2 项）",exact:true}).click();await expect(card.getByRole("status")).toHaveText("已应用到训练计划。");
  expect(await squatNow()).toEqual([{sets:5,rpe:8}]);
});
