import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { TodayStore } from "../../src/services/today/store";
import { sessionsToWorkoutLogs, type SetRequest } from "@liftcut/core/today";
import { setup,testUrl } from "./today-setup";

test("W1b real PostgreSQL upgrade, transactions, permissions and midnight recovery", async t => {
  await setup();
  const url = testUrl(), admin = new Pool({connectionString:url});
  const target = new URL(url); target.username="liftcut_workout"; target.password="w1b-local-fixture-only";
  const pool=new Pool({connectionString:target.toString(),max:6});
  const user=randomUUID(),other=randomUUID(),plan=randomUUID(),day=randomUUID(),exercise=randomUUID();
  let now=new Date("2026-10-14T06:59:59Z"); const store=new TodayStore(pool,()=>now);
  try {
    await admin.query("insert into auth.users values($1),($2)",[user,other]);
    await admin.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Synthetic W1b',true)",[plan,user]);
    await admin.query("insert into public.training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
    await admin.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'Synthetic day')",[day,plan+'w']);
    await admin.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'Squat',4,'8-12',7)",[exercise,day]);
    const start={id:randomUUID(),dayId:day,timezone:"America/Los_Angeles"};
    await t.test("parallel start retries return one UUID; second active session denied",async()=>{
      const sessions=await Promise.all(Array.from({length:4},()=>store.start(user,start)));
      assert.ok(sessions.every(s=>s.id===start.id && s.localDate==="2026-10-13"));
      await assert.rejects(store.start(user,{...start,id:randomUUID()}),/ACTIVE_SESSION_EXISTS/);
      await assert.rejects(store.start(user,{...start,timezone:"UTC"}),/CONTENT_CONFLICT/);
      assert.equal((await admin.query("select count(*) from public.workout_sessions")).rows[0].count,"1");
    });
    const req:SetRequest={id:randomUUID(),sessionId:start.id,planExerciseId:exercise,setIndex:1,revision:1,status:"done",weightKg:null,
      reps:8,rpe:null,weightSource:null,repsSource:"user_entered",inputUnit:"kg",sourceRef:"today-tap"};
    await t.test("double-click / parallel replay keeps one set and one event; SQL NULL persists",async()=>{
      await Promise.all(Array.from({length:4},()=>store.writeSet(user,req)));
      const row=(await admin.query("select * from public.set_logs where id=$1",[req.id])).rows[0];
      assert.equal(row.rpe,null); assert.equal(row.weight_kg,null); assert.equal(row.reps,8);
      assert.equal((await admin.query("select count(*) from public.workout_session_events where set_log_id=$1",[req.id])).rows[0].count,"1");
      await assert.rejects(store.writeSet(user,{...req,reps:9}),/CONTENT_CONFLICT/);
    });
    await t.test("correction and undo advance revision; old requests cannot resurrect or overwrite",async()=>{
      const corrected={...req,revision:2,reps:7}; await store.writeSet(user,corrected);
      await assert.rejects(store.writeSet(user,req),/STALE_REVISION/);
      const voided={...corrected,revision:3,status:"voided" as const}; await store.writeSet(user,voided);
      await assert.rejects(store.writeSet(user,corrected),/STALE_REVISION/);
      await store.writeSet(user,voided);
      assert.equal((await admin.query("select count(*) from public.workout_session_events where set_log_id=$1",[req.id])).rows[0].count,"3");
    });
    await t.test("trace preserves record, correction, compensation and rejects other owners",async()=>{
      const trace=await store.trace(user,req.id);
      assert.deepEqual(trace.events.map(e=>e.type),["recorded","corrected","voided"]);
      assert.deepEqual(trace.events.map(e=>e.data.after.revision),[1,2,3]);
      assert.ok(trace.events.every(e=>e.data.after.rpe===null));
      await assert.rejects(store.trace(other,req.id),/NOT_FOUND/);
    });
    await t.test("RLS denies cross-owner select/insert/update; browser cannot bypass transaction API",async()=>{
      assert.equal((await store.load(other)).session,null);
      assert.deepEqual(await store.history(other),[]);
      await assert.rejects(store.writeSet(other,{...req,revision:4}),/NOT_FOUND/);
      await assert.rejects(store.start(other,{id:randomUUID(),dayId:day,timezone:"UTC"}),/PLAN_DAY_UNAVAILABLE/);
      const c=await pool.connect();
      try {
        await c.query("begin"); await c.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
        assert.equal((await c.query("select * from public.set_logs")).rowCount,0);
        assert.equal((await c.query("update public.workout_sessions set status='cancelled',ended_at=now() where id=$1",[start.id])).rowCount,0);
        await c.query("rollback");
        await c.query("begin"); await c.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
        await assert.rejects(c.query("insert into public.workout_sessions(id,user_id,local_date,timezone,training_plan_id,week_number,day_number,prescription,started_at,request_hash) values($1,$2,'2026-10-13','UTC','p',1,1,'{}',now(),'x')",[randomUUID(),user]),/row-level security/);
        await c.query("rollback");
        await c.query("begin"); await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
        await assert.rejects(c.query("update public.set_logs set user_id=$1 where id=$2",[other,req.id]),/row-level security/);
        await c.query("rollback");
      } finally { await c.query("rollback"); c.release(); }
      const perms=(await admin.query("select has_table_privilege('authenticated','public.set_logs','INSERT') as i,has_table_privilege('anon','public.workout_sessions','SELECT') as a,has_table_privilege('liftcut_workout','public.workout_session_events','DELETE') as d")).rows[0];
      assert.deepEqual(perms,{i:false,a:false,d:false});
    });
    await t.test("three states reload, void excluded, snapshot survives plan changes; end leaves missing sets missing",async()=>{
      for(const index of [2,3]) await store.writeSet(user,{...req,id:randomUUID(),setIndex:index});
      await admin.query("update public.training_plan_exercises set sets=9,name='Changed' where id=$1",[exercise]);
      const s=(await store.load(user)).session!; assert.equal(s.sets.length,3); assert.equal(s.prescription.exercises[0].sets,4);
      now=new Date("2026-10-14T07:10:00Z");
      const end={id:start.id,revision:2,status:"ended"}; await store.end(user,end); await store.end(user,end);
      const history=await store.history(user); assert.equal(history[0].localDate,"2026-10-13"); assert.equal(history[0].sets.length,3);
      assert.equal(sessionsToWorkoutLogs(history)[0].exercises.length,2);
      await assert.rejects(store.start(user,start),/STALE_REVISION/);
      await assert.rejects(store.writeSet(user,{...req,id:randomUUID(),setIndex:4}),/SESSION_ENDED/);
      assert.equal((await admin.query("select count(*) from public.workout_logs")).rows[0].count,"0");
    });
    await t.test("Shanghai session retains start date across its midnight",async()=>{
      now=new Date("2026-10-14T15:59:59Z"); const s=await store.start(user,{id:randomUUID(),dayId:day,timezone:"Asia/Shanghai"});
      now=new Date("2026-10-14T16:10:00Z"); const ended=await store.end(user,{id:s.id,revision:2,status:"ended"});
      assert.equal(ended.localDate,"2026-10-14");
    });
  } finally { await pool.end(); await admin.end(); }
});
