import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { operationBody, operationId, projectOutbox, type OutboxState, type WorkoutOperation } from "@liftcut/core/workout-outbox";
import type { SetRequest } from "@liftcut/core/today";
import { canFollowSetAcknowledgement } from "../src/services/today/outbox-acknowledgement";
import { WorkoutOutboxClient } from "../src/services/today/outbox-client";

const owner=randomUUID(),sessionId=randomUUID(),exercise=randomUUID(),at="2026-10-27T08:00:00Z";
const request=(index=1):SetRequest=>({id:randomUUID(),sessionId,planExerciseId:exercise,setIndex:index,revision:1,
  status:"done",weightKg:42,reps:8,rpe:null,inputUnit:"kg",weightSource:"user_entered",repsSource:"user_entered",sourceRef:"today-tap"});
function fixture(count=1) {
  const before:OutboxState={owner,version:1,revision:10,confirmed:{days:[],previous:{},receipts:[],session:{
    id:sessionId,userId:owner,localDate:"2026-10-27",timezone:"UTC",trainingPlanId:"synthetic",weekNumber:1,dayNumber:1,
    status:"active",revision:1,startedAt:at,endedAt:null,sets:[],prescription:{title:"synthetic",exercises:[{id:exercise,name:"Squat",sets:4,repRange:"8",targetRpe:7}]}}},
    items:Array.from({length:count},(_,i)=>{
      const operation:WorkoutOperation={action:"set",body:request(i+1)};
      return {id:operationId(operation),action:operation.action,bodyJson:JSON.stringify(operationBody(operation)),createdAt:at,status:"pending",attempts:0,nextAttempt:0};
    })};
  const after=structuredClone(before);after.revision++;
  after.confirmed=projectOutbox({...before,items:before.items.slice(0,1)}).data;
  after.items.shift();after.confirmed!.session!.sets[0].updatedAt="2026-10-27T08:00:01Z";
  return {before,after};
}
const end:WorkoutOperation={action:"end",body:{id:sessionId,revision:2,status:"ended"}};
// Exercise the actual enqueue guard/body/idempotency logic with a serialized
// transaction adapter. The browser test separately exercises real IndexedDB.
function clientWith(state:OutboxState) {
  const disk={state:structuredClone(state)};
  const client=Object.create(WorkoutOutboxClient.prototype) as WorkoutOutboxClient;
  Object.assign(client,{owner,
    storage:{async change(update?:(s:OutboxState)=>boolean) {
      const next=structuredClone(disk.state);
      if(update?.(next)){next.revision++;disk.state=next;}
      return structuredClone(disk.state);
    }},emit:()=>{},notify:()=>{},drain:async()=>{}});
  return {client,disk};
}

for(const action of ["end","set"] as const)test(`${action}: known ack permits identical bytes from the displayed revision`,async()=>{
  const {before,after}=fixture(),{client,disk}=clientWith(after);
  const p=action==="end"?end:{action,body:request(2)};
  const frozen=JSON.stringify(p);
  await client.enqueue(p,before.revision,before);
  assert.equal(disk.state.items.length,1);assert.equal(disk.state.items[0].bodyJson,JSON.stringify(operationBody(p)));
  assert.equal(disk.state.items[0].id,operationId(p));assert.equal(JSON.stringify(p),frozen);
  const revision=disk.state.revision;
  await client.enqueue(p,before.revision,before);
  assert.equal(disk.state.revision,revision);assert.equal(disk.state.items.length,1);
  await assert.rejects(client.enqueue({...p,body:{...p.body as object,...(action==="set"?{reps:7}:{revision:3})}},before.revision,before),/LOCAL_CONFLICT/);
});

test("one or several known set acks preserve an unchanged queued suffix",()=>{
  const {before,after}=fixture(3);
  assert.equal(canFollowSetAcknowledgement(owner,"end",before,after),true);
  const all={...after,revision:before.revision+3,items:[],confirmed:projectOutbox(before).data};
  assert.equal(canFollowSetAcknowledgement(owner,"set",before,all),true);
  assert.equal(canFollowSetAcknowledgement(owner,"apply",before,all),false);
  assert.equal(canFollowSetAcknowledgement(owner,"review",before,all),false);
});

const changes:Record<string,(s:OutboxState)=>void>={
  owner:s=>{s.owner=randomUUID();},sessionOwner:s=>{s.confirmed!.session!.userId=randomUUID();},
  session:s=>{s.confirmed!.session!.id=randomUUID();},businessRevision:s=>{s.confirmed!.session!.revision++;},
  actual:s=>{s.confirmed!.session!.sets[0].reps=9;},unknown:s=>{s.confirmed!.session!.sets[0].rpe=7;},
  source:s=>{s.confirmed!.session!.sets[0].sourceRef="another-source";},unit:s=>{s.confirmed!.session!.sets[0].inputUnit="lb";},
  perHand:s=>{s.confirmed!.session!.sets[0].perHandLoad={value:21,unit:"kg"};},
  prescription:s=>{s.confirmed!.session!.prescription.exercises[0].sets=5;},
  otherTab:s=>{s.items.push(fixture().before.items[0]);},unobservedRevision:s=>{s.revision++;},
  discard:s=>{s.discarded=[{at,items:[]}];},
};
for(const [name,change] of Object.entries(changes))test(`reject ${name}, without writing or changing the request`,async()=>{
  const {before,after}=fixture();change(after);
  const {client,disk}=clientWith(after),saved=JSON.stringify(disk.state);
  assert.equal(canFollowSetAcknowledgement(owner,"end",before,after),false);
  await assert.rejects(client.enqueue(end,before.revision,before),/LOCAL_CONFLICT/);
  assert.equal(JSON.stringify(disk.state),saved);
});

test("auth/conflict, changed suffix bytes/IDs, non-set prefix and absent snapshot stay closed",async()=>{
  for(const status of ["auth","conflict"] as const) {
    const {before,after}=fixture(2);after.items[0].status=status;
    assert.equal(canFollowSetAcknowledgement(owner,"end",before,after),false);
    after.items[0].status="pending";before.items[0].status=status;
    assert.equal(canFollowSetAcknowledgement(owner,"end",before,after),false);
  }
  for(const field of ["id","bodyJson"] as const) {
    const {before,after}=fixture(2);after.items[0][field]+="changed";
    await assert.rejects(clientWith(after).client.enqueue(end,before.revision,before),/LOCAL_CONFLICT/);
  }
  const {before,after}=fixture();before.items[0].action="apply";
  assert.equal(canFollowSetAcknowledgement(owner,"end",before,after),false);
  await assert.rejects(clientWith(after).client.enqueue(end,before.revision),/LOCAL_CONFLICT/);
  await assert.rejects(clientWith(after).client.enqueue(end,before.revision-1,before),/LOCAL_CONFLICT/);
});

test("same-revision offline operations remain ordered; old record revision is never retried as new",async()=>{
  const {before}=fixture(),{client,disk}=clientWith(before);
  await client.enqueue(end,before.revision,before);
  assert.deepEqual(disk.state.items.map(i=>i.action),["set","end"]);
  const {after}=fixture(),c=clientWith(after),existing=after.confirmed!.session!.sets[0];
  const {exerciseName:_,updatedAt:__,...body}=existing;void _;void __;
  await assert.rejects(c.client.enqueue({action:"set",body},after.revision,after),/LOCAL_CONFLICT/);
  assert.deepEqual(c.disk.state,after);
});
