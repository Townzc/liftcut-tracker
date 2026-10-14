import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {AgentStore} from "../../src/services/agent/store";
import {CoachStore} from "../../src/services/ai/coach-store";
import type {Outcome,RunView} from "../../src/lib/agent/contracts";
import {trainingFixture,nutritionFixture,planContextFixture as context} from "../fixtures/coach-plans";
import {testUrl} from "./today-setup";

const value=<T>(r:Outcome<T>):T=>{assert.equal(r.ok,true,JSON.stringify(r));return (r as {ok:true;value:T}).value;};
const binding=(r:RunView)=>({proposalId:r.proposal!.proposalId,contentHash:r.proposal!.contentHash,contextRevision:r.proposal!.contextRevision});
test("conversational plans use the approval ledger for both kinds",async t=>{
  const admin=new Pool({connectionString:testUrl()}),url=new URL(testUrl());url.username="liftcut_agent";url.password="p1-local-fixture-only";
  const pool=new Pool({connectionString:url.toString(),max:6}),store=new AgentStore(pool),owner=randomUUID(),other=randomUUID();
  const training=()=>admin.query("select * from training_plans where user_id=$1 order by created_at",[owner]);
  const nutrition=()=>admin.query("select * from nutrition_plans where user_id=$1 order by created_at",[owner]);
  const approve=async(r:RunView)=>value(await store.userEvent(owner,r.id,{action:"approve",expectedRevision:r.revision,binding:binding(r)}));
  const execute=(r:RunView)=>store.execute(owner,r.id,{binding:binding(r),approvalId:r.approvalId!,idempotencyKey:r.proposal!.proposalId});
  let run:RunView;
  try{
    await admin.query("insert into auth.users values($1),($2)",[owner,other]);
    await admin.query("insert into user_settings(user_id,weekly_training_days,session_duration_minutes) values($1,2,45),($2,2,45)",[owner,other]);
    await t.test("plan writes retain owner locks with hosted auth schema restrictions and both JWT formats",async()=>{
      assert.equal((await admin.query("select has_schema_privilege('liftcut_agent','auth','usage') allowed")).rows[0].allowed,false);
      const client=await pool.connect(),contender=await pool.connect();
      try{
        for(const format of ["subject","claims"]){
          await client.query("begin");await contender.query("begin");
          try{
            await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
              [format==="subject"?owner:"",format==="claims"?JSON.stringify({sub:owner}):""]);
            await client.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'Rollback fixture',true)",[randomUUID(),owner]);
            assert.equal((await contender.query("select pg_try_advisory_xact_lock(hashtextextended($1,713)) acquired",[owner])).rows[0].acquired,false);
            assert.equal((await contender.query("select pg_try_advisory_xact_lock(hashtextextended($1,713)) acquired",[other])).rows[0].acquired,true);
            await assert.rejects(client.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'Other owner',true)",[randomUUID(),other]),{code:"42501"});
          }finally{await client.query("rollback");await contender.query("rollback");}
        }
        assert.equal((await training()).rowCount,0);
      }finally{client.release();contender.release();}
    });
    await t.test("generation, idempotent publication, constraint rejection and zero business writes",async()=>{
      const snapshot=await store.planContext(owner,"training"),id=randomUUID();
      run=value(await store.prepare(owner,id,snapshot,context,trainingFixture));
      assert.deepEqual(value(await store.prepare(owner,id,snapshot,context,trainingFixture)),run);
      assert.equal((await training()).rowCount,0);assert.equal(run.status,"awaiting_approval");
      assert.equal((await store.prepare(owner,randomUUID(),snapshot,{...context,weeklyDays:1},trainingFixture)).ok,false);
      assert.equal((await store.execute(owner,run.id,{binding:binding(run),approvalId:randomUUID(),idempotencyKey:randomUUID()})).ok,false);
    });
    await t.test("owner isolation and proposal kind validation",async()=>{
      assert.equal((await store.get(other,run.id)).ok,false);
      assert.equal((await store.userEvent(other,run.id,{action:"approve",expectedRevision:run.revision,binding:binding(run)})).ok,false);
      assert.equal((await store.planContext(other,"training",run.id)).draft,undefined);
      assert.deepEqual(value(await store.recent(other)),[]);
      assert.equal((await store.publish(owner,run.id,{expectedRevision:run.revision,plan:nutritionFixture})).ok,false);
    });
    await t.test("double execution and replay produce one plan and the same receipt",async()=>{
      run=await approve(value(await store.get(owner,run.id)));
      const receipts=await Promise.all([execute(run),execute(run)]);assert.deepEqual(value(receipts[0]),value(receipts[1]));
      assert.equal((await training()).rowCount,1);assert.equal(value(await store.get(owner,run.id)).status,"applied");
      assert.equal((await admin.query("select count(*)::int n from set_logs where user_id=$1",[owner])).rows[0].n,0);
    });
    await t.test("editing an unapproved preview supersedes and invalidates its old approval",async()=>{
      const a=value(await store.prepare(owner,randomUUID(),await store.planContext(owner,"training"),context,trainingFixture));
      const approved=await approve(a),snapshot=await store.planContext(owner,"training",a.id);
      const adjusted=structuredClone(trainingFixture);adjusted.weeks[0].days[0].exercises[0].sets=2;
      run=value(await store.prepare(owner,randomUUID(),snapshot,context,adjusted));
      assert.equal(value(await store.get(owner,a.id)).status,"declined");assert.equal((await execute(approved)).ok,false);
      assert.equal((await training()).rowCount,1);
      assert.equal(value(await store.get(owner,run.id)).proposal?.plan.plan_name,adjusted.plan_name);
    });
    await t.test("a legacy descendant edit invalidates the old snapshot and pending preview",async()=>{
      const snapshot=await store.planContext(owner,"training"),client=await admin.connect();
      try{await client.query("begin");await client.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
        await client.query("update training_plan_exercises set sets=4 where id like $1",[(await training()).rows[0].id+"-w1-d1-e1"]);await client.query("commit");
      }finally{client.release();}
      assert.equal(value(await store.get(owner,run.id)).status,"stale");
      assert.equal((await store.prepare(owner,randomUUID(),snapshot,context,trainingFixture)).ok,false);
    });
    await t.test("nutrition approval is atomic and leaves training and actual intake unchanged",async()=>{
      run=value(await store.prepare(owner,randomUUID(),await store.planContext(owner,"nutrition"),context,nutritionFixture));
      assert.equal((await nutrition()).rowCount,0);run=await approve(run);const receipt=value(await execute(run));
      assert.equal(receipt.kind,"nutrition");assert.equal((await nutrition()).rows[0].daily_calorie_target,2000);
      assert.equal((await training()).rowCount,1);
      assert.equal((await admin.query("select count(*)::int n from personal_record_events where user_id=$1",[owner])).rows[0].n,0);
      const u=new URL(testUrl());u.username="liftcut_workout";u.password="w1b-local-fixture-only";const reads=new Pool({connectionString:u.toString()});
      try{const source=await new CoachStore(reads).read(owner,{topic:"nutrition",from:"2026-10-14",to:"2026-10-14"},"2026-10-14");assert.equal(source.rows.length,3);assert.equal(source.rows[0].actual,false);}finally{await reads.end();}
    });
    await t.test("failed nutrition replacement rolls back activation and can retry the same intent",async()=>{
      const plan={...nutritionFixture,plan_name:"Reject synthetic"};
      run=await approve(value(await store.prepare(owner,randomUUID(),await store.planContext(owner,"nutrition"),context,plan)));
      await admin.query("alter table nutrition_plans add constraint synthetic_reject check(name<>'Reject synthetic')");
      try{assert.equal((await execute(run)).ok,false);assert.equal((await nutrition()).rowCount,1);assert.equal((await nutrition()).rows[0].is_active,true);}
      finally{await admin.query("alter table nutrition_plans drop constraint synthetic_reject");}
      value(await execute(run));const plans=(await nutrition()).rows;assert.equal(plans.length,2);assert.equal(plans.filter(p=>p.is_active).length,1);
      assert.equal(plans.find(p=>p.is_active).name,"Reject synthetic");
    });
    await t.test("new current-plan activation makes competing previews stale; receipt replay remains historical",async()=>{
      const snapshot=await store.planContext(owner,"nutrition");
      const first=await approve(value(await store.prepare(owner,randomUUID(),snapshot,context,nutritionFixture)));
      const second=await approve(value(await store.prepare(owner,randomUUID(),snapshot,context,{...nutritionFixture,plan_name:"Another"})));
      const receipt=value(await execute(first));assert.equal((await execute(second)).ok,false);assert.equal(value(await store.get(owner,second.id)).status,"stale");
      assert.deepEqual(value(await execute(first)),receipt);
    });
    await t.test("changed settings invalidate pending plans; browser roles cannot access ledger",async()=>{
      run=value(await store.prepare(owner,randomUUID(),await store.planContext(owner,"training"),context,trainingFixture));
      await admin.query("update user_settings set weekly_training_days=3 where user_id=$1",[owner]);assert.equal(value(await store.get(owner,run.id)).status,"stale");
      const rights=(await admin.query("select has_schema_privilege('authenticated','agent_private','usage') a,has_function_privilege('authenticated','agent_private.serialize_plan_write()','execute') f")).rows[0];assert.deepEqual(rights,{a:false,f:false});
    });
  }finally{
    await admin.query("update agent_private.runs set current_proposal=null where user_id=any($1::uuid[])",[[owner,other]]);
    for(const table of ["receipts","execution_keys","events","proposals","runs"])await admin.query(`delete from agent_private.${table} where user_id=any($1::uuid[])`,[[owner,other]]);
    await admin.query("delete from auth.users where id=any($1::uuid[])",[[owner,other]]);await pool.end();await admin.end();
  }
});
