import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { TodayStore } from "../../src/services/today/store";
import { localContextHash } from "../../src/lib/workout-context";
import { projectOperation, type WorkoutOperation } from "../../src/lib/workout-outbox";
import type { Session } from "@liftcut/core/today";
import { testUrl } from "./today-setup";

test("session replacement on real PostgreSQL: atomicity, isolation, concurrent histories and offline replay",async t=>{
  const admin=new Pool({connectionString:testUrl()}),url=new URL(testUrl());url.username="liftcut_workout";url.password="w1b-local-fixture-only";
  const pool=new Pool({connectionString:url.toString(),max:6}),store=new TodayStore(pool);
  const user=randomUUID(),other=randomUUID(),plan=randomUUID(),day=randomUUID(),exercise=randomUUID(),second=randomUUID();
  async function fresh(){const old=(await store.load(user)).session;if(old)await store.end(user,{id:old.id,revision:old.revision+1,status:"ended"});
    return store.start(user,{id:randomUUID(),dayId:day,timezone:"UTC"});}
  const request=async(s:Session,id=exercise)=>({id:randomUUID(),sessionId:s.id,version:1,revision:s.revision+1,exerciseId:id,newExerciseId:randomUUID(),
    contextHash:await localContextHash(s),catalogVersion:"session-v1",candidateId:"dumbbell-floor-press",equipment:["dumbbells"],authorization:"confirm_preview"});
  const undo=async(s:Session,id:string)=>({id:randomUUID(),sessionId:s.id,version:1,revision:s.revision+1,replacementId:id,newExerciseId:randomUUID(),
    contextHash:await localContextHash(s),authorization:"confirm_preview"});
  const tap=(s:Session,id=exercise)=>({id:randomUUID(),sessionId:s.id,planExerciseId:id,setIndex:1,revision:1,status:"done",weightKg:null,reps:8,rpe:null,
    weightSource:null,repsSource:"user_entered",inputUnit:"kg",sourceRef:"today-tap"});
  const planSnapshot=async()=>JSON.stringify((await admin.query(`select p.*,w.week_number,d.title,e.id as exercise,e.name as exercise_name,e.sets,e.rep_range,e.target_rpe
    from training_plans p join training_plan_weeks w on w.training_plan_id=p.id join training_plan_days d on d.week_id=w.id
    join training_plan_exercises e on e.day_id=d.id where p.id=$1 order by e.id`,[plan])).rows);
  try {
    await admin.query("insert into auth.users values($1),($2)",[user,other]);
    await admin.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'Replacement synthetic',true)",[plan,user]);
    await admin.query("insert into training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
    await admin.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'Replacement')",[day,plan+'w']);
    for(const id of [exercise,second])await admin.query("insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'杠铃卧推',3,'8-12',7)",[id,day]);
    const beforePlan=await planSnapshot();
    await t.test("four concurrent duplicates write one receipt/event; exact retries survive compensation and ending",async()=>{
      const s=await fresh(),req=await request(s);await Promise.all(Array.from({length:4},()=>store.replaceExercise(user,req)));
      let current=(await store.load(user)).session!;assert.equal(current.replacements!.length,1);
      await assert.rejects(store.replaceExercise(user,{...req,equipment:[]}),/CONTENT_CONFLICT/);
      const u=await undo(current,req.id);await Promise.all([store.replaceExercise(user,u,true),store.replaceExercise(user,u,true)]);
      current=await store.replaceExercise(user,req);assert.equal(current.revision,3);assert.equal(current.replacements![0].undo!.id,u.id);
      assert.equal(current.prescription.exercises.find(e=>e.id===u.newExerciseId)!.name,"杠铃卧推");
      await store.end(user,{id:s.id,revision:4,status:"ended"});assert.equal((await store.replaceExercise(user,u,true)).status,"ended");
      assert.deepEqual((await admin.query(`select (select count(*)::int from workout_exercise_changes where session_id=$1) as receipts,
        (select count(*)::int from workout_session_events where session_id=$1) as events`,[s.id])).rows[0],{receipts:2,events:4});
      for(const id of [exercise,req.newExerciseId])await assert.rejects(store.writeSet(user,tap(current,id)),/SESSION_ENDED/);
    });
    await t.test("offline replacement -> undo -> replacement -> sentence -> end has matching server context and actuals",async()=>{
      await fresh();let view=await store.load(user);const queue:{p:WorkoutOperation;hash:string}[]=[];
      const add=async(p:WorkoutOperation)=>{view=projectOperation(view,p,"2026-10-14T02:00:00Z");queue.push({p,hash:await localContextHash(view.session!)});};
      const first=await request(view.session!);await add({action:"replace",body:first});
      const u=await undo(view.session!,first.id);await add({action:"undoReplacement",body:u});
      const next=await request(view.session!,u.newExerciseId);await add({action:"replace",body:next});
      await add({action:"apply",body:{id:randomUUID(),version:1,sessionId:view.session!.id,selectedExerciseId:next.newExerciseId,
        text:"哑铃地板卧推 10、8 次",setIds:[randomUUID(),randomUUID()],authorization:"confirm_preview",contextHash:await localContextHash(view.session!)}});
      await add({action:"end",body:{id:view.session!.id,revision:view.session!.revision+1,status:"ended"}});
      for(const {p,hash} of queue){const result=p.action==="apply"?await store.command(user,p.body):p.action==="end"?await store.end(user,p.body):await store.replaceExercise(user,p.body,p.action==="undoReplacement");
        assert.equal(await localContextHash("session" in result?result.session:result),hash);}
      assert.equal(view.session!.sets.length,2);assert.ok(view.session!.sets.every(s=>s.weightKg===null&&s.rpe===null&&s.planExerciseId===next.newExerciseId));
    });
    await t.test("all existing set states block replacement; untouched exercise actuals remain exact",async()=>{
      for(const status of ["done","skipped","voided"]){const s=await fresh(),set=tap(s);
        if(status==="skipped")await store.writeSet(user,{...set,status,reps:null,repsSource:null});
        else {await store.writeSet(user,set);if(status==="voided")await store.writeSet(user,{...set,status,revision:2});}
        const current=(await store.load(user)).session!;
        await assert.rejects(store.replaceExercise(user,await request(current)),/EXERCISE_HAS_HISTORY/);
        const replaced=await store.replaceExercise(user,await request(current,second));assert.deepEqual(replaced.sets,current.sets);
      }
    });
    await t.test("stale preview and old device's queued ID cannot write into replacement",async()=>{
      const s=await fresh(),req=await request(s),p=await store.replaceExercise(user,req);
      await assert.rejects(store.replaceExercise(user,{...req,id:randomUUID(),newExerciseId:randomUUID()}),/STALE_CONTEXT/);
      await assert.rejects(store.writeSet(user,tap(s)),/SET_NOT_IN_PRESCRIPTION/);
      await assert.rejects(store.replaceExercise(user,{...await undo(p,req.id),newExerciseId:exercise},true),/EXERCISE_ID_REUSED/);
      await store.writeSet(user,tap(p,req.newExerciseId));
      await assert.rejects(store.replaceExercise(user,await undo((await store.load(user)).session!,req.id),true),/EXERCISE_HAS_HISTORY/);
    });
    await t.test("replacement vs first set, compensation vs first set and end vs replacement serialize with one winner",async()=>{
      for(let i=0;i<4;i++){
        let s=await fresh();let req=await request(s);let results=await Promise.allSettled([store.replaceExercise(user,req),store.writeSet(user,tap(s))]);
        assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
        s=await fresh();req=await request(s);s=await store.replaceExercise(user,req);const u=await undo(s,req.id);
        results=await Promise.allSettled([store.replaceExercise(user,u,true),store.writeSet(user,tap(s,req.newExerciseId))]);
        assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
        s=await fresh();req=await request(s);results=await Promise.allSettled([store.replaceExercise(user,req),store.end(user,{id:s.id,revision:2,status:"ended"})]);
        assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      }
    });
    await t.test("injected receipt insert failure rolls back prescription and event; plan and other rows never updated",async()=>{
      const s=await fresh(),req=await request(s),guard='replacement_fault_'+randomUUID().replaceAll('-','');
      await admin.query(`alter table workout_exercise_changes add constraint ${guard} check(id<>'${req.id}'::uuid)`);
      try{await assert.rejects(store.replaceExercise(user,req),/check constraint/);}
      finally{await admin.query(`alter table workout_exercise_changes drop constraint ${guard}`);}
      assert.deepEqual((await store.load(user)).session,s);assert.equal(await planSnapshot(),beforePlan);
    });
    await t.test("RLS and append-only receipt grants prevent cross-owner replay/read/write/delete",async()=>{
      const s=await fresh(),req=await request(s);await store.replaceExercise(user,req);
      await assert.rejects(store.replaceExercise(other,req),/NOT_FOUND/);
      const c=await pool.connect();try{await c.query("begin");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
        assert.equal((await c.query("select * from workout_exercise_changes where session_id=$1",[s.id])).rowCount,0);
        await assert.rejects(c.query("insert into workout_exercise_changes(id,user_id,session_id,version,request_hash,new_exercise_id,receipt) values($1,$2,$3,1,$4,$5,'{}')",[randomUUID(),user,s.id,'a'.repeat(64),randomUUID()]),/row-level security/);
      }finally{await c.query("rollback");c.release();}
      assert.deepEqual((await admin.query(`select has_table_privilege('authenticated','workout_exercise_changes','INSERT') as browser,
        has_table_privilege('anon','workout_exercise_changes','SELECT') as anon,
        has_table_privilege('liftcut_workout','workout_exercise_changes','UPDATE') as update,
        has_table_privilege('liftcut_workout','workout_exercise_changes','DELETE') as delete`)).rows[0],{browser:false,anon:false,update:false,delete:false});
      assert.equal(await planSnapshot(),beforePlan);
    });
    await t.test("history preserves every session and receipt without overlapping queries on one real connection",async()=>{
      const expected=await store.history(user);assert.ok(expected.length>2);
      let active=0,peak=0;
      const observedPool={async connect(){
        const real=await pool.connect();
        return new Proxy(real,{get(target,key){
          if(key==="query")return(...args:unknown[])=>{
            active++;peak=Math.max(peak,active);
            return Promise.resolve(Reflect.apply(target.query,target,args)).finally(()=>{active--;});
          };
          if(key==="release")return target.release.bind(target);
          return Reflect.get(target,key);
        }});
      }} as unknown as Pool;
      const checked=new TodayStore(observedPool);
      assert.deepEqual(await checked.history(user),expected);
      assert.deepEqual(await checked.history(other),[]);
      assert.equal(active,0);assert.equal(peak,1,"a transaction client must have only one outstanding query");
    });
  }finally{await pool.end();await admin.end();}
});
