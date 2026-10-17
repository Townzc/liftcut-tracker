import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {AgentStore} from "../../src/services/agent/store";
import {PersonalRecordStore} from "../../src/services/today/personal-record-store";
import {planPersonalization} from "../../src/lib/agent/plan-personalization";
import type {PersonalEntry} from "../../src/lib/personal-records";
import type {Outcome,RunView} from "../../src/lib/agent/contracts";
import {trainingFixture,nutritionFixture,planContextFixture as context} from "../fixtures/coach-plans";
import {testUrl} from "./today-setup";
const value=<T>(r:Outcome<T>):T=>{assert.equal(r.ok,true,JSON.stringify(r));return (r as {ok:true;value:T}).value;};
const binding=(r:RunView)=>({proposalId:r.proposal!.proposalId,contentHash:r.proposal!.contentHash,contextRevision:r.proposal!.contextRevision});

test("plans use durable dated memory and bind confirmation to its fresh contents",async t=>{
  const admin=new Pool({connectionString:testUrl()}),url=new URL(testUrl());url.username="liftcut_agent";url.password="p1-local-fixture-only";
  const pool=new Pool({connectionString:url.toString(),max:5}),store=new AgentStore(pool);url.username="liftcut_workout";url.password="w1b-local-fixture-only";
  const recordsPool=new Pool({connectionString:url.toString(),max:5}),records=new PersonalRecordStore(recordsPool),owner=randomUUID(),other=randomUUID();
  const save=(entry:PersonalEntry,user=owner)=>records.command(user,{action:"create",id:randomUUID(),entry,source:"manual",text:"",anchorDate:entry.date});
  const approve=async(r:RunView)=>value(await store.userEvent(owner,r.id,{action:"approve",expectedRevision:r.revision,binding:binding(r)}));
  const execute=(r:RunView)=>store.execute(owner,r.id,{binding:binding(r),approvalId:r.approvalId!,idempotencyKey:r.proposal!.proposalId});
  const draft=async(kind:"training"|"nutrition"="training")=>value(await store.prepare(owner,randomUUID(),await store.planContext(owner,kind),context,kind==="training"?trainingFixture:nutritionFixture));
  try{
    await admin.query("insert into auth.users values($1),($2)",[owner,other]);
    await admin.query("insert into user_settings(user_id,fitness_goal,current_weight,weekly_training_days,session_duration_minutes) values($1,'fat_loss',90,2,45),($2,'maintenance',80,2,45)",[owner,other]);
    const goal=await save({kind:"preference",date:"2026-08-17",key:"goal",value:"增肌"});
    await save({kind:"body",date:"2026-08-17",weightKg:72.5,waistCm:80});
    await save({kind:"body",date:"2026-09-17",weightKg:73,waistCm:null});
    for(const [date,weight] of [["2026-08-17",45],["2026-09-01",47.5],["2026-09-17",50]] as const)
      await save({kind:"exercise",date,exerciseName:"卧推",weightKg:weight,reps:10,sets:null,rpe:null});
    await save({kind:"body",date:"2026-09-17",weightKg:199,waistCm:100},other);
    await t.test("independent latest body values and three dated loads survive fresh context with account isolation",async()=>{
      const snapshot=await store.planContext(owner,"training"),m=snapshot.memory!,p=planPersonalization(snapshot.profile,m);
      assert.equal(p.profileContext.weight.value,73);assert.equal(p.body.find(f=>f.metric==="waist")?.value,80);
      assert.equal(p.goal.value,"增肌");assert.deepEqual(m.recentLoads.map(f=>f.value),[50,47.5,45]);
      assert.ok(m.recentLoads.every(f=>f.rpe===null&&f.sets===null));assert.ok(!JSON.stringify(m).includes("199"));
      assert.equal((await store.planContext(other,"training")).memory!.recentLoads.length,0);
      assert.equal((await admin.query("select count(*)::int n from training_plans where user_id=$1",[owner])).rows[0].n,0);
    });
    await t.test("fresh plan preview retains a server-generated basis without saving actuals",async()=>{
      const run=await draft();const basis=run.events.find(e=>e.type==="planning_basis")!.data as {memory:{facts:unknown[]}};
      assert.ok(basis.memory.facts.length>=4);assert.equal(run.status,"awaiting_approval");
      assert.equal((await records.list(owner)).length,6);
    });
    await t.test("changed measurement between reading and drafting refuses the old snapshot",async()=>{
      const snapshot=await store.planContext(owner,"training");await save({kind:"body",date:"2026-10-16",weightKg:74,waistCm:null});
      assert.deepEqual(await store.prepare(owner,randomUUID(),snapshot,context,trainingFixture),{ok:false,error:"CONTEXT_STALE",retryable:false});
    });
    await t.test("undoing a preference invalidates both kinds of pending previews",async()=>{
      const training=await draft(),nutrition=await draft("nutrition");
      await records.command(owner,{action:"undo",id:randomUUID(),recordId:goal.id});
      for(const r of [training,nutrition]){const result=value(await store.get(owner,r.id));assert.equal(result.status,"stale");assert.ok(result.events.some(e=>e.type==="memory_changed"));}
      assert.equal(planPersonalization((await store.planContext(owner,"nutrition")).profile,(await store.planContext(owner,"nutrition")).memory!).goal.source,"settings");
    });
    await t.test("unrelated food and other-account changes do not stale a plan",async()=>{
      const run=await draft();await save({kind:"food",date:"2026-10-16",foodName:"合成午餐",mealType:"lunch",calories:null,protein:null});
      await save({kind:"body",date:"2026-10-16",weightKg:198,waistCm:null},other);
      assert.equal(value(await store.get(owner,run.id)).status,"awaiting_approval");
    });
    await t.test("a concurrent fact write is serialized before execution, which rejects the stale approval",async()=>{
      const run=await approve(await draft()),client=await recordsPool.connect(),entry={kind:"body",date:"2026-10-16",weightKg:75,waistCm:null};
      let pending:Promise<Outcome<unknown>>|undefined;
      try{
        await client.query("begin");await client.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
        const id=randomUUID();await client.query("insert into personal_record_events(id,user_id,request_hash,request,receipt) values($1,$2,$3,$4,$5)",[id,owner,"a".repeat(64),{action:"create",id,entry,source:"manual",text:"",anchorDate:entry.date},{id,recordId:id,action:"create"}]);
        const locked=await pool.connect();try{await locked.query("begin");assert.equal((await locked.query("select pg_try_advisory_xact_lock(hashtextextended($1,713)) ok",[owner])).rows[0].ok,false);await locked.query("rollback");}finally{locked.release();}
        pending=execute(run);await client.query("commit");assert.deepEqual(await pending,{ok:false,error:"CONTEXT_STALE",retryable:false});
        assert.equal((await admin.query("select count(*)::int n from training_plans where user_id=$1",[owner])).rows[0].n,0);
      }finally{await client.query("rollback").catch(()=>{});await pending?.catch(()=>{});client.release();}
    });
    await t.test("fresh approval applies once and historical receipts survive later memory changes",async()=>{
      const run=await approve(await draft()),receipt=value(await execute(run));await save({kind:"body",date:"2026-10-16",weightKg:76,waistCm:null});
      assert.deepEqual(value(await execute(run)),receipt);assert.equal(value(await store.get(owner,run.id)).status,"applied");
      assert.equal((await admin.query("select count(*)::int n from training_plans where user_id=$1",[owner])).rows[0].n,1);
    });
    await t.test("plan role remains read-only and RLS-bound for actual records",async()=>{
      const client=await pool.connect();try{await client.query("begin");await client.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
        assert.equal((await client.query("select count(*)::int n from personal_record_events where user_id=$1",[other])).rows[0].n,0);
        await assert.rejects(client.query("delete from personal_record_events where user_id=$1",[owner]),{code:"42501"});
      }finally{await client.query("rollback");client.release();}
    });
    await t.test("large histories bound model context while preserving body values and marking truncation",async()=>{
      for(let i=0;i<22;i++)await save({kind:"exercise",date:"2026-10-16",exerciseName:`合成动作${i}`,weightKg:10+i,reps:8,sets:null,rpe:null});
      const training=(await store.planContext(owner,"training")).memory!,nutrition=(await store.planContext(owner,"nutrition")).memory!;
      assert.equal(training.facts.filter(f=>f.exerciseName).length,20);assert.equal(nutrition.facts.filter(f=>f.exerciseName).length,6);
      assert.equal(training.truncated,true);assert.equal(nutrition.truncated,true);
      assert.equal(training.facts.find(f=>f.metric==="waist")?.value,80);assert.ok(training.recentLoads.length<=60);
    });
  }finally{
    await admin.query("update agent_private.runs set current_proposal=null where user_id=any($1)",[[owner,other]]);
    for(const table of ["receipts","execution_keys","events","proposals","runs"])await admin.query(`delete from agent_private.${table} where user_id=any($1)`,[[owner,other]]);
    await admin.query("delete from auth.users where id=any($1)",[[owner,other]]);await recordsPool.end();await pool.end();await admin.end();
  }
});
