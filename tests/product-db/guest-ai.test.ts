import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {Pool} from "pg";
import {testUrl} from "./today-setup";
import {GuestStore} from "../../src/services/ai/guest-store";
import {CoachStore} from "../../src/services/ai/coach-store";
import {PersonalRecordStore} from "../../src/services/today/personal-record-store";
import {signGuestSession,verifyGuestSession} from "../../src/services/ai/guest-session";
process.env.COACH_SIGNING_SECRET="synthetic-guest-trial-test-key-not-production";
test("signed guest identity rejects tampering and expiry",()=>{
  const id=randomUUID(),now=Date.now(),token=signGuestSession(id,now);
  assert.equal(verifyGuestSession(token,now),id);assert.equal(verifyGuestSession(token+"x",now),null);
  assert.equal(verifyGuestSession(signGuestSession(randomUUID(),now).split(".")[0]+"."+token.split(".")[1],now),null);
  assert.equal(verifyGuestSession(token,now+31*86400000),null);
});
test("guest trial budgets and atomic import survive concurrency, response loss and account switching",async t=>{
  const admin=new Pool({connectionString:testUrl()}),target=new URL(testUrl());target.username="liftcut_workout";target.password="w1b-local-fixture-only";
  const pool=new Pool({connectionString:target.toString(),max:12}),store=new GuestStore(pool),coach=new CoachStore(pool),personal=new PersonalRecordStore(pool);
  const owner=randomUUID(),other=randomUUID(),guest=randomUUID(),network=createHash("sha256").update(guest).digest("hex"),workspace=randomUUID();
  const burstNetwork=createHash("sha256").update(guest+":burst").digest("hex");
  const facts=[{id:randomUUID(),entry:{kind:"body",date:"2026-08-16",weightKg:72.5,waistCm:80},source:"conversation",text:"synthetic",createdAt:"2026-08-16T12:00:00Z",undo:null},
    {id:randomUUID(),entry:{kind:"exercise",date:"2026-08-01",exerciseName:"卧推",weightKg:50,reps:null,sets:null,rpe:null},source:"conversation",text:"synthetic",createdAt:"2026-08-01T12:00:00Z",undo:null},
    {id:randomUUID(),entry:{kind:"preference",date:"2026-10-16",key:"goal",value:"增肌"},source:"conversation",text:"记住我的目标是增肌",createdAt:"2026-10-16T12:00:00Z",undo:null}];
  try{
    await admin.query("insert into auth.users values($1),($2)",[owner,other]);
    await t.test("atomic 10/day budget and independent network budget prevent refresh bypass",async()=>{
      await admin.query("insert into coach_private.guest_ai_usage(request_id,guest_id,network_hash,created_at) select gen_random_uuid(),$1,$2,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' from generate_series(1,7)",[guest,network]);
      const results=await Promise.allSettled(Array.from({length:6},()=>store.reserve(guest,network,randomUUID())));
      assert.equal(results.filter(r=>r.status==="fulfilled").length,3);assert.equal((await store.quota(guest)).remaining,0);
      const used=(await admin.query("select request_id from coach_private.guest_ai_usage where guest_id=$1 limit 1",[guest])).rows[0].request_id;
      await assert.rejects(store.reserve(guest,network,used),/REQUEST_ALREADY_USED/);
      await admin.query("insert into coach_private.guest_ai_usage(request_id,guest_id,network_hash,created_at) select gen_random_uuid(),gen_random_uuid(),$1,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' from generate_series(1,30)",[network]);
      await assert.rejects(store.reserve(randomUUID(),network,randomUUID()),/GUEST_DAILY_LIMIT/);
    });
    await t.test("per-minute and global cost ceilings also reserve atomically",async()=>{
      const burstGuest=randomUUID();
      const results=await Promise.allSettled(Array.from({length:9},()=>store.reserve(burstGuest,burstNetwork,randomUUID())));
      assert.equal(results.filter(r=>r.status==="fulfilled").length,6);
      assert.ok(results.filter(r=>r.status==="rejected").every(r=>r.reason.message==="GUEST_RATE_LIMITED"));
      await admin.query("insert into coach_private.guest_ai_usage(request_id,guest_id,network_hash) select gen_random_uuid(),gen_random_uuid(),$1 from generate_series(1,500)",[burstNetwork]);
      await assert.rejects(store.reserve(randomUUID(),createHash('sha256').update(randomUUID()).digest('hex'),randomUUID()),/GUEST_DAILY_LIMIT/);
      await admin.query("delete from coach_private.guest_ai_usage where network_hash=$1",[burstNetwork]);
    });
    await t.test("all facts commit once; identical concurrent/repeated import returns same receipt",async()=>{
      const input={workspaceId:workspace,records:facts,confirm:true};
      const receipts=await Promise.all([store.import(owner,guest,input),store.import(owner,guest,input)]);assert.deepEqual(receipts[0],receipts[1]);
      assert.equal((await personal.list(owner)).length,3);assert.equal((await personal.list(other)).length,0);
      await assert.rejects(store.import(other,guest,input),/IMPORT_CONFLICT/);
      await assert.rejects(store.import(owner,guest,{...input,records:facts.slice(1)}),/IMPORT_CONFLICT/);
      assert.deepEqual(await store.import(owner,guest,input),receipts[0]);
    });
    await t.test("latest and historical queries use confirmed records regardless of age or chat context",async()=>{
      const memory=await coach.memory(owner,"2026-10-16");assert.equal(memory.rows.find(r=>r.metric==="weight")?.value,72.5);
      assert.equal(memory.rows.find(r=>r.exerciseName==="卧推")?.value,50);assert.equal(memory.rows.find(r=>r.exerciseName==="卧推")?.sets,null);
      assert.equal(memory.rows.find(r=>r.metric==="preference:goal")?.value,"增肌");
      assert.equal((await coach.memory(other,"2026-10-16")).rows.length,0);
      assert.equal((await coach.read(owner,{topic:"body",from:"2026-08-16",to:"2026-08-16"},"2026-10-16")).rows[0].weightKg,72.5);
      assert.equal((await coach.read(owner,{topic:"workout",from:"2026-08-01",to:"2026-08-01"},"2026-10-16")).rows.length,1);
      await personal.command(owner,{action:"undo",id:randomUUID(),recordId:facts[0].id});
      assert.equal((await coach.memory(owner,"2026-10-16")).rows.some(r=>r.metric==="weight"),false);
      await store.import(owner,guest,{workspaceId:workspace,records:facts,confirm:true});
      assert.equal((await coach.memory(owner,"2026-10-16")).rows.some(r=>r.metric==="weight"),false);
    });
    await t.test("a mid-import collision rolls back both new facts and import claim",async()=>{
      const next=randomUUID(),fresh={...facts[0],id:randomUUID()};
      await assert.rejects(store.import(owner,guest,{workspaceId:next,records:[fresh,facts[1]],confirm:true}),/IMPORT_CONFLICT/);
      assert.equal((await admin.query("select 1 from personal_record_events where id=$1",[fresh.id])).rowCount,0);
      assert.equal((await admin.query("select 1 from coach_private.guest_imports where workspace_id=$1",[next])).rowCount,0);
      const permissions=(await admin.query("select has_schema_privilege('anon','coach_private','usage') as anon,has_schema_privilege('authenticated','coach_private','usage') as authenticated")).rows[0];
      assert.deepEqual(permissions,{anon:false,authenticated:false});
    });
  }finally{await admin.query("delete from auth.users where id=any($1::uuid[])",[[owner,other]]);await admin.query("delete from coach_private.guest_ai_usage where network_hash=any($1::text[])",[[network,burstNetwork]]);await pool.end();await admin.end();}
});
