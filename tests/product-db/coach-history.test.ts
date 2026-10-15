import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {testUrl} from "./today-setup";
import {CoachHistoryStore} from "../../src/services/ai/coach-history-store";
import {CoachStore} from "../../src/services/ai/coach-store";
import {CoachTimer} from "../../src/lib/coach-timing";
import {beginOwnerTransaction} from "../../src/services/owner-transaction";
const item=(n=0)=>({turn:{id:randomUUID(),at:new Date(Date.UTC(2026,9,15,0,0,n)).toISOString(),text:`synthetic ${n}`,reply:"data",lines:["Synthetic answer"]},revision:1});

test("durable conversations keep RLS ownership, replay safety, deletion tombstones and stable pages",async t=>{
  const admin=new Pool({connectionString:testUrl()}),url=new URL(testUrl());url.username="liftcut_workout";url.password="w1b-local-fixture-only";
  const runtime=new Pool({connectionString:url.toString(),max:10}),store=new CoachHistoryStore(runtime),owner=randomUUID(),other=randomUUID(),id=randomUUID(),first=item();
  try{
    await admin.query("insert into auth.users values($1),($2)",[owner,other]);
    await t.test("repeat upload is idempotent; owner isolation is enforced in service and direct SQL",async()=>{
      await Promise.all([store.save(owner,{conversationId:id,items:[first]}),store.save(owner,{conversationId:id,items:[first]})]);
      assert.equal((await store.load(owner,id)).items.length,1);assert.deepEqual((await store.list(other)).items,[]);
      await assert.rejects(store.load(other,id),/NOT_FOUND/);await assert.rejects(store.save(other,{conversationId:id,items:[item()]}));
      const db=await runtime.connect();try{
        await beginOwnerTransaction(db,other,"liftcut_workout");assert.equal((await db.query("select * from coach_turns where user_id=$1",[owner])).rowCount,0);
        await assert.rejects(db.query("update coach_conversations set user_id=$1 where id=$2",[other,id]).then(r=>{if(r.rowCount===0)throw Error("RLS hidden");}),/RLS/);
      }finally{await db.query("rollback");db.release();}
      const permissions=(await admin.query("select has_table_privilege('authenticated','coach_turns','select') readable,has_table_privilege('liftcut_agent','coach_turns','insert') writable")).rows[0];
      assert.equal(permissions.readable,false);assert.equal(permissions.writable,false);
    });
    await t.test("a complete revision wins; stale or conflicting data cannot overwrite it",async()=>{
      const final={...first,revision:2,turn:{...first.turn,lines:["Final answer"]}};
      await store.save(owner,{conversationId:id,items:[final]});await assert.rejects(store.save(owner,{conversationId:id,items:[first]}),/HISTORY_CONFLICT/);
      await assert.rejects(store.save(owner,{conversationId:id,items:[{...final,turn:{...final.turn,lines:["conflict"]}}]}),/HISTORY_CONFLICT/);
      assert.deepEqual((await store.load(owner,id)).items,[final]);
    });
    await t.test("message pages do not skip or repeat boundaries",async()=>{
      const expected=[first.turn.id];for(let n=1;n<=60;n+=10){const items=Array.from({length:10},(_,i)=>item(n+i));expected.push(...items.map(i=>i.turn.id));await store.save(owner,{conversationId:id,items});}
      const page1=await store.load(owner,id);assert.equal(page1.items.length,50);assert.ok(page1.next);
      const page2=await store.load(owner,id,page1.next);assert.equal(page2.items.length,11);assert.equal(page2.next,null);
      assert.deepEqual([...page2.items,...page1.items].map(i=>i.turn.id),expected);
    });
    await t.test("conversation cursor keeps rows with the same millisecond across pages",async()=>{
      for(let n=0;n<42;n++)await store.save(other,{conversationId:randomUUID(),items:[item(n)]});
      await admin.query("update coach_conversations set updated_at='2026-10-15T12:00:00.123456Z' where user_id=$1",[other]);
      const one=await store.list(other);assert.equal(one.items.length,40);assert.ok(one.next);
      const two=await store.list(other,one.next);assert.equal(two.items.length,2);assert.equal(new Set([...one.items,...two.items].map(t=>t.id)).size,42);
    });
    await t.test("deletion races with delayed uploads cannot resurrect prose or delete business records",async()=>{
      const bodyId=randomUUID();await admin.query("insert into body_metric_logs(id,user_id,date,weight,waist) values($1,$2,'2026-10-15',72,80)",[bodyId,owner]);
      await store.remove(other,id);assert.equal((await store.load(owner,id)).items.length,50);
      await Promise.allSettled([store.remove(owner,id),store.save(owner,{conversationId:id,items:[item(61)]})]);
      await assert.rejects(store.load(owner,id),/NOT_FOUND/);await assert.rejects(store.save(owner,{conversationId:id,items:[item(62)]}),/NOT_FOUND/);
      assert.equal((await admin.query("select count(*)::int n from coach_turns where conversation_id=$1",[id])).rows[0].n,0);
      assert.equal((await admin.query("select count(*)::int n from body_metric_logs where id=$1",[bodyId])).rows[0].n,1);
    });
    await t.test("concurrent quota reservations enforce the limit and report real lock/query time",async()=>{
      const results=await Promise.allSettled(Array.from({length:10},()=>new CoachStore(runtime).reserve(owner,randomUUID())));
      assert.equal(results.filter(r=>r.status==="fulfilled").length,6);
      assert.ok(results.filter(r=>r.status==="rejected").every(r=>r.reason.message==="RATE_LIMITED"));
      const timer=new CoachTimer(),quota=new CoachStore(runtime,timer),request=randomUUID();await quota.reserve(other,request);
      const detail=timer.snapshot().quotaDetail;assert.ok(detail&&detail.lockMs>=0&&detail.checkMs>=0&&detail.insertMs>=0);
      await assert.rejects(quota.reserve(other,request),/REQUEST_ALREADY_USED/);
      const db=await runtime.connect();try{await assert.rejects(db.query("select reserve_coach_request($1)",[randomUUID()]),/OWNER_REQUIRED/);}finally{db.release();}
      assert.equal((await admin.query("select has_function_privilege('authenticated','public.reserve_coach_request(uuid)','execute') allowed")).rows[0].allowed,false);
    });
  }finally{await admin.query("delete from auth.users where id=any($1::uuid[])",[[owner,other]]);await runtime.end();await admin.end();}
});
