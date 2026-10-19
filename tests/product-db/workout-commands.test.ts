import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { TodayStore } from "../../src/services/today/store";
import { testUrl } from "./today-setup";
import type { SetRequest } from "@liftcut/core/today";

test("W2b real transactions: atomic commands, receipts, compensation and isolation",async t=>{
  const admin=new Pool({connectionString:testUrl()}),target=new URL(testUrl());
  target.username="liftcut_workout";target.password="w1b-local-fixture-only";
  const pool=new Pool({connectionString:target.toString(),max:6}),store=new TodayStore(pool);
  const user=randomUUID(),other=randomUUID(),plan=randomUUID(),day=randomUUID(),exercise=randomUUID();
  await admin.query("insert into auth.users values($1),($2)",[user,other]);
  await admin.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'W2b synthetic',true)",[plan,user]);
  await admin.query("insert into public.training_plan_weeks values($1,$2,1)",[plan+'w',plan]);
  await admin.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'W2b')",[day,plan+'w']);
  await admin.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'深蹲',16,'8-12',7)",[exercise,day]);
  const session=await store.start(user,{id:randomUUID(),dayId:day,timezone:"Asia/Shanghai"});
  const prepare=async(text:string)=>{
    const input={sessionId:session.id,text,selectedExerciseId:exercise},p=await store.preview(user,input);
    assert.equal(p.result.status,"draft");if(p.result.status!=="draft")throw Error("Not a draft");
    const d=p.result.draft,count=d.kind==="record"?d.sets.length:d.kind==="skip"?1:0;
    return {...input,id:randomUUID(),version:1,contextHash:p.contextHash,setIds:Array.from({length:count},()=>randomUUID()),authorization:"confirm_preview"};
  };
  const counts=async()=> (await admin.query(`select (select count(*) from public.set_logs where user_id=$1) as sets,
    (select count(*) from public.workout_commands where user_id=$1) as receipts,
    (select count(*) from public.workout_session_events where user_id=$1) as events`,[user])).rows[0];
  try {
    const batch=await prepare("记下 深蹲 50 公斤 10、10、8，最后一组 RPE 9");
    await t.test("preview has no writes; strict authorization/field contract rejects forged drafts",async()=>{
      assert.deepEqual(await counts(),{sets:"0",receipts:"0",events:"1"});
      await assert.rejects(store.command(user,{...batch,approved:true}));
      await assert.rejects(store.command(user,{...batch,authorization:undefined}));
      await assert.rejects(store.command(user,{...batch,version:2}));
      assert.deepEqual(await counts(),{sets:"0",receipts:"0",events:"1"});
    });
    await t.test("four concurrent copies commit one batch; repeated lost-response request returns receipt",async()=>{
      const results=await Promise.all(Array.from({length:4},()=>store.command(user,batch)));
      assert.ok(results.every(r=>r.receipts[0].id===batch.id));
      assert.deepEqual(await counts(),{sets:"3",receipts:"1",events:"4"});
      const s=results[0].session.sets;
      assert.deepEqual(s.map(r=>r.rpe),[null,null,9]);assert.ok(s.every(r=>r.weightSource==="user_said"));
      await assert.rejects(store.command(user,{...batch,text:"记下 深蹲 8 次"}),/CONTENT_CONFLICT/);
      assert.equal((await store.command(user,batch)).session.sets.length,3);
      const r=s[0];
      await assert.rejects(store.writeSet(user,{id:r.id,sessionId:r.sessionId,planExerciseId:"wrong-target",setIndex:r.setIndex,
        revision:2,status:"voided",weightKg:r.weightKg,reps:r.reps,rpe:r.rpe,weightSource:"user_entered",
        repsSource:"user_entered",inputUnit:"kg",sourceRef:"today-tap"}),/CONTENT_CONFLICT/);
    });
    await t.test("failure at second set rolls back first set, events and receipt",async()=>{
      const request=await prepare("记下 深蹲 40 公斤 8、7"),before=await counts();
      request.setIds[1]=batch.setIds[0]; // Collides only after first insertion succeeds.
      await assert.rejects(store.command(user,request),/CONTENT_CONFLICT/);
      assert.deepEqual(await counts(),before);
      assert.equal((await admin.query("select id from public.set_logs where id=$1",[request.setIds[0]])).rowCount,0);
    });
    await t.test("stale context rejects entire command after another write",async()=>{
      const stale=await prepare("记下 深蹲 8 次"),skip=await prepare("跳过 深蹲 下一组");
      await store.command(user,skip);const before=await counts();
      await assert.rejects(store.command(user,stale),/STALE_CONTEXT/);assert.deepEqual(await counts(),before);
      const undo={id:randomUUID(),commandId:skip.id,version:1};await store.undoCommand(user,undo);await store.undoCommand(user,undo);
      assert.equal((await store.command(user,skip)).session.sets.find(s=>s.id===skip.setIds[0])!.status,"voided");
    });
    await t.test("correction undo restores before values at a new revision; old correction cannot reapply",async()=>{
      const req=await prepare("更正 深蹲 第 3 组 7 次");const r=await store.command(user,req);
      assert.equal(r.session.sets[2].reps,7);assert.equal(r.session.sets[2].rpe,9);
      const undo={id:randomUUID(),commandId:req.id,version:1};
      await Promise.all([store.undoCommand(user,undo),store.undoCommand(user,undo)]);
      const after=await store.command(user,req),restored=after.session.sets[2];
      assert.equal(restored.reps,8);assert.equal(restored.rpe,9);assert.equal(restored.revision,3);
      assert.equal(after.receipts.find(c=>c.id===req.id)!.undo!.id,undo.id);
      await assert.rejects(store.undoCommand(user,{...undo,id:randomUUID()}),/ALREADY_UNDONE/);
    });
    await t.test("undo cannot overwrite a later tap; atomic undo rolls back any earlier compensation",async()=>{
      const req=await prepare("记下 深蹲 8、7 次");const result=await store.command(user,req);
      const r=result.session.sets.find(s=>s.id===req.setIds[1])!;
      const tap:SetRequest={id:r.id,sessionId:r.sessionId,planExerciseId:r.planExerciseId,setIndex:r.setIndex,
        revision:2,status:"done",weightKg:null,reps:6,rpe:null,weightSource:null,repsSource:"user_entered",inputUnit:"kg",sourceRef:"today-tap"};
      await store.writeSet(user,tap);const before=await counts();
      await assert.rejects(store.undoCommand(user,{id:randomUUID(),commandId:req.id,version:1}),/STALE_REVISION/);
      assert.deepEqual(await counts(),before);
      assert.equal((await store.load(user)).session!.sets.find(s=>s.id===req.setIds[0])!.status,"done");
    });
    await t.test("unknown weight stays NULL; pounds retain reported unit; batch undo after end never resurrects",async()=>{
      const req=await prepare("记下 深蹲 100 lb 9、8，最后一组 RPE 8");await store.command(user,req);
      await store.end(user,{id:session.id,revision:2,status:"ended"});
      const undo={id:randomUUID(),commandId:req.id,version:1};await store.undoCommand(user,undo);
      const after=await store.command(user,req),sets=after.session.sets.filter(s=>req.setIds.some(id=>id===s.id));
      assert.ok(sets.every(s=>s.status==="voided"&&s.revision===2&&s.inputUnit==="lb"&&s.weightKg===45.359237));
      assert.deepEqual(sets.map(s=>s.rpe),[null,8]);
      assert.ok((await store.load(user)).receipts!.some(r=>r.id===req.id&&r.undo));
    });
    await t.test("other users cannot preview, apply, undo or read receipts; runtime receipts immutable",async()=>{
      await assert.rejects(store.preview(other,{sessionId:session.id,text:"深蹲 8 次"}),/NOT_FOUND/);
      await assert.rejects(store.command(other,batch),/NOT_FOUND/);
      await assert.rejects(store.undoCommand(other,{id:randomUUID(),commandId:batch.id,version:1}),/NOT_FOUND/);
      assert.deepEqual((await store.load(other)).receipts,[]);
      const perms=(await admin.query(`select has_table_privilege('authenticated','public.workout_commands','INSERT') as browser_write,
        has_table_privilege('liftcut_workout','public.workout_commands','UPDATE') as runtime_update,
        has_table_privilege('liftcut_workout','public.workout_commands','DELETE') as runtime_delete`)).rows[0];
      assert.deepEqual(perms,{browser_write:false,runtime_update:false,runtime_delete:false});
      const client=await pool.connect();try{
        await client.query("begin");await client.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
        assert.equal((await client.query("select * from public.workout_commands")).rowCount,0);
        await assert.rejects(client.query(`insert into public.workout_commands(id,user_id,session_id,version,request_hash,receipt)
          values($1,$2,$3,1,repeat('a',64),'{}')`,[randomUUID(),user,session.id]),/row-level security/);
      }finally{await client.query("rollback");client.release();}
    });
  } finally {await pool.end();await admin.end();}
});
