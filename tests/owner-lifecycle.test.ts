import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OwnerLifecycle, ownerLifecycle } from "../src/lib/owner-lifecycle";
import { CoachHistoryClient } from "../src/lib/coach-history-client";

function fixture() {
  const data=new Map<string,string>();
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},
    removeItem:(key:string)=>{data.delete(key);},key:(n:number)=>[...data.keys()][n]??null,get length(){return data.size;}};
  return {data,storage,lifecycle:new OwnerLifecycle(()=>storage)};
}
function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

test("pending stops new work, awaits late writes, and never purges queued bytes",async()=>{
  const {data,lifecycle}=fixture(),owner=randomUUID(),gate=deferred();
  const key=`liftcut-personal-v1:${owner}:request`;data.set(key,"original bytes");
  let started=false,stopped=false,settled=false;
  lifecycle.register(owner,()=>{stopped=true;});
  const pending=lifecycle.run(owner,async()=>{started=true;await gate.promise;data.set(key,"late acknowledgement");});
  await Promise.resolve();assert.equal(started,true);
  const stopping=lifecycle.stop(owner).then(()=>{settled=true;});
  assert.equal(stopped,true);assert.equal(lifecycle.active(owner),false);
  await assert.rejects(lifecycle.run(owner,async()=>{throw Error("must not run");}),/ACCOUNT_STOPPED/);
  assert.equal(settled,false);assert.equal(data.get(key),"original bytes");
  gate.release();await pending;await stopping;
  assert.equal(data.get(key),"late acknowledgement");assert.equal(data.get(`liftcut-account-lifecycle:${owner}`),"pending");
});

test("confirmed cleanup waits for queued history storage and removes only this owner",async()=>{
  const {data,lifecycle}=fixture(),a=randomUUID(),b=randomUUID(),gate=deferred();
  const owned=[`liftcut-chat-history:${a}`,`liftcut-review:${a}`,`liftcut-coach-consent:${a}`,`liftcut-p1-${a}`,`liftcut-p1-${a}-pending`,`liftcut-personal-v1:${a}:op`];
  const preserved=[`liftcut-chat-history:${b}`,`liftcut-review:${b}`,`liftcut-personal-v1:${b}:op`,"liftcut-coach-consent:guest","liftcut-tracker-ui-state","liftcut-ui-state","liftcut-p1-draft",`liftcut-personal-v1:${a}suffix:op`];
  for(const key of [...owned,...preserved])data.set(key,"private data");
  let removed:string|null=null;
  lifecycle.register(a,async()=>{await gate.promise;data.set(owned[0],"late chat draft");});
  const cleanup=lifecycle.purge({status:"deleted",owner:a},async owner=>{removed=owner;});
  await Promise.resolve();assert.equal(removed,null);assert.equal(data.has(owned[0]),true);
  gate.release();await cleanup;
  assert.equal(removed,a);for(const key of owned)assert.equal(data.has(key),false);
  for(const key of preserved)assert.equal(data.get(key),"private data");
  assert.equal(data.get(`liftcut-account-lifecycle:${a}`),"deleted");assert.equal(lifecycle.active(b),true);
});

test("unknown or pending result cannot purge; failed cleanup stays blocked and can retry",async()=>{
  const {data,lifecycle}=fixture(),owner=randomUUID(),key=`liftcut-chat-history:${owner}`;data.set(key,"draft");
  let calls=0;
  for(const status of ["pending","error","unknown"])await assert.rejects(lifecycle.purge({status,owner} as never,async()=>{calls++;}));
  assert.equal(calls,0);assert.equal(lifecycle.active(owner),true);assert.equal(data.get(key),"draft");
  await assert.rejects(lifecycle.purge({status:"deleted",owner},async()=>{throw Error("IDB unavailable");}),/IDB unavailable/);
  assert.equal(lifecycle.active(owner),false);assert.equal(data.get(key),"draft");
  await lifecycle.purge({status:"deleted",owner},async()=>{calls++;});assert.equal(calls,1);assert.equal(data.has(key),false);
});

test("pending and deleted tombstones survive recreation, stop another tab, and never regress",async()=>{
  const {storage,lifecycle}=fixture(),owner=randomUUID(),otherTab=new OwnerLifecycle(()=>storage);
  let stopped=0;otherTab.register(owner,()=>{stopped++;});
  await lifecycle.stop(owner);otherTab.changed(`liftcut-account-lifecycle:${owner}`);assert.equal(stopped,1);
  assert.equal(new OwnerLifecycle(()=>storage).active(owner),false);
  await lifecycle.purge({status:"deleted",owner},async()=>{});await otherTab.stop(owner);
  assert.equal(storage.getItem(`liftcut-account-lifecycle:${owner}`),"deleted");
  let remountStopped=false;otherTab.register(owner,()=>{remountStopped=true;});assert.equal(remountStopped,true);
});

test("storage failure fails closed and stop never claims purge success",async()=>{
  const lifecycle=new OwnerLifecycle(()=>{throw Error("storage denied");});
  const owner=randomUUID();assert.equal(lifecycle.active(owner),false);
  await assert.rejects(lifecycle.stop(owner),/storage denied/);
  await assert.rejects(lifecycle.purge({status:"deleted",owner},async()=>assert.fail("must not purge")),/storage denied/);
});

test("real browser history adapter retains pending draft, rejects late edits and cannot reactivate",async()=>{
  const {data,storage}=fixture(),owner=randomUUID();
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:storage});
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{onLine:false}});
  const history=new CoachHistoryClient(owner);await history.activate();history.setText("confirmed pending draft");await history.whenStored();
  const before=data.get(`liftcut-chat-history:${owner}`);
  await ownerLifecycle.stop(owner);history.setText("late callback");history.newConversation();await history.whenStored();
  assert.equal(data.get(`liftcut-chat-history:${owner}`),before);
  await assert.rejects(history.activate(),/ACCOUNT_STOPPED/);
  await ownerLifecycle.purge({status:"deleted",owner},async()=>{});
  assert.equal(data.has(`liftcut-chat-history:${owner}`),false);
});
