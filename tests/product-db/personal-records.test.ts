import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PersonalRecordStore } from "../../src/services/today/personal-record-store";
import { testUrl } from "./today-setup";

test("personal records: real transactions, immutable retries, compensation, NULLs and owner isolation",async t=>{
  const admin=new Pool({connectionString:testUrl()}),target=new URL(testUrl());target.username="liftcut_workout";target.password="w1b-local-fixture-only";
  const pool=new Pool({connectionString:target.toString(),max:6}),store=new PersonalRecordStore(pool),user=randomUUID(),other=randomUUID();
  const create={action:"create",id:randomUUID(),entry:{kind:"body",date:"2026-10-14",weightKg:72.5,waistCm:null},source:"conversation",text:"记下体重 72.5 公斤",anchorDate:"2026-10-14"};
  try {
    await admin.query("insert into auth.users values($1),($2)",[user,other]);
    await t.test("parallel creates return one identical receipt and preserve null",async()=>{
      const replies=await Promise.all(Array.from({length:5},()=>store.command(user,create)));
      assert.ok(replies.every(r=>JSON.stringify(r)===JSON.stringify(replies[0])));
      const rows=(await admin.query("select request from personal_record_events where user_id=$1",[user])).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].request.entry.waistCm,null);
      await assert.rejects(store.command(user,{...create,text:"体重 72.5 公斤"}),/CONTENT_CONFLICT/);
      await assert.rejects(store.command(user,{...create,id:randomUUID(),entry:{...create.entry,waistCm:80}}),/DRAFT_MISMATCH/);
    });
    await t.test("compensation is append-only; late create retry cannot resurrect the record",async()=>{
      const undo={action:"undo",id:randomUUID(),recordId:create.id};
      const receipts=await Promise.all([store.command(user,undo),store.command(user,undo)]);assert.deepEqual(receipts[0],receipts[1]);
      await store.command(user,create);const history=await store.list(user);
      assert.equal(history.length,1);assert.equal(history[0].undo?.id,undo.id);
      assert.equal((await admin.query("select count(*)::int as n from personal_record_events where user_id=$1",[user])).rows[0].n,2);
      await assert.rejects(store.command(user,{...undo,id:randomUUID()}),/ALREADY_VOIDED/);
    });
    await t.test("RLS and API role prohibit cross-account access and browser writes",async()=>{
      assert.deepEqual(await store.list(other),[]);
      await assert.rejects(store.command(other,{action:"undo",id:randomUUID(),recordId:create.id}),/NOT_FOUND/);
      await assert.rejects(store.command(other,create),/CONTENT_CONFLICT/);
      const db=await pool.connect();
      try {await db.query("begin");await db.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
        assert.equal((await db.query("select * from personal_record_events")).rowCount,0);await db.query("rollback");
        await assert.rejects(db.query("update personal_record_events set request='{}'"),/permission denied/);
        await assert.rejects(db.query("delete from personal_record_events"),/permission denied/);
      }finally{db.release();}
      const permissions=(await admin.query("select has_table_privilege('anon','personal_record_events','select') as anon_read,has_table_privilege('authenticated','personal_record_events','insert') as browser_write")).rows[0];
      assert.deepEqual(permissions,{anon_read:false,browser_write:false});
    });
  } finally {await admin.query("delete from auth.users where id=any($1::uuid[])",[[user,other]]);await pool.end();await admin.end();}
});
