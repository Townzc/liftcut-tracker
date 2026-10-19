import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { projectOperation, mergeConfirmed, retryDisposition, operationId } from "../src/lib/workout-outbox";
import { workoutCanonical, workoutContextInput } from "@liftcut/core/workout-context";
import { localContextHash } from "../src/lib/workout-context";
import { workoutOwnerMismatch } from "../src/lib/workout-owner";
import type { TodayData, SetRequest } from "@liftcut/core/today";
const user=randomUUID(), session=randomUUID(), exercise=randomUUID();
const base=():TodayData=>({days:[],previous:{},receipts:[],session:{id:session,userId:user,localDate:"2026-10-13",timezone:"America/Los_Angeles",
  trainingPlanId:randomUUID(),weekNumber:1,dayNumber:1,status:"active",revision:1,startedAt:"2026-10-13T19:00:00Z",endedAt:null,sets:[],
  prescription:{title:"synthetic",exercises:[{id:exercise,name:"深蹲",sets:4,repRange:"8-12",targetRpe:7}]}}});
const set=(revision=1):SetRequest=>({id:randomUUID(),sessionId:session,planExerciseId:exercise,setIndex:1,revision,status:"done",
  weightKg:null,reps:8,rpe:null,weightSource:null,repsSource:"user_entered",inputUnit:"kg",sourceRef:"today-tap"});
const at="2026-10-13T19:01:00Z";
test("offline projection preserves nulls, correction order, compensating void and omitted slots on end",()=>{
  const original=base(), s=set();
  const a=projectOperation(original,{action:"set",body:s},at);
  const b=projectOperation(a,{action:"set",body:{...s,revision:2,reps:7}},at);
  const c=projectOperation(b,{action:"set",body:{...s,revision:3,reps:7,status:"voided"}},at);
  const ended=projectOperation(c,{action:"end",body:{id:session,revision:2,status:"ended"}},at);
  assert.equal(original.session!.sets.length,0);assert.equal(ended.session!.sets.length,1);
  assert.deepEqual([ended.session!.sets[0].rpe,ended.session!.sets[0].weightKg,ended.session!.sets[0].status,ended.session!.sets[0].revision],[null,null,"voided",3]);
  assert.throws(()=>projectOperation(c,{action:"set",body:{...s,revision:2}},at));
  assert.throws(()=>projectOperation(a,{action:"set",body:set()},at));
});
test("offline sentence → correction → compensation uses exact stable context and original provenance",async()=>{
  const initial=base(), id=randomUUID();
  const request={id,sessionId:session,text:"深蹲 100 lb 10、8，最后一组 RPE 9",version:1,contextHash:await localContextHash(initial.session!),setIds:[randomUUID(),randomUUID()],authorization:"confirm_preview"};
  const a=projectOperation(initial,{action:"apply",body:request},at);
  assert.deepEqual(a.session!.sets.map(s=>s.rpe),[null,9]);assert.equal(a.session!.sets[0].weightKg,45.359237);
  assert.equal(await localContextHash(a.session!),createHash("sha256").update(workoutCanonical(workoutContextInput(a.session!))).digest("hex"));
  const b=projectOperation(a,{action:"undo",body:{id:randomUUID(),commandId:id,version:1}},at);
  assert.equal(b.session!.sets[0].inputUnit,"lb");assert.equal(b.session!.sets[0].weightSource,"user_said");
  assert.ok(b.session!.sets.every(s=>s.status==="voided" && s.revision===2));assert.ok(b.receipts![0].undo);
  const edited=projectOperation(a,{action:"set",body:{...set(2),id:request.setIds[0],weightKg:45.359237,weightSource:"user_entered"}},at);
  assert.throws(()=>projectOperation(edited,{action:"undo",body:{id:randomUUID(),commandId:id,version:1}},at));
});
test("old-session compensation response cannot replace current workout; owner header cannot authorize another account",()=>{
  const data=base(), other={...data.session!,id:randomUUID(),status:"ended" as const};
  assert.equal(mergeConfirmed(data,"undo",{session:other,receipts:[]}).session!.id,session);
  assert.equal(workoutOwnerMismatch(new Request("https://test.invalid",{headers:{"X-Workout-Owner":randomUUID()}}),user)?.status,409);
  assert.equal(workoutOwnerMismatch(new Request("https://test.invalid",{headers:{"X-Workout-Owner":user}}),user),null);
});
test("auth pauses, server errors retain unknown request, conflict never silently retries at a new revision",()=>{
  assert.equal(retryDisposition(401,""),"auth");assert.equal(retryDisposition(409,"ACCOUNT_CHANGED"),"auth");
  assert.equal(retryDisposition(409,"STALE_REVISION"),"conflict");assert.equal(retryDisposition(503,""),"retry");
  assert.equal(retryDisposition(429,""),"retry");
  const s=set();assert.notEqual(operationId({action:"set",body:s}),operationId({action:"set",body:{...s,revision:2}}));
});
