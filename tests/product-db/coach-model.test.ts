import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {Pool} from "pg";
import {testUrl} from "./today-setup";
import {CoachStore} from "../../src/services/ai/coach-store";
import {signCoachProposal} from "../../src/services/ai/coach-proof";
import {PersonalRecordStore} from "../../src/services/today/personal-record-store";
import {TodayStore} from "../../src/services/today/store";
import {workoutCanonical,workoutContextInput} from "../../src/lib/workout-context";
process.env.COACH_SIGNING_SECRET="synthetic-test-secret-must-never-be-used-in-production";
test("model proposals and reads preserve transactional ownership, provenance, nulls and retry semantics",async t=>{
  const admin=new Pool({connectionString:testUrl()}),target=new URL(testUrl());target.username="liftcut_workout";target.password="w1b-local-fixture-only";
  const pool=new Pool({connectionString:target.toString(),max:6}),coach=new CoachStore(pool),records=new PersonalRecordStore(pool),workout=new TodayStore(pool);
  const owner=randomUUID(),other=randomUUID(),day="2026-10-14";
  const provenance={provider:"synthetic-fixture",model:"scripted-not-real",version:"coach-v1" as const,sourceTexts:["昨天早上称了七十二点五公斤"]};
  const body={action:"create",id:randomUUID(),entry:{kind:"body",date:"2026-10-13",weightKg:72.5,waistCm:null},source:"conversation",text:provenance.sourceTexts[0],anchorDate:day};
  const command={...body,modelProof:signCoachProposal(owner,body,provenance)};
  try{
    await admin.query("insert into auth.users values($1),($2)",[owner,other]);
    await t.test("signed draft commits once; changed fields, owner and missing proof are rejected",async()=>{
      await assert.rejects(records.command(other,command),/MODEL_PROPOSAL/);
      await assert.rejects(records.command(owner,{...command,entry:{...body.entry,weightKg:88}}),/MODEL_PROPOSAL/);
      await assert.rejects(records.command(owner,body),/DRAFT_MISMATCH/);
      const results=await Promise.all([records.command(owner,command),records.command(owner,command)]);assert.deepEqual(results[0],results[1]);
      const list=await records.list(owner);assert.equal(list.length,1);assert.equal(list[0].model?.model,"scripted-not-real");assert.equal(list[0].entry.kind==="body"&&list[0].entry.waistCm,null);
    });
    await t.test("fresh reads merge legacy/new records, exclude compensations and isolate users",async()=>{
      await admin.query("insert into body_metric_logs(id,user_id,date,weight,waist) values($1,$2,'2026-10-12',74,80)",[randomUUID(),owner]);
      let read=await coach.read(owner,{topic:"body",from:"2026-10-12",to:day},day);
      assert.equal(read.rows.length,2);assert.equal(read.summary.weightChangeKg,-1.5);
      assert.equal((await coach.read(other,{topic:"body",from:"2026-10-12",to:day},day)).rows.length,0);
      await records.command(owner,{action:"undo",id:randomUUID(),recordId:body.id});await records.command(owner,command);
      read=await coach.read(owner,{topic:"body",from:"2026-10-12",to:day},day);assert.equal(read.rows.length,1);assert.equal(read.summary.latestWeightKg,74);
      await assert.rejects(coach.read(owner,{topic:"body",from:"2020-01-01",to:day},day),/DATE_RANGE/);
    });
    await t.test("expired unsent proposal rejected; committed exact retry remains valid after expiry",async sub=>{
      const old={...body,id:randomUUID()};await assert.rejects(records.command(owner,{...old,modelProof:signCoachProposal(owner,old,provenance,Date.now()-8*86400000)}),/MODEL_PROPOSAL/);
      const now=Date.now(),exp={...body,id:randomUUID()},signed={...exp,modelProof:signCoachProposal(owner,exp,provenance,now)};
      await records.command(owner,signed);sub.mock.method(Date,"now",()=>now+8*86400000);await records.command(owner,signed);
    });
    await t.test("model workout confirmation reparses, checks context and keeps original words",async()=>{
      const plan=randomUUID(),d=randomUUID(),e=randomUUID();
      await admin.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'Synthetic model',true)",[plan,owner]);
      await admin.query("insert into training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
      await admin.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'day')",[d,plan+'w']);
      await admin.query("insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'深蹲',3,'8-12',7)",[e,d]);
      const session=await workout.start(owner,{id:randomUUID(),dayId:d,timezone:"UTC"});
      const binding={id:randomUUID(),sessionId:session.id,text:"记录 深蹲 8 次",originalText:"我刚才深蹲做了八次",selectedExerciseId:e,version:1,
        contextHash:createHash("sha256").update(workoutCanonical(workoutContextInput(session))).digest("hex"),setIds:[randomUUID()],authorization:"confirm_preview"};
      const signed={...binding,modelProof:signCoachProposal(owner,binding,provenance)};
      await assert.rejects(workout.command(other,signed),/MODEL_PROPOSAL/);
      const result=await workout.command(owner,signed);assert.equal(result.session.sets[0].rpe,null);assert.equal(result.session.sets[0].weightKg,null);
      assert.equal(result.receipts[0].text,binding.originalText);assert.equal(result.receipts[0].model?.model,"scripted-not-real");
      const stale={...binding,id:randomUUID(),setIds:[randomUUID()]};await assert.rejects(workout.command(owner,{...stale,modelProof:signCoachProposal(owner,stale,provenance)}),/STALE_CONTEXT/);
      await workout.undoCommand(owner,{id:randomUUID(),commandId:binding.id,version:1});await workout.command(owner,signed);
      assert.equal((await workout.load(owner)).session?.sets[0].status,"voided");
      assert.deepEqual(await workout.current(owner),(await workout.load(owner)).session);
      assert.equal(await workout.current(other),null);
    });
    await t.test("quota reservation is atomic, per account, and private to the restricted runtime",async()=>{
      const attempts=await Promise.allSettled(Array.from({length:10},()=>coach.reserve(owner,randomUUID())));
      assert.equal(attempts.filter(x=>x.status==="fulfilled").length,6);
      await coach.reserve(other,randomUUID());
      const p=(await admin.query("select has_table_privilege('anon','coach_request_usage','select') as a,has_table_privilege('authenticated','coach_request_usage','insert') as b,has_table_privilege('liftcut_workout','coach_request_usage','delete') as d")).rows[0];
      assert.deepEqual(p,{a:false,b:false,d:false});
    });
  }finally{await admin.query("delete from auth.users where id=any($1::uuid[])",[[owner,other]]);await pool.end();await admin.end();}
});
