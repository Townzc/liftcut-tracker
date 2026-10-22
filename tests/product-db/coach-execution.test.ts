import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {testUrl} from "./today-setup";
import {runCoach} from "../../src/services/ai/coach-agent";
import {todayPool} from "../../src/services/today/database";
import {CoachTimer} from "../../src/lib/coach-timing";
import {CoachStore} from "../../src/services/ai/coach-store";
import {TodayStore} from "../../src/services/today/store";

test("SDK executes separate reads concurrently, holds unverified prose, and keeps one unsaved draft",async()=>{
  const admin=new Pool({connectionString:testUrl()}),runtime=new URL(testUrl());
  runtime.username="liftcut_workout";runtime.password="w1b-local-fixture-only";
  process.env.WORKOUT_DATABASE_URL=runtime.toString();process.env.AI_PROVIDER="local";
  process.env.COACH_SIGNING_SECRET="synthetic-latency-test-secret-not-production";
  const owner=randomUUID(),anchor=new Date().toISOString().slice(0,10),emitted:string[]=[];let calls=0,mode="read";
  const server=createServer(async(req,res)=>{
    for await(const chunk of req)void chunk;calls++;
    const choice=(name:string,input:unknown,index:number)=>({index,id:`call_${calls}_${index}`,type:"function",function:{name,arguments:JSON.stringify(input)}});
    const choices=mode==="read"?[
      choice("read_records",{topic:"body",from:anchor,to:anchor},0),choice("read_records",{topic:"food",from:anchor,to:anchor},1),
      choice("finish_response",{sourceIds:[`body:${anchor}:${anchor}`,`food:${anchor}:${anchor}`],message:"Both sources are ready."},2),
    ]:[0,1].map(i=>choice("prepare_body",{dateQuote:null,weightQuote:"72公斤",waistQuote:null},i));
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    const event=(delta:unknown,finish_reason:string|null)=>res.write("data: "+JSON.stringify({id:"fixture",object:"chat.completion.chunk",created:1,model:"scripted",choices:[{index:0,delta,finish_reason}]})+"\n\n");
    event({role:"assistant",tool_calls:choices},null);event({},"tool_calls");res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();assert.ok(address&&typeof address!=="string");
  process.env.LOCAL_AI_BASE_URL=`http://127.0.0.1:${address.port}/v1`;
  const lock=await admin.connect();let running:ReturnType<typeof runCoach>|undefined;
  try{
    await admin.query("insert into auth.users values($1)",[owner]);
    await lock.query("begin; lock public.body_metric_logs in access exclusive mode");
    const input={id:randomUUID(),text:"核对身体和饮食数据",history:[],locale:"en" as const,timezone:"UTC",consent:"coach-model-v2" as const},timer=new CoachTimer();
    running=runCoach(owner,input,AbortSignal.timeout(10000),undefined,e=>{if(e.type==="text")emitted.push(e.text);},timer);
    void running.catch(()=>{});
    // A real PostgreSQL lock holds the body query. The independent food query
    // must finish while it is held, without publishing the premature final text.
    for(let i=0;i<150&&!timer.snapshot().database.some(s=>s.name==="food.query");i++)await new Promise(r=>setTimeout(r,20));
    assert.ok(timer.snapshot().database.some(s=>s.name==="food.query"));
    assert.ok(!timer.snapshot().database.some(s=>s.name==="body.query"));assert.deepEqual(emitted,[]);
    await lock.query("rollback");const result=await running;
    assert.equal(calls,1);assert.equal(result.sources.length,2);assert.equal(result.message,"Both sources are ready.");
    assert.equal(emitted.join(""),result.message);assert.equal(result.proposal,undefined);
    const reads=result.timing!.tools.filter(s=>s.name==="read_records");assert.equal(reads.length,2);
    assert.ok(Math.max(...reads.map(s=>s.startMs))<Math.min(...reads.map(s=>s.startMs+s.durationMs)),"separate SDK tools must overlap");
    mode="draft";const draft=await runCoach(owner,{...input,id:randomUUID(),text:"刚才称了72公斤，帮我记一下。"},AbortSignal.timeout(10000),undefined,()=>{});
    assert.equal(draft.proposal?.kind,"personal");
    assert.equal((await admin.query("select count(*)::int n from personal_record_events where user_id=$1",[owner])).rows[0].n,0);
  }finally{
    await lock.query("rollback");lock.release();await running?.catch(()=>{});
    await admin.query("delete from auth.users where id=$1",[owner]);await todayPool().end();await admin.end();
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  }
});

test("batched setup fails closed for privileged roles and returns a pooled connection without an owner",async()=>{
  const admin=new Pool({connectionString:testUrl()}),url=new URL(testUrl());url.username="liftcut_workout";url.password="w1b-local-fixture-only";
  const pool=new Pool({connectionString:url.toString(),max:1}),owner=randomUUID(),other=randomUUID();
  try{
    await admin.query("insert into auth.users values($1),($2)",[owner,other]);
    await assert.rejects(new CoachStore(admin).read(owner,{topic:"body",from:"2026-10-14",to:"2026-10-14"},"2026-10-14"),/UNSAFE_DATABASE_ROLE/);
    await new CoachStore(pool).read(owner,{topic:"body",from:"2026-10-14",to:"2026-10-14"},"2026-10-14");
    assert.equal((await pool.query("select nullif(current_setting('request.jwt.claim.sub',true),'') as owner")).rows[0].owner,null);
    assert.equal(await new TodayStore(pool).current(other),null);
    await assert.rejects(new TodayStore(admin).current(owner),/UNSAFE_DATABASE_ROLE/);
  }finally{await admin.query("delete from auth.users where id=any($1::uuid[])",[[owner,other]]);await pool.end();await admin.end();}
});
