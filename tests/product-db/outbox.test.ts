import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { TodayStore } from "../../src/services/today/store";
import { testUrl } from "./today-setup";
import { localContextHash } from "../../src/lib/workout-context";
import { projectOperation, type WorkoutOperation } from "@liftcut/core/workout-outbox";

test("entire offline chain has identical contexts and values when replayed against real PostgreSQL",async()=>{
  const admin=new Pool({connectionString:testUrl()}),url=new URL(testUrl());url.username="liftcut_workout";url.password="w1b-local-fixture-only";
  const pool=new Pool({connectionString:url.toString()}),store=new TodayStore(pool);
  const user=randomUUID(),plan=randomUUID(),day=randomUUID(),exercise=randomUUID();
  try {
    await admin.query("insert into auth.users values($1)",[user]);
    await admin.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Offline synthetic',true)",[plan,user]);
    await admin.query("insert into public.training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
    await admin.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'Offline')",[day,plan+'w']);
    await admin.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'深蹲',5,'8-12',7)",[exercise,day]);
    const session=await store.start(user,{id:randomUUID(),dayId:day,timezone:"Asia/Shanghai"});
    let view=await store.load(user);const queue:{request:WorkoutOperation;after:string}[]=[];
    const enqueue=async(request:WorkoutOperation)=>{
      view=projectOperation(view,request,"2026-10-14T00:00:00Z");queue.push({request,after:await localContextHash(view.session!)});
    };
    const tap={id:randomUUID(),sessionId:session.id,planExerciseId:exercise,setIndex:1,revision:1,status:"done",weightKg:null,reps:8,rpe:null,
      inputUnit:"kg",sourceRef:"today-tap",weightSource:null,repsSource:"user_entered"};
    await enqueue({action:"set",body:tap});
    const command=async(text:string,count:number)=>({id:randomUUID(),sessionId:session.id,text,version:1,contextHash:await localContextHash(view.session!),
      setIds:Array.from({length:count},()=>randomUUID()),authorization:"confirm_preview"});
    const batch=await command("深蹲 100 lb 10、8，最后一组 RPE 9",2);await enqueue({action:"apply",body:batch});
    const correction=await command("更正 深蹲 第 3 组 7 次",0);await enqueue({action:"apply",body:correction});
    await enqueue({action:"undo",body:{id:randomUUID(),commandId:correction.id,version:1}});
    const s=view.session!.sets[1];
    await enqueue({action:"set",body:{...tap,id:s.id,setIndex:2,revision:2,status:"voided",weightKg:s.weightKg,weightSource:"user_entered",reps:s.reps}});
    await enqueue({action:"end",body:{id:session.id,revision:2,status:"ended"}});
    assert.equal((await store.load(user)).session!.sets.length,0); // All six prepared without writes.
    for(const {request:p,after} of queue) {
      const run=()=>p.action==="set"?store.writeSet(user,p.body):p.action==="apply"?store.command(user,p.body)
        :p.action==="undo"?store.undoCommand(user,p.body):store.end(user,p.body);
      await run();const repeated=await run(),actual="session" in repeated?repeated.session:repeated;
      assert.equal(await localContextHash(actual),after,`Projection drift for ${p.action}`);
    }
    const counts=(await admin.query(`select (select count(*) from set_logs where user_id=$1)::int as sets,
      (select count(*) from workout_commands where user_id=$1)::int as commands,
      (select count(*) from workout_session_events where user_id=$1)::int as events`,[user])).rows[0];
    assert.deepEqual(counts,{sets:3,commands:3,events:9});
    assert.equal(view.session!.sets[1].inputUnit,"lb");assert.deepEqual(view.session!.sets.map(s=>s.rpe),[null,null,9]);
  } finally {await pool.end();await admin.end();}
});
