import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {TodayStore} from "../../src/services/today/store";
import {CoachStore} from "../../src/services/ai/coach-store";
import {CoachHistoryStore} from "../../src/services/ai/coach-history-store";
import {groundWorkoutReview} from "../../src/lib/workout-review-grounding";
import {workoutReviewApprovalSchema,type WorkoutReview} from "@liftcut/core/workout-review";
import {sessionsToWorkoutLogs} from "@liftcut/core/today";
import {storedSet} from "@liftcut/core/workout-context";
import {projectOperation} from "@liftcut/core/workout-outbox";
import {testUrl} from "./today-setup";

test("conversation review ledger: real transactions, source references, confirmation, revisions and owner isolation",async t=>{
  const admin=new Pool({connectionString:testUrl()}),url=new URL(testUrl());url.username="liftcut_workout";url.password="w1b-local-fixture-only";
  const pool=new Pool({connectionString:url.toString(),max:6}),store=new TodayStore(pool),owner=randomUUID(),other=randomUUID();
  const cid=randomUUID(),plan=randomUUID(),day=randomUUID(),row=randomUUID(),press=randomUUID();
  const group=(weightQuote:string|null,repsQuote:string|null)=>({weightQuote,repsQuote,rpeQuote:null,countQuote:null});
  const approval=(p:WorkoutReview)=>({id:p.id,conversationId:cid,sessionId:p.sessionId,version:1 as const,authorization:"confirm_preview" as const});
  const prepare=async(text:string,input:unknown)=>{
    const requestId=randomUUID(),c=await store.beginConversation(owner,cid,requestId);assert.ok(c);
    const p=groundWorkoutReview(input,text,c.session,c.state,{id:randomUUID(),conversationId:cid,requestId,newId:randomUUID});
    await store.prepareReview(owner,p);return p;
  };
  try{
    await admin.query("insert into auth.users values($1),($2)",[owner,other]);
    await admin.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'Conversation fixture',true)",[plan,owner]);
    await admin.query("insert into training_plan_weeks values($1,$2,1)",[plan+"w",plan]);
    await admin.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'Fixture')",[day,plan+"w"]);
    for(const [id,name] of [[row,"坐姿划船"],[press,"哑铃肩推"]])await admin.query(
      "insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,$3,1,'99',10)",[id,day,name]);
    let session=await store.start(owner,{id:randomUUID(),dayId:day,timezone:"UTC"});
    const first=await prepare("坐姿划船42公斤，9次",{kind:"record",exerciseId:row,targetQuote:null,groups:[group("42公斤","9次")]});
    await t.test("new API tables deny browser roles and runtime preview-content edits",async()=>{
      for(const table of ["workout_coach_contexts","workout_coach_reviews"]){
        const acl=(await admin.query(`select has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE') as anon,
          has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') as browser`,[table])).rows[0];
        assert.equal(acl.anon,false);assert.equal(acl.browser,false);
      }
      const acl=(await admin.query("select has_column_privilege('liftcut_workout','workout_coach_reviews','payload','UPDATE') as edit")).rows[0];
      assert.equal(acl.edit,false);
    });
    await t.test("preparing does not write actuals; approval rejects edited JSON, other owners and stale cards",async()=>{
      assert.equal((await store.current(owner))!.sets.length,0);
      assert.throws(()=>workoutReviewApprovalSchema.parse({...approval(first),requests:first.requests}));
      await assert.rejects(store.approveReview(other,approval(first)),/NOT_FOUND/);
      await store.beginConversation(owner,cid,randomUUID());
      await assert.rejects(store.approveReview(owner,approval(first)),/SUPERSEDED/);
      assert.equal((await store.current(owner))!.sets.length,0);
    });
    await t.test("concurrent confirmations create one row/event and persisted focus",async()=>{
      const p=await prepare("坐姿划船42公斤，9次",{kind:"record",exerciseId:row,targetQuote:null,groups:[group("42公斤","9次")]});
      const results=await Promise.all([1,2,3].map(()=>store.approveReview(owner,approval(p))));session=results[0].session;
      assert.equal(session.sets.length,1);assert.equal((await store.trace(owner,p.requests[0].id)).events.length,1);
      assert.equal((await store.beginConversation(owner,cid,randomUUID()))!.state.focus?.recordId,p.requests[0].id);
    });
    await t.test("extra actual set can inherit known load without changing prescription; correction patches same identity",async()=>{
      const p=await prepare("坐姿划船又做了6次，重量不变",{kind:"inherit_weight",exerciseId:row,targetQuote:null,groups:[group(null,"6次")]});
      session=(await store.approveReview(owner,approval(p))).session;
      assert.equal(session.prescription.exercises.find(e=>e.id===row)!.sets,1);assert.equal(session.sets.length,2);
      assert.equal(p.requests[0].weightKg,42);assert.equal(p.requests[0].setIndex,2);assert.equal(p.requests[0].rpe,null);
      const c=await prepare("刚才那组不对，5次",{kind:"correct",exerciseId:row,targetQuote:null,groups:[group(null,"5次")]});
      session=(await store.approveReview(owner,approval(c))).session;
      assert.equal(c.requests[0].id,p.requests[0].id);assert.equal(session.sets.length,2);
      await assert.rejects(store.approveReview(owner,approval(p)),/STALE_CONTEXT/);
    });
    await t.test("void and separately confirmed redo keep one counted replacement and durable audit",async()=>{
      const p=await prepare("刚才那组不算，重新做",{kind:"void",exerciseId:row,targetQuote:null,groups:[]});
      session=(await store.approveReview(owner,approval(p))).session;assert.equal(session.sets.filter(s=>s.status==="done").length,1);
      const redo=await prepare("坐姿划船重新做了7次",{kind:"record",exerciseId:row,targetQuote:null,groups:[group(null,"7次")]});
      session=(await store.approveReview(owner,approval(redo))).session;
      assert.notEqual(redo.requests[0].id,p.requests[0].id);assert.equal(redo.requests[0].weightKg,null);
      assert.equal(session.sets.length,3);assert.equal(sessionsToWorkoutLogs([session])[0].exercises.length,2);
      assert.deepEqual((await store.trace(owner,p.requests[0].id)).events.map(e=>e.type),["recorded","corrected","voided"]);
    });
    await t.test("per-hand units survive correction and memory; legacy totals never see total kilograms",async()=>{
      const p=await prepare("哑铃肩推，单边17公斤，11次",{kind:"record",exerciseId:press,targetQuote:null,groups:[group("17公斤","11次")]});
      await store.approveReview(owner,approval(p));
      const c=await prepare("刚才说错了，是单边17磅，不是17公斤",{kind:"correct",exerciseId:press,targetQuote:null,groups:[group("17磅",null)]});
      session=(await store.approveReview(owner,approval(c))).session;
      const record=session.sets.find(s=>s.id===p.requests[0].id)!;assert.deepEqual(record.perHandLoad,{value:17,unit:"lb"});assert.equal(record.weightKg,null);
      const memory=await new CoachStore(pool).memory(owner,"2026-10-30");
      assert.ok(memory.rows.some(r=>r.exerciseName==="哑铃肩推"&&r.value===17&&r.unit==="lb/hand"));
      const trace=await store.trace(owner,record.id);
      assert.equal(trace.reviews.length,2);
      const connection=await admin.connect();
      try{await connection.query("begin; set local role liftcut_workout");
        await connection.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
        assert.equal((await connection.query("select id from workout_coach_reviews where id=$1",[p.id])).rowCount,1);
        assert.equal((await connection.query("delete from workout_coach_reviews where id=$1 returning id",[p.id])).rowCount,0);
      }finally{await connection.query("rollback");connection.release();}
    });
    await t.test("deleted conversation clears pending focus and rejects delayed approval/model preparation",async()=>{
      const p=await prepare("刚才那组不对，10次",{kind:"correct",exerciseId:press,targetQuote:null,groups:[group(null,"10次")]});
      await new CoachHistoryStore(pool).remove(owner,cid);
      await assert.rejects(store.approveReview(owner,approval(p)),/NOT_FOUND/);
      assert.equal((await admin.query("select id from workout_coach_reviews where conversation_id=$1 and status<>'applied'",[cid])).rowCount,0);
      await assert.rejects(store.prepareReview(owner,{...p,id:randomUUID()}),/STALE_CONVERSATION/);
      await assert.rejects(store.beginConversation(owner,cid,randomUUID()),/CONVERSATION_DELETED/);
    });
    await t.test("manual edits preserve per-hand basis and can edit an existing extra actual slot",async()=>{
      session=(await store.current(owner))!;
      const hand=session.sets.find(s=>s.planExerciseId===press)!,{perHandLoad,...base}=storedSet(hand);
      const tap={...base,revision:hand.revision+1,reps:8,repsSource:"user_entered",sourceRef:"today-tap"};
      const projected=projectOperation({session,days:[],previous:{}},{action:"set",body:tap},new Date().toISOString());
      assert.deepEqual(projected.session!.sets.find(s=>s.id===hand.id)!.perHandLoad,perHandLoad);
      session=await store.writeSet(owner,tap);assert.deepEqual(session.sets.find(s=>s.id===hand.id)!.perHandLoad,perHandLoad);
      const extra=session.sets.find(s=>s.planExerciseId===row&&s.setIndex===3)!;
      const edit={...storedSet(extra),revision:extra.revision+1,reps:8,repsSource:"user_entered",sourceRef:"today-tap"};
      assert.equal(projectOperation({session,days:[],previous:{}},{action:"set",body:edit},new Date().toISOString()).session!.sets.find(s=>s.id===extra.id)!.reps,8);
      session=await store.writeSet(owner,edit);assert.equal(session.sets.find(s=>s.id===extra.id)!.reps,8);
      assert.equal(session.prescription.exercises.find(e=>e.id===row)!.sets,1);
    });
  }finally{await pool.end();await admin.end();}
});
