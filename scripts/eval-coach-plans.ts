/** Opt-in real provider evaluation, synthetic local database only. */
import assert from "node:assert/strict";
import {loadEnvFile} from "node:process";
import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {Pool} from "pg";
import {runCoach} from "../src/services/ai/coach-agent";
import {AgentStore} from "../src/services/agent/store";
import {COACH_CONSENT_VERSION,type CoachMessage,type CoachResponse} from "../src/lib/coach-model";
import {isNutritionPlan,type RunView,type Outcome} from "../src/lib/agent/contracts";
const unwrap=<T>(r:Outcome<T>):T=>{assert.ok(r.ok,JSON.stringify(r));return (r as {ok:true;value:T}).value;};
async function main(){
  if(process.env.COACH_LIVE_EVAL!=="true")throw new Error("Opt in with COACH_LIVE_EVAL=true");
  const url=process.env.W1B_TEST_DATABASE_URL;
  if(!url||!["localhost","127.0.0.1"].includes(new URL(url).hostname)||!new URL(url).pathname.startsWith("/liftcut_p1_w1b_"))throw new Error("Local synthetic database required");
  loadEnvFile(".env.local");const runtime=new URL(url);runtime.username="liftcut_workout";runtime.password="w1b-local-fixture-only";process.env.WORKOUT_DATABASE_URL=runtime.toString();
  runtime.username="liftcut_agent";runtime.password="p1-local-fixture-only";process.env.AGENT_DATABASE_URL=runtime.toString();process.env.FEATURE_TODAY_SESSION="true";process.env.COACH_SIGNING_SECRET="local-plan-evaluation-only-not-production";
  const db=new Pool({connectionString:url}),pool=new Pool({connectionString:runtime.toString()}),store=new AgentStore(pool),users:string[]=[],observations:unknown[]=[];
  const directory=`node_modules/.cache/coach-plans-live/${new Date().toISOString().replace(/[:.]/g,"-")}`;await mkdir(directory,{recursive:true});
  const proposal=(response:CoachResponse)=>{assert.equal(response.proposal?.kind,"plan",response.message);if(response.proposal?.kind!=="plan")throw new Error("Missing plan");return response.proposal.run;};
  async function user(){const id=randomUUID();users.push(id);await db.query("insert into auth.users values($1)",[id]);await db.query(`insert into user_settings(user_id,fitness_goal,weekly_training_days,session_duration_minutes,available_equipment,training_experience,age,height,current_weight,calorie_target,protein_target,food_restrictions)
    values($1,'maintenance',2,45,'{哑铃,自重}','beginner',30,175,70,2000,120,'无食物过敏，不吃花生')`,[id]);return id;}
  async function ask(owner:string,text:string,run?:RunView,history:CoachMessage[]=[]){const start=Date.now();let trace:unknown;
    const result=await runCoach(owner,{id:randomUUID(),text,history,locale:"zh",timezone:"America/Los_Angeles",consent:COACH_CONSENT_VERSION,...(run?{planRunId:run.id}:{})},AbortSignal.timeout(50000),async steps=>{trace=steps;});
    observations.push({text,latencyMs:Date.now()-start,response:result,trace});await writeFile(`${directory}/observations.json`,JSON.stringify(observations,null,2));return result;
  }
  async function apply(owner:string,run:RunView){const binding={proposalId:run.proposal!.proposalId,contentHash:run.proposal!.contentHash,contextRevision:run.proposal!.contextRevision};
    const approved=unwrap(await store.userEvent(owner,run.id,{action:"approve",expectedRevision:run.revision,binding}));return unwrap(await store.execute(owner,run.id,{binding,approvalId:approved.approvalId!,idempotencyKey:binding.proposalId}));}
  try{
    const a=await user();
    let run=proposal(await ask(a,"根据我的设置生成一周可重复的训练计划，每周两天、每次不超过45分钟，每天只安排两个动作，用哑铃和自重。先给预览。"));
    assert.equal((await db.query("select count(*)::int n from training_plans where user_id=$1",[a])).rows[0].n,0);
    const original=run.proposal!.plan;assert.ok(!isNutritionPlan(original));assert.equal(original.weeks[0].days.length,2);
    const first=original.weeks[0].days[0].exercises[0],changed=first.sets===2?3:2;
    run=proposal(await ask(a,`只把刚才草稿第1周第1天的第1个动作「${first.name}」改成${changed}组，其他内容全部保留。`,run));
    const revised=run.proposal!.plan;assert.ok(!isNutritionPlan(revised));const expected=structuredClone(original);expected.weeks[0].days[0].exercises[0].sets=changed;
    assert.deepEqual(revised.weeks,expected.weeks);await apply(a,run);
    run=proposal(await ask(a,`现在把已应用的计划第1周第1天第1个动作「${first.name}」的休息时间改成120秒，其他不动。`,run));
    const adjusted=run.proposal!.plan;assert.ok(!isNutritionPlan(adjusted));expected.weeks[0].days[0].exercises[0].rest_seconds=120;assert.deepEqual(adjusted.weeks,expected.weeks);
    const n=await user();let diet=proposal(await ask(n,"按我设置的2000千卡、120克蛋白质目标，生成一天的早午晚三餐参考饮食计划，食材常见，不吃花生，先给预览。"));
    assert.ok(isNutritionPlan(diet.proposal!.plan));const menu=diet.proposal!.plan;
    diet=proposal(await ask(n,"仅把刚才饮食草稿的每日饮水目标改成2800毫升，食物和其他营养目标都保持原样。",diet));
    const revisedDiet=diet.proposal!.plan;assert.ok(isNutritionPlan(revisedDiet));assert.deepEqual(revisedDiet.days,menu.days);assert.deepEqual(revisedDiet.daily_targets,{...menu.daily_targets,water_ml:2800});await apply(n,diet);
    diet=proposal(await ask(n,"把当前饮食计划的每日饮水目标改为3000毫升，其他完全不变。",diet));assert.ok(isNutritionPlan(diet.proposal!.plan));assert.equal(diet.proposal!.plan.daily_targets.water_ml,3000);
    const q=await ask(a,"请同时查一下我最近的体重和实际饮食记录，没记录就说明没记录。不要把计划当成吃过了。");assert.equal(q.proposal,undefined);assert.ok(q.sources.some(s=>s.topic==="body"));assert.ok(q.sources.some(s=>s.topic==="food"));
    const b=await user();await db.query("update user_settings set weekly_training_days=0,session_duration_minutes=0,available_equipment='{}' where user_id=$1",[b]);
    const clarify=await ask(b,"帮我安排一个合适的训练计划吧");assert.equal(clarify.proposal,undefined);
    await writeFile(`${directory}/result.json`,JSON.stringify({status:"PASS",calls:observations.length,at:new Date().toISOString(),scope:"Real model with synthetic local PostgreSQL; not hosted/browser evidence"},null,2));
    console.log("LIVE_PLAN_PASS",directory,observations.length);
  }catch(e){await writeFile(`${directory}/failure.json`,JSON.stringify({at:new Date().toISOString(),error:e instanceof Error?e.message:"unknown",calls:observations.length},null,2));throw e;}
  finally{
    await db.query("update agent_private.runs set current_proposal=null where user_id=any($1::uuid[])",[users]);for(const table of ["receipts","execution_keys","events","proposals","runs"])await db.query(`delete from agent_private.${table} where user_id=any($1::uuid[])`,[users]);
    await db.query("delete from auth.users where id=any($1::uuid[])",[users]);await pool.end();await db.end();
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e instanceof Error?e.message:"Evaluation failed");process.exit(1);});
